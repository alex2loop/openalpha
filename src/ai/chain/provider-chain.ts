import type { Pricing } from '@/ai/cost/pricing'
import type { ChainEntry } from '@/ai/types'
import type { ResolvedLlm } from '@/core/config/resolve'
import type { EventBus } from '@/core/events'
import type {
  LLMErrorCode,
  LLMRequest,
  LLMRequestOrigin,
  ProviderAttempt,
  ProviderAttemptObserver,
  ProviderChain,
  ProviderResponse,
} from '@/core/llm'
import type { Logger } from '@/core/logging/logger'
import type { OnStreamEvent, StreamEvent } from '@/core/stream-events'
import { TRANSPORTS } from '@/ai/adapters/registry'
import {
  type AttemptResult,
  createAttemptLedger,
  runProviderAttempt,
  toFailedAttempt,
} from '@/ai/chain/attempt-ledger'
import { attemptCeiling, estimateChainCeiling } from '@/ai/chain/cost-ceiling'
import { buildEntryKey, isEntryOnCooldown, orderAfterCooldownWait } from '@/ai/chain/entry-order'
import { attachProviderAttempts, LLMError, markInterruptedVisibleOutput } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { type CooldownTracker, withCooldown } from '@/core/utils/concurrency'
import { repairToolPairs } from '@/core/utils/message'

declare module '@/core/events' {
  interface BusEventMap {
    provider_fallback: {
      readonly from: string
      readonly to: string
      readonly reason: LLMErrorCode
      readonly attempt: number
      readonly channel: string
      readonly sessionId: LLMRequestOrigin['sessionId']
      readonly chatId?: string
    }
  }
}

// A model id the provider does not serve will not fix itself mid-process; skip until restart.
const PERMANENT_COOLDOWN_MS = Number.POSITIVE_INFINITY

// `rate` is deliberately absent: a window the provider just refused does not reopen within a
// backoff, so re-asking the same endpoint only spends the attempt ceiling the fallback needs.
const RETRYABLE_CODES: ReadonlySet<LLMErrorCode> = new Set([
  'transient',
  'timeout',
  'empty_response',
])

// Wider than the same-entry retry set, but `context_overflow`, `response_too_large`, and
// unhinted `fatal` stay out: they reflect request-wide problems the next entry cannot fix.
const FALLBACK_CODES: ReadonlySet<LLMErrorCode> = new Set([
  'transient',
  'rate',
  'timeout',
  'empty_response',
  'output_budget_exhausted',
  'auth',
  'billing',
  'not_found',
])

// What the cooldown is recorded against. Credentials and billing span every model behind one
// provider and clear after a configured pause so a fixed key or topped-up bill is retried; a
// refused window, a stall and a retired model id are facts about the one entry.
const PROVIDER_CREDENTIAL_CODES: ReadonlySet<LLMErrorCode> = new Set(['auth', 'billing'])
const ENTRY_PERMANENT_CODES: ReadonlySet<LLMErrorCode> = new Set(['not_found'])

// An availability signal only. `empty_response` and `output_budget_exhausted` stay fallback-capable
// but cool nothing: they reflect request output quality, not availability, so cooling on them would
// poison the entry for the next user turn. `output_budget_exhausted` is also absent from
// RETRYABLE_CODES — a model that spent its output cap on reasoning spends it again on the identical
// call, so only a different entry can help.
const ENTRY_COOLDOWN_CODES: ReadonlySet<LLMErrorCode> = new Set(['transient', 'rate', 'timeout'])

const ANSWER_EVENTS: ReadonlySet<StreamEvent['type']> = new Set([
  'text_delta',
  'tool_call_start',
  'tool_call_args_delta',
])
const REASONING_EVENTS: ReadonlySet<StreamEvent['type']> = new Set([
  'reasoning_delta',
  'thinking_block',
])

interface ProviderChainDeps {
  readonly entries: readonly ChainEntry[]
  readonly logger: Logger
  readonly tuning: ResolvedLlm
  readonly pricing: Pricing
  /** Absent for a chain built outside the daemon (doctor, one-shot probes). */
  readonly bus?: EventBus
}

interface ChainRunContext {
  readonly onEvent: OnStreamEvent
  readonly logger: Logger
  readonly tracker: CooldownTracker
  readonly tuning: ResolvedLlm
  readonly observer?: ProviderAttemptObserver
  readonly bus?: EventBus
  readonly origin?: LLMRequestOrigin
}

interface EmitGate {
  readonly emit: OnStreamEvent
  readonly isEmitted: () => boolean
}

