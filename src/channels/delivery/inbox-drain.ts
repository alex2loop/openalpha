import { randomUUID } from 'node:crypto'

import type { InboundHandler } from '@/channels/delivery/inbound'
import type {
  ChannelCallbackQuery,
  InboundInbox,
  InboundInboxEntry,
  InboundMessage,
  InboxPayload,
} from '@/channels/types'
import type { ChannelId } from '@/core/channels'
import type { Logger } from '@/core/logging/logger'
import { AnswerUndelivered, decodeAnswer, encodeAnswer } from '@/channels/delivery/answer'
import { callbackMessageId } from '@/channels/delivery/inbound'
import { channelId } from '@/core/channels'
import { ChannelError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { isPlainRecord } from '@/core/utils/collections'
import { computeBackoffMs } from '@/core/utils/retry'
import { sleep } from '@/core/utils/time'

const INBOX_DRAIN_INTERVAL_MS = 250
const INBOX_CLAIM_LIMIT = 32
// A failed attempt backs off so a network blip is outlasted instead of spending every attempt inside
// the drain interval.
const INBOX_RETRY_BASE_MS = 10_000
const INBOX_RETRY_CAP_MS = 300_000
const INBOX_RECOVERY_INTERVAL_MS = 60_000
// A delivery holds its entry for the whole agent run, so the lease must outlast the run cap or
// recovery would requeue live work. The slack covers the queue wait ahead of the run itself.
const INBOX_LEASE_SLACK_MS = 300_000
const INBOX_CLAIM_RENEW_INTERVAL_MS = 60_000
// The loop does not await a delivery, so this is what bounds the claims a stalled chat can hold.
const MAX_IN_FLIGHT_DELIVERIES = 128
const STALLED_DELIVERY_ERROR = 'delivery stalled past processing lease'

interface InboxDrainDeps {
  readonly handler: InboundHandler
  readonly inbox: InboundInbox
  readonly inboxMaxAttempts: number
  readonly runMaxDurationMs: number
  readonly channelId: ChannelId
  readonly logger: Logger
  readonly signal: AbortSignal
}

interface ClaimedEntry {
  readonly entry: InboundInboxEntry
  readonly token: string
}

interface ClaimedBatch {
  readonly entries: readonly InboundInboxEntry[]
  readonly token: string
}

interface DrainState {
  readonly batches: Set<Promise<void>>
  heldEntries: number
}

// The only recovery path: an entry abandoned by a dead daemon waits out its lease rather than
// being reclaimed at startup, where nothing can tell it apart from another daemon's live work.
export async function runInboxDrain(deps: InboxDrainDeps): Promise<void> {
  const state: DrainState = { batches: new Set(), heldEntries: 0 }
  let recoverDueAt = 0

  while (!deps.signal.aborted) {
    const now = Date.now()

    if (now >= recoverDueAt) {
      recoverDueAt = now + INBOX_RECOVERY_INTERVAL_MS
      await recoverStalled(deps, now)
    }

    await drainBatch(deps, state)

    try {
      await sleep(INBOX_DRAIN_INTERVAL_MS, deps.signal)
    } catch (err: unknown) {
      if (!deps.signal.aborted) {
        throw err
      }
    }
  }

  await Promise.allSettled([...state.batches])
}

async function recoverStalled(deps: InboxDrainDeps, now: number): Promise<void> {
  try {
    const recovered = await deps.inbox.recoverStalled({
      channel: deps.channelId,
      error: STALLED_DELIVERY_ERROR,
      recoveredAt: now,
      maxAttempts: deps.inboxMaxAttempts,
      stalledBefore: now - (deps.runMaxDurationMs + INBOX_LEASE_SLACK_MS),
    })

    if (recovered.requeued > 0 || recovered.deadLettered > 0) {
      deps.logger.warn('channel.inbox_stalled_recovered', {
        channel: deps.channelId,
        requeued: recovered.requeued,
        deadLettered: recovered.deadLettered,
      })
    }
  } catch (err: unknown) {
    deps.logger.warn('channel.inbox_recovery_failed', {
      channel: deps.channelId,
      err: formatErrForLog(err),
    })
  }
}

// Started, never awaited: a delivery holds its entry for the whole run, and the callback that
// answers an approval prompt only arrives on a later claim.
async function drainBatch(deps: InboxDrainDeps, state: DrainState): Promise<void> {
  const limit = Math.min(INBOX_CLAIM_LIMIT, MAX_IN_FLIGHT_DELIVERIES - state.heldEntries)

  if (limit <= 0) {
    return
  }

  try {
    const token = randomUUID()
    const entries = await deps.inbox.claimPending({
      channel: deps.channelId,
      limit,
      startedAt: Date.now(),
      token,
    })

    if (entries.length > 0) {
      startBatch(deps, state, { entries, token })
    }
  } catch (err: unknown) {
    deps.logger.warn('inbound.drain_failed', {
      channel: deps.channelId,
      err: formatErrForLog(err),
    })
  }
}

function startBatch(deps: InboxDrainDeps, state: DrainState, batch: ClaimedBatch): void {
  state.heldEntries += batch.entries.length

  const running: Promise<void> = runBatch(deps, batch).finally(() => {
    state.heldEntries -= batch.entries.length
    state.batches.delete(running)
  })

  state.batches.add(running)
}

async function runBatch(deps: InboxDrainDeps, batch: ClaimedBatch): Promise<void> {
  const { entries, token } = batch
  const outcomes = await withClaimRenewal(deps, token, () =>
    Promise.allSettled(entries.map((entry) => dispatchEntry(deps, { entry, token })))
  )

  for (const outcome of outcomes) {
    if (outcome.status === 'rejected') {
      deps.logger.warn('inbound.status_persist_failed', {
        channel: deps.channelId,
        err: formatErrForLog(outcome.reason),
      })
    }
  }
}

// An approval pauses the run deadline, so a live dispatch can outlast the stall cutoff. Renewing
// keeps its entry owned; only a dead daemon stops renewing.
async function withClaimRenewal<T>(
  deps: InboxDrainDeps,
  token: string,
  dispatch: () => Promise<T>
): Promise<T> {
  const timer = setInterval(() => {
    deps.inbox
      .renewClaims({ channel: deps.channelId, token, renewedAt: Date.now() })
      .catch((err: unknown) => {
        deps.logger.warn('channel.inbox_renew_failed', {
          channel: deps.channelId,
          err: formatErrForLog(err),
        })
      })
  }, INBOX_CLAIM_RENEW_INTERVAL_MS)
  timer.unref()

  try {
    return await dispatch()
  } finally {
    clearInterval(timer)
  }
}

/** Delivery is at-least-once by design. The handler runs to completion before `complete` records
 *  it, so a daemon that dies in between leaves the entry claimed, and recovery hands it back once
 *  the lease expires — the run is executed again. Nothing here can tell that apart from a daemon
 *  that died before the handler started, and dedup at accept time keys on the update, not on the
 *  effect. The cost is a duplicate reply and its spend; the alternative loses operator messages.
 *  A repeat crash loop on the same entry cannot spend without limit: `attempt_count` increments on
 *  every claim (recoverStalled included), and once it reaches `inboxMaxAttempts` the row is
 *  dead-lettered instead of requeued — see the shared `recoverStalled`/`failAttempt` transition in
 *  the inbox store.
 *
 *  Execution is at-most-once once a run has finished: a failed final write keeps the answer on the
 *  entry (`failAttempt`), and the retry sends that instead of running the agent again. A daemon
 *  that dies during the final write never recorded the answer, so that window still re-runs. */
async function dispatchEntry(deps: InboxDrainDeps, claimed: ClaimedEntry): Promise<void> {
  const { entry, token } = claimed

  try {
    await processEntry(deps, entry)

    const completion = await deps.inbox.complete({
      channel: deps.channelId,
      updateId: entry.updateId,
      completedAt: Date.now(),
      token,
    })

    if (completion === 'lost') {
      logClaimLost(deps, entry.updateId)
    }
  } catch (err: unknown) {
    await failEntry(deps, claimed, err)
  }
}

async function processEntry(deps: InboxDrainDeps, entry: InboundInboxEntry): Promise<void> {
  const payload = parseInboxPayload(entry.payload)

  if (payloadChannel(payload) !== deps.channelId) {
    throw invalidPayload('payload channel does not match its inbox row')
  }

  if (entry.answer !== null) {
    await resendAnswer(deps, payload, entry.answer)

    return
  }

  if (payload.kind === 'message') {
    await deps.handler.handleMessage(payload.msg)
  } else {
    await deps.handler.handleCallback(payload.cq)
  }
}

// Entries of one burst were answered by a single reply, so each stored the same answer and only
// the entry that anchored the exchange sends it.
async function resendAnswer(
  deps: InboxDrainDeps,
  payload: InboxPayload,
  encoded: string
): Promise<void> {
  const answer = decodeAnswer(encoded)

  if (answer === undefined) {
    throw invalidPayload('stored answer shape is invalid')
  }

  if (answer.anchorMessageId === inboundMessageId(payload)) {
    await deps.handler.redeliver(answer)
  }
}

async function failEntry(deps: InboxDrainDeps, claimed: ClaimedEntry, err: unknown): Promise<void> {
  const { entry, token } = claimed

  // Shutdown never processed the message, so the entry goes back untouched rather than spending
  // an attempt it could be dead-lettered for. A run that finished keeps its answer even so:
  // running it again would repeat its tool effects.
  if (deps.signal.aborted && !hasFinishedRun(err)) {
    await deps.inbox.releaseClaim({
      channel: deps.channelId,
      updateId: entry.updateId,
      token,
    })

    return
  }

  const error = formatErrForLog(err).message
  const answer = keptAnswer(deps, entry.updateId, err)
  const failedAt = Date.now()
  const disposition = await deps.inbox.failAttempt({
    channel: deps.channelId,
    updateId: entry.updateId,
    token,
    error,
    failedAt,
    maxAttempts: deps.inboxMaxAttempts,
    retryAt:
      failedAt + computeBackoffMs(entry.attemptCount, INBOX_RETRY_BASE_MS, INBOX_RETRY_CAP_MS),
    ...(answer === undefined ? {} : { answer }),
  })

  if (disposition === 'lost') {
    logClaimLost(deps, entry.updateId)
    return
  }

  if (disposition === 'dead-lettered') {
    deps.logger.warn('channel.inbox_dead_lettered', {
      channel: deps.channelId,
      updateId: entry.updateId,
      error,
    })
  }
}

function hasFinishedRun(err: unknown): boolean {
  return err instanceof AnswerUndelivered && err.answer.completed
}

function keptAnswer(deps: InboxDrainDeps, updateId: string, err: unknown): string | undefined {
  if (!(err instanceof AnswerUndelivered)) {
    return undefined
  }

  const encoded = encodeAnswer(err.answer)

  if (encoded === undefined) {
    deps.logger.warn('channel.inbox_answer_oversized', { channel: deps.channelId, updateId })
  }

  return encoded
}

// The entry ran twice: recovery requeued it mid-delivery and another claim now owns the row.
function logClaimLost(deps: InboxDrainDeps, updateId: string): void {
  deps.logger.warn('channel.inbox_claim_lost', { channel: deps.channelId, updateId })
}

function inboundMessageId(payload: InboxPayload): string {
  return payload.kind === 'message' ? payload.msg.messageId : callbackMessageId(payload.cq)
}

function payloadChannel(payload: InboxPayload): ChannelId {
  return payload.kind === 'message' ? payload.msg.channel : payload.cq.channel
}

function parseInboxPayload(raw: string): InboxPayload {
  const parsed: unknown = JSON.parse(raw)

  if (!isPlainRecord(parsed)) {
    throw invalidPayload('payload must be an object')
  }

  if (parsed.kind === 'message') {
    const msg = toInboundMessage(parsed.msg)

    if (msg !== undefined) {
      return { kind: 'message', msg }
    }
  }

  if (parsed.kind === 'callback') {
    const cq = toCallbackQuery(parsed.cq)

    if (cq !== undefined) {
      return { kind: 'callback', cq }
    }
  }

  throw invalidPayload('payload shape is invalid')
}

function toInboundMessage(value: unknown): InboundMessage | undefined {
  if (!isPlainRecord(value)) {
    return undefined
  }

  if (
    typeof value.channel === 'string' &&
    typeof value.chatId === 'string' &&
    typeof value.userId === 'string' &&
    typeof value.text === 'string' &&
    typeof value.messageId === 'string' &&
    typeof value.receivedAt === 'number' &&
    Number.isFinite(value.receivedAt) &&
    isOptionalBoolean(value.isGroup) &&
    isOptionalBoolean(value.addressedToBot) &&
    isOptionalString(value.reactionRef)
  ) {
    return {
      channel: channelId(value.channel),
      chatId: value.chatId,
      userId: value.userId,
      text: value.text,
      messageId: value.messageId,
      receivedAt: value.receivedAt,
      ...(typeof value.reactionRef === 'string' ? { reactionRef: value.reactionRef } : {}),
      ...(typeof value.isGroup === 'boolean' ? { isGroup: value.isGroup } : {}),
      ...(typeof value.addressedToBot === 'boolean'
        ? { addressedToBot: value.addressedToBot }
        : {}),
    }
  }

  return undefined
}

function toCallbackQuery(value: unknown): ChannelCallbackQuery | undefined {
  if (!isPlainRecord(value)) {
    return undefined
  }

  if (
    typeof value.channel === 'string' &&
    typeof value.id === 'string' &&
    typeof value.data === 'string' &&
    typeof value.from === 'string' &&
    isOptionalString(value.messageId) &&
    isOptionalString(value.chatId) &&
    isOptionalBoolean(value.isGroup)
  ) {
    return {
      channel: channelId(value.channel),
      id: value.id,
      data: value.data,
      from: value.from,
      ...(typeof value.messageId === 'string' ? { messageId: value.messageId } : {}),
      ...(typeof value.chatId === 'string' ? { chatId: value.chatId } : {}),
      ...(typeof value.isGroup === 'boolean' ? { isGroup: value.isGroup } : {}),
    }
  }

  return undefined
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean'
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function invalidPayload(message: string): ChannelError {
  return new ChannelError('get_updates_failed', `invalid inbox payload: ${message}`)
}
