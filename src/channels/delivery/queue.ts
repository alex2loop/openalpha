import type { ChannelSettings } from '@/channels/schema'
import type { InboundMessage } from '@/channels/types'
import type { SessionId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { SessionQueue, SessionRouteRegistration } from '@/core/types/session'
import type { CostTracker } from '@/engine/api'
import { AppError, RunHalted } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { settleWithin } from '@/core/utils/concurrency'
import { t } from '@/i18n'

// Past this much buffered text the user is mid-paste or splitting one thought across sends, so we wait longer.
const NEAR_SPLIT_LENGTH_THRESHOLD = 3_000
const DRAIN_TIMEOUT_MS = 1_000
// Bounds per-session burst memory before the session queue's depth limit applies.
const MAX_BURST_MESSAGES = 8
const MAX_BURST_BYTES = 16_384

type NotifyFn = (chatId: string, text: string) => Promise<void>

type RunCombined = (combined: InboundMessage) => Promise<void>

export interface BudgetCaps {
  readonly maxDailyUsd: number
  readonly maxMonthlyUsd: number
}

interface InboundQueueDeps {
  readonly costTracker: CostTracker
  readonly sessionQueue: SessionQueue
  readonly notify: NotifyFn
  readonly settings: ChannelSettings
  readonly caps: BudgetCaps
  readonly logger: Logger
  readonly locale: Locale
  /** Shutdown signal — a debounce that fires after shutdown must not start a run. */
  readonly signal: AbortSignal
}

export interface InboundQueue {
  enqueueInbound(request: InboundRequest): Promise<void>
  cancelSession(sessionId: SessionId): void
  dispose(): Promise<void>
}

interface Burst {
  readonly texts: string[]
  last: InboundMessage
  textLen: number
  timer: ReturnType<typeof setTimeout> | null
  readonly run: RunCombined
  readonly receipts: Deferred[]
  readonly routes: SessionRouteRegistration[]
}

interface Turn {
  readonly sessionId: SessionId
  readonly combined: InboundMessage
  readonly run: RunCombined
  readonly receipts: readonly Deferred[]
  readonly routes: readonly SessionRouteRegistration[]
}

interface QueuedTurn extends Turn {
  cancelled: boolean
}

interface QueueState {
  readonly bursts: Map<SessionId, Burst>
  readonly pending: Map<SessionId, Set<QueuedTurn>>
  readonly inFlight: Set<Promise<void>>
}

interface QueueContext {
  readonly deps: InboundQueueDeps
  readonly state: QueueState
}

interface InboundRequest {
  readonly sessionId: SessionId
  readonly msg: InboundMessage
  readonly run: RunCombined
  readonly route: SessionRouteRegistration
}

interface Deferred {
  readonly promise: Promise<void>
  readonly resolve: () => void
  readonly reject: (error: Error) => void
}

export function createInboundQueue(deps: InboundQueueDeps): InboundQueue {
  const state: QueueState = {
    bursts: new Map(),
    pending: new Map(),
    inFlight: new Set(),
  }
  const ctx: QueueContext = { deps, state }

  return {
    enqueueInbound: (request) => enqueueInbound(ctx, request),
    cancelSession: (sessionId) => cancelSession(ctx, sessionId),
    dispose: () => dispose(ctx),
  }
}

function enqueueInbound(ctx: QueueContext, request: InboundRequest): Promise<void> {
  if (ctx.deps.signal.aborted) {
    request.route.release()
    return Promise.reject(shuttingDown())
  }

  try {
    const receipt = createDeferred()
    const existing = ctx.state.bursts.get(request.sessionId)

    if (existing === undefined) {
      startBurst(ctx, request, receipt)

      return receipt.promise
    }

    if (isBurstLimitExceeded(existing, request.msg)) {
      clearBurstTimer(existing)
      fireBurst(ctx, request.sessionId, existing)
      startBurst(ctx, request, receipt)

      return receipt.promise
    }

    clearBurstTimer(existing)
    existing.texts.push(request.msg.text)
    existing.last = request.msg
    existing.textLen += request.msg.text.length
    existing.receipts.push(receipt)
    existing.routes.push(request.route)
    arm(ctx, request.sessionId, existing)

    return receipt.promise
  } catch (err: unknown) {
    request.route.release()
    return Promise.reject(toReceiptError(err))
  }
}

function startBurst(ctx: QueueContext, request: InboundRequest, receipt: Deferred): void {
  const burst: Burst = {
    texts: [request.msg.text],
    last: request.msg,
    textLen: request.msg.text.length,
    timer: null,
    run: request.run,
    receipts: [receipt],
    routes: [request.route],
  }
  ctx.state.bursts.set(request.sessionId, burst)
  arm(ctx, request.sessionId, burst)
}

function fireBurst(ctx: QueueContext, sessionId: SessionId, burst: Burst): void {
  ctx.state.bursts.delete(sessionId)

  const task = fire(ctx.deps, ctx.state.pending, {
    sessionId,
    combined: combine(burst),
    run: burst.run,
    receipts: burst.receipts,
    routes: burst.routes,
  })
  ctx.state.inFlight.add(task)
  task.then(
    () => {
      resolveReceipts(burst.receipts)
      ctx.state.inFlight.delete(task)
    },
    (err: unknown) => {
      rejectReceipts(burst.receipts, toReceiptError(err))
      ctx.state.inFlight.delete(task)

      if (!(err instanceof RunHalted && err.code === 'shutdown')) {
        ctx.deps.logger.error('queue.fire_failed', { err: formatErrForLog(err) })
      }
    }
  )
}

function arm(ctx: QueueContext, sessionId: SessionId, burst: Burst): void {
  const waitMs =
    burst.textLen > NEAR_SPLIT_LENGTH_THRESHOLD
      ? ctx.deps.settings.nearSplitDebounceMs
      : ctx.deps.settings.debounceMs

  burst.timer = setTimeout(() => fireBurst(ctx, sessionId, burst), waitMs)
}

// Receipts resolve rather than reject: a cancelled message is finished, and a rejection would send
// its inbox entry back to be run again. Shutdown (dispose) still rejects so rows stay for retry.
function cancelSession(ctx: QueueContext, sessionId: SessionId): void {
  cancelBurst(ctx.state.bursts, sessionId)
  cancelPending(ctx.state.pending, sessionId)
}

// Clear armed bursts, then give in-flight turns a moment to land.
async function dispose(ctx: QueueContext): Promise<void> {
  clearBursts(ctx.state.bursts)
  clearPending(ctx.state.pending)

  const drained = await settleWithin(Promise.allSettled([...ctx.state.inFlight]), DRAIN_TIMEOUT_MS)

  if (!drained) {
    ctx.deps.logger.warn('queue.drain_timeout', { inFlight: ctx.state.inFlight.size })
  }
}

function cancelBurst(bursts: Map<SessionId, Burst>, sessionId: SessionId): void {
  const burst = bursts.get(sessionId)

  if (burst === undefined) {
    return
  }

  clearBurstTimer(burst)
  bursts.delete(sessionId)
  releaseRegistrations(burst.routes)
  resolveReceipts(burst.receipts)
}

function cancelPending(pending: Map<SessionId, Set<QueuedTurn>>, sessionId: SessionId): void {
  for (const turn of pending.get(sessionId) ?? []) {
    turn.cancelled = true
    releaseRegistrations(turn.routes)
    resolveReceipts(turn.receipts)
  }
}

function clearBursts(bursts: Map<SessionId, Burst>): void {
  for (const burst of bursts.values()) {
    clearBurstTimer(burst)
    releaseRegistrations(burst.routes)
    rejectReceipts(burst.receipts, new RunHalted('shutdown', 'inbound queue disposed'))
  }

  bursts.clear()
}

function clearBurstTimer(burst: Burst): void {
  if (burst.timer === null) {
    return
  }

  clearTimeout(burst.timer)
  burst.timer = null
}

function clearPending(pending: Map<SessionId, Set<QueuedTurn>>): void {
  for (const turns of pending.values()) {
    for (const turn of turns) {
      turn.cancelled = true
      releaseRegistrations(turn.routes)
      rejectReceipts(turn.receipts, new RunHalted('shutdown', 'inbound queue disposed'))
    }
  }

  pending.clear()
}

function combine(burst: Burst): InboundMessage {
  if (burst.texts.length === 1) {
    return burst.last
  }

  return { ...burst.last, text: burst.texts.join('\n') }
}

function isBurstLimitExceeded(burst: Burst, msg: InboundMessage): boolean {
  return (
    burst.texts.length + 1 > MAX_BURST_MESSAGES || burst.textLen + msg.text.length > MAX_BURST_BYTES
  )
}

async function fire(
  deps: InboundQueueDeps,
  pending: Map<SessionId, Set<QueuedTurn>>,
  turn: Turn
): Promise<void> {
  const queued: QueuedTurn = { ...turn, cancelled: false }
  addPending(pending, queued)

  try {
    if (queued.cancelled) {
      return
    }

    assertIntakeOpen(deps)

    const capped = overCap(deps)

    if (capped) {
      await deps.notify(queued.combined.chatId, t(deps.locale, capped))

      return
    }

    await deps.sessionQueue.enqueue(
      queued.sessionId,
      async () => {
        if (queued.cancelled) {
          return
        }

        assertIntakeOpen(deps)

        await queued.run(queued.combined)
      },
      combineRegistrations(queued.routes)
    )
  } catch (err: unknown) {
    if (await handleDeliberateEnqueueFailure(deps, queued.combined, err)) {
      return
    }

    throw toReceiptError(err)
  } finally {
    releaseRegistrations(queued.routes)
    dropPending(pending, queued)
  }
}

// A turn that meets a closed intake rejects rather than returning: a return would resolve its
// receipt, and the inbox would complete a message nothing answered.
function assertIntakeOpen(deps: InboundQueueDeps): void {
  if (deps.signal.aborted) {
    throw shuttingDown()
  }
}

function shuttingDown(): RunHalted {
  return new RunHalted('shutdown', 'inbound queue is shutting down')
}

function combineRegistrations(
  registrations: readonly SessionRouteRegistration[]
): SessionRouteRegistration {
  let released = false

  return {
    isCurrent: () => registrations.every((registration) => registration.isCurrent()),
    release(): void {
      if (released) {
        return
      }

      released = true
      releaseRegistrations(registrations)
    },
  }
}

function releaseRegistrations(registrations: readonly SessionRouteRegistration[]): void {
  for (const registration of registrations) {
    registration.release()
  }
}

function addPending(pending: Map<SessionId, Set<QueuedTurn>>, turn: QueuedTurn): void {
  const turns = pending.get(turn.sessionId)

  if (turns === undefined) {
    pending.set(turn.sessionId, new Set([turn]))

    return
  }

  turns.add(turn)
}

function dropPending(pending: Map<SessionId, Set<QueuedTurn>>, turn: QueuedTurn): void {
  const turns = pending.get(turn.sessionId)

  if (turns === undefined) {
    return
  }

  turns.delete(turn)

  if (turns.size === 0) {
    pending.delete(turn.sessionId)
  }
}

function overCap(deps: InboundQueueDeps): 'channel.costCapDaily' | 'channel.costCapMonthly' | null {
  const snapshot = deps.costTracker.snapshot(Date.now())

  if (deps.caps.maxDailyUsd > 0 && snapshot.dailySpentUsd >= deps.caps.maxDailyUsd) {
    return 'channel.costCapDaily'
  }

  if (deps.caps.maxMonthlyUsd > 0 && snapshot.monthlySpentUsd >= deps.caps.maxMonthlyUsd) {
    return 'channel.costCapMonthly'
  }

  return null
}

async function handleDeliberateEnqueueFailure(
  deps: InboundQueueDeps,
  combined: InboundMessage,
  err: unknown
): Promise<boolean> {
  // A refusal at shutdown is the daemon pausing the queue, not the chat being busy: it rethrows so
  // the message stays pending instead of being answered "queue full" and completed.
  if (err instanceof RunHalted && err.code === 'queue_full' && !deps.signal.aborted) {
    await deps.notify(combined.chatId, t(deps.locale, 'channel.queueFull'))

    return true
  }

  return false
}

function createDeferred(): Deferred {
  let resolvePromise: () => void = () => undefined
  let rejectPromise: (error: Error) => void = () => undefined
  let settled = false
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })

  return {
    promise,
    resolve(): void {
      if (settled) {
        return
      }
      settled = true
      resolvePromise()
    },
    reject(error): void {
      if (settled) {
        return
      }
      settled = true
      rejectPromise(error)
    },
  }
}

function resolveReceipts(receipts: readonly Deferred[]): void {
  for (const receipt of receipts) {
    receipt.resolve()
  }
}

function rejectReceipts(receipts: readonly Deferred[], error: Error): void {
  for (const receipt of receipts) {
    receipt.reject(error)
  }
}

function toReceiptError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error
  }

  return new RunHalted('llm_error', `inbound exchange failed: ${formatErrForLog(error).message}`)
}