interface FallbackInput {
  readonly ctx: ChainRunContext
  readonly ordered: readonly ChainEntry[]
  readonly index: number
  readonly entry: ChainEntry
  readonly gate: EmitGate
  readonly settle: (attempt: ProviderAttempt) => Promise<void>
  readonly error: LLMError
}

interface EntryContext {
  readonly emit: OnStreamEvent
  readonly isEmitted: () => boolean
  readonly nextAttemptId: () => number
  readonly onRetry: (attempt: ProviderAttempt) => Promise<void>
  readonly onTerminal: (attempt: ProviderAttempt) => Promise<void>
  readonly tuning: ResolvedLlm
}

type EntryResult =
  | { readonly kind: 'success'; readonly result: AttemptResult }
  | { readonly kind: 'failure'; readonly error: LLMError }

export function createProviderChain(deps: ProviderChainDeps): ProviderChain {
  // Per-chain, not module scope: two concurrently-built chains must not share failure history.
  const tracker = withCooldown(deps.tuning.transientCooldownMs)

  return {
    async stream(req, onEvent, observer) {
      if (deps.entries.length === 0) {
        throw new LLMError('fatal', 'provider chain has no entries')
      }

      // Every transport reaches the wire through here, so pairing is enforced once rather than
      // per adapter.
      const request: LLMRequest = { ...req, messages: repairToolPairs(req.messages) }

      const ordered = await orderAfterCooldownWait({
        entries: deps.entries,
        tracker,
        req: request,
        tuning: deps.tuning,
        logger: deps.logger,
      })

      return runChain(ordered, request, {
        onEvent,
        logger: deps.logger,
        tracker,
        tuning: deps.tuning,
        ...(observer === undefined ? {} : { observer }),
        ...(deps.bus === undefined ? {} : { bus: deps.bus }),
        ...(request.origin === undefined ? {} : { origin: request.origin }),
      })
    },
    estimateMaxCost: (input) =>
      estimateChainCeiling(
        { entries: deps.entries, tuning: deps.tuning, pricing: deps.pricing },
        input
      ),
  }
}

async function runChain(
  ordered: readonly ChainEntry[],
  req: LLMRequest,
  ctx: ChainRunContext
): Promise<ProviderResponse> {
  const gate = createEmitGate(req, ctx.onEvent)
  const ledger = createAttemptLedger(
    attemptCeiling(ordered.length, ctx.tuning, req.outputContract !== undefined)
  )
  // Every finalized attempt lands in the transient ledger and then in the observer's durable
  // record — a rejected observation aborts the chain before another paid request can start.
  const settle = async (attempt: ProviderAttempt): Promise<void> => {
    ledger.append(attempt)
    await ctx.observer?.(attempt)
  }
  let lastError: LLMError | undefined

  try {
    for (const [index, entry] of ordered.entries()) {
      // An entry cooled by an earlier failure in this chain must not be force-tried.
      if (isEntryOnCooldown(entry, ctx.tracker)) {
        continue
      }

      const entryResult = await runEntry(entry, req, {
        emit: gate.emit,
        isEmitted: gate.isEmitted,
        nextAttemptId: ledger.nextId,
        onRetry: async (retryAttempt) => {
          await settle(retryAttempt)
          gate.emit({ type: 'provider_attempt_failed', ...retryAttempt })
        },
        onTerminal: settle,
        tuning: ctx.tuning,
      })

      if (entryResult.kind === 'success') {
        recordEntrySuccess(entry, ctx)
        await settle(entryResult.result.attempt)

        return {
          ...entryResult.result.response,
          model: entry.model,
          providerModel: { provider: entry.provider.id, model: entry.model },
          attempts: ledger.snapshot(),
        }
      }

      lastError = await fallbackOrThrow({
        ctx,
        ordered,
        index,
        entry,
        gate,
        settle,
        error: entryResult.error,
      })
    }

    throw lastError ?? new LLMError('fatal', 'provider chain exhausted')
  } catch (err: unknown) {
    throw attachProviderAttempts(err, ledger.snapshot())
  }
}

// Hidden output never counts as emitted: a chain that has shown the user nothing may still fall
// back to another provider.
function createEmitGate(req: LLMRequest, onEvent: OnStreamEvent): EmitGate {
  let emitted = false

  return {
    emit: (event: StreamEvent) => {
      const hiddenAnswer = req.answerVisibility === 'hidden' && ANSWER_EVENTS.has(event.type)
      const hiddenReasoning =
        req.reasoningVisibility === 'hidden' && REASONING_EVENTS.has(event.type)

      if (hiddenAnswer || hiddenReasoning) {
        return
      }

      if (ANSWER_EVENTS.has(event.type) || REASONING_EVENTS.has(event.type)) {
        emitted = true
      }

      onEvent(event)
    },
    isEmitted: () => emitted,
  }
}

// Rethrows once output has reached the caller or nothing usable remains — past that point this
// provider's failure is the chain's.
async function fallbackOrThrow(input: FallbackInput): Promise<LLMError> {
  const { ctx, entry, error, gate, settle } = input

  logProviderError(entry, error, ctx.logger)
  recordEntryFailure(error, entry, ctx)

  const next = nextUsableEntry(input.ordered, input.index, ctx.tracker)
  const canAdvance = canFallback(error) && next !== undefined

  if (gate.isEmitted() || !canAdvance) {
    await settle(toFailedAttempt(error, 'terminal_failure'))

    // canAdvance here means only the emitted output blocked the fallback - the one refusal the
    // engine may recover from with a fresh turn.
    if (canAdvance) {
      throw markInterruptedVisibleOutput(error)
    }

    throw error
  }

  const failed = toFailedAttempt(error, 'fallback')

  await settle(failed)
  gate.emit({ type: 'provider_attempt_failed', ...failed })
  announceFallback(ctx, error, { failed: entry, next, attempt: input.index + 1 })

  return error
}

// Cooling is recorded per failure, so the raw next configured entry may already be unusable.
function nextUsableEntry(
  ordered: readonly ChainEntry[],
  index: number,
  tracker: CooldownTracker
): ChainEntry | undefined {
  return ordered.slice(index + 1).find((candidate) => !isEntryOnCooldown(candidate, tracker))
}

async function runEntry(
  entry: ChainEntry,
  req: LLMRequest,
  input: EntryContext
): Promise<EntryResult> {
  try {
    const result = await runProviderAttempt({
      entry,
      req,
      transport: TRANSPORTS[entry.provider.transport],
      emit: input.emit,
      nextAttemptId: input.nextAttemptId,
      onRetry: input.onRetry,
      onTerminal: input.onTerminal,
      maxRetries: input.tuning.maxRetries,
      retryBackoffMs: input.tuning.retryBackoffMs,
      isRetryable: (err) => !input.isEmitted() && RETRYABLE_CODES.has(err.code),
    })

    return { kind: 'success', result }
  } catch (err: unknown) {
    if (!(err instanceof LLMError)) {
      throw err
    }

    return { kind: 'failure', error: err }
  }
}

function announceFallback(
  ctx: ChainRunContext,
  err: LLMError,
  move: {
    readonly failed: ChainEntry
    readonly next: ChainEntry | undefined
    readonly attempt: number
  }
): void {
  if (move.next === undefined) {
    return
  }

  const event: StreamEvent = {
    type: 'provider_fallback',
    from: buildEntryKey(move.failed),
    to: buildEntryKey(move.next),
    reason: err.code,
    attempt: move.attempt,
  }

  if (ctx.bus !== undefined && ctx.origin !== undefined) {
    ctx.bus.emit('provider_fallback', { ...event, ...ctx.origin })
  }
  ctx.onEvent(event)
}

function canFallback(err: LLMError): boolean {
  return err.fallbackAllowed || FALLBACK_CODES.has(err.code)
}

// A served request clears both scopes: the credentials worked and the model answered.
function recordEntrySuccess(entry: ChainEntry, ctx: ChainRunContext): void {
  ctx.tracker.recordSuccess(entry.provider.id)
  ctx.tracker.recordSuccess(buildEntryKey(entry))
}

function recordEntryFailure(err: LLMError, entry: ChainEntry, ctx: ChainRunContext): void {
  if (PROVIDER_CREDENTIAL_CODES.has(err.code)) {
    ctx.tracker.recordFailure(entry.provider.id, ctx.tuning.credentialCooldownMs)
    return
  }

  if (ENTRY_PERMANENT_CODES.has(err.code)) {
    ctx.tracker.recordFailure(buildEntryKey(entry), PERMANENT_COOLDOWN_MS)
    return
  }

  if (!ENTRY_COOLDOWN_CODES.has(err.code)) {
    return
  }

  const cooldownMs = Math.max(ctx.tuning.transientCooldownMs, err.retryAfterMs ?? 0)
  ctx.tracker.recordFailure(buildEntryKey(entry), cooldownMs)
}

function logProviderError(entry: ChainEntry, err: LLMError, logger: Logger): void {
  logger.warn('llm.provider_error', {
    provider: entry.provider.id,
    model: entry.model,
    code: err.code,
    err: formatErrForLog(err),
  })
}
