import type { AdapterHandlers, InboundInbox } from '@/channels/types'
import type { PollOffsetStore } from '@/core/types/session'
import { acceptInbound } from '@/channels/delivery/inbox-accept'
import { channelId } from '@/core/channels'
import { formatErrForLog } from '@/core/security/credentials'
import { sleep } from '@/core/utils/time'

import type { TelegramApiContext } from './client'
import type { BotIdentity, TelegramUpdate } from './protocol'
import { answerCallbackQuery, deleteWebhook, getUpdates, telegramErrorStatus } from './client'
import { parseUpdate } from './protocol'

const POLL_CHANNEL = channelId('telegram')
// Kept under the request timeout so our abort never races Telegram's long-poll.
const TELEGRAM_POLL_TIMEOUT_SEC = 10
const POLL_BACKOFF_INITIAL_MS = 1_000
const POLL_BACKOFF_MAX_MS = 30_000
const AUTH_FAILURE_THRESHOLD = 3
const CONFLICT_STATUS = 409
const UNAUTHORIZED_STATUS = 401
const FORBIDDEN_STATUS = 403

interface PollDeps {
  readonly api: TelegramApiContext
  readonly handlers: AdapterHandlers
  readonly pollOffsets: PollOffsetStore
  readonly inbox: InboundInbox
  readonly botIdentity: BotIdentity | undefined
  readonly signal: AbortSignal
}

interface PollState {
  offset: number
  backoffMs: number
  authFailures: number
  connected: boolean
}

// Runs until `deps.signal` aborts or the token is declared dead (repeated 401/403).
export async function runPollLoop(deps: PollDeps): Promise<void> {
  await deleteWebhook(deps.api)

  const state: PollState = {
    offset: (await deps.pollOffsets.get(POLL_CHANNEL)) ?? 0,
    backoffMs: POLL_BACKOFF_INITIAL_MS,
    authFailures: 0,
    connected: false,
  }

  while (!deps.signal.aborted) {
    const stop = await pollIteration(deps, state)

    if (stop) {
      return
    }
  }
}

async function pollIteration(deps: PollDeps, state: PollState): Promise<boolean> {
  try {
    const updates = await getUpdates(deps.api, {
      offset: state.offset,
      timeoutSec: TELEGRAM_POLL_TIMEOUT_SEC,
    })

    await processUpdates(deps, state, updates)
    onPollSuccess(deps, state)

    return false
  } catch (err: unknown) {
    return await onPollFailure(deps, state, err)
  }
}

async function processUpdates(
  deps: PollDeps,
  state: PollState,
  updates: readonly TelegramUpdate[]
): Promise<void> {
  for (const update of updates) {
    // Throws only when the durable write fails; a parse failure is dropped inside and returns. That
    // throw must reach onPollFailure's backoff uncaught, because Telegram never redelivers an offset
    // already confirmed below.
    await dispatchUpdate(deps, update)

    const nextOffset = update.update_id + 1

    // Always advances: a poison update must never wedge the offset. Assignment happens only after
    // the durable checkpoint succeeds, so an in-process retry cannot skip a failed write.
    await deps.pollOffsets.set(POLL_CHANNEL, nextOffset)
    state.offset = nextOffset
  }
}

// Persist-then-advance: every normalized event lands in the durable inbox (deduped by update_id)
// before the upstream offset moves, so a crash loses nothing and a redelivery is a no-op. The channel
// runtime claims and dispatches these asynchronously — the poll loop never calls the in-memory handler.
async function dispatchUpdate(deps: PollDeps, update: TelegramUpdate): Promise<void> {
  let msg: ReturnType<typeof parseUpdate>['msg']
  let cq: ReturnType<typeof parseUpdate>['cq']

  try {
    const parsed = parseUpdate(update, deps.botIdentity)
    msg = parsed.msg
    cq = parsed.cq
  } catch (err: unknown) {
    deps.api.logger.warn('telegram.poll_parse_failed', {
      updateId: update.update_id,
      err: formatErrForLog(err),
    })

    // A poison update must not wedge the offset; let the caller advance past it.
    return
  }

  const acceptedAt = Date.now()

  if (msg && canStore(deps, msg.chatId, msg.userId)) {
    await acceptInbound({
      inbox: deps.inbox,
      channel: POLL_CHANNEL,
      updateId: update.update_id.toString(),
      payload: { kind: 'message', msg },
      acceptedAt,
    })
  }

  if (cq && canStore(deps, cq.chatId, cq.from)) {
    await acceptInbound({
      inbox: deps.inbox,
      channel: POLL_CHANNEL,
      updateId: `${update.update_id.toString()}:cq`,
      payload: { kind: 'callback', cq },
      acceptedAt,
    })

    // Telegram shows a spinner on the tapped button until this is answered; fire-and-forget so a slow/failed ack does not block the poll loop.
    // Sent only after the callback is durable, so a DB failure cannot lose it.
    answerCallbackQuery(deps.api, cq.id).catch(() => undefined)
  }
}

// An update from a chat no admission rule could let in never reaches the inbox, so a stranger
// cannot grow it; the gate stays the one place that decides who is admitted.
function canStore(deps: PollDeps, chatId: string | undefined, userId: string): boolean {
  return chatId === undefined || (deps.handlers.canAdmit?.(chatId, userId) ?? true)
}

function onPollSuccess(deps: PollDeps, state: PollState): void {
  state.backoffMs = POLL_BACKOFF_INITIAL_MS
  state.authFailures = 0

  if (!state.connected) {
    state.connected = true
    deps.handlers.setStatus({ connected: true, lastError: null })
  }
}

async function onPollFailure(deps: PollDeps, state: PollState, err: unknown): Promise<boolean> {
  if (deps.signal.aborted) {
    return true
  }

  const status = telegramErrorStatus(err)

  if (status === CONFLICT_STATUS) {
    // Another poller or a leftover webhook — never reset the durable offset over this; just log and let the backoff absorb it.
    deps.api.logger.warn('telegram.poll_conflict', { offset: state.offset })
  } else if (status === UNAUTHORIZED_STATUS || status === FORBIDDEN_STATUS) {
    if (handleAuthFailure(deps, state, err)) {
      return true
    }
  } else {
    state.authFailures = 0
  }

  markDisconnected(deps, state, err)

  return await backoffAndContinue(deps, state)
}

// Returns true when the loop should stop: a dead token retried forever just hammers the API.
function handleAuthFailure(deps: PollDeps, state: PollState, err: unknown): boolean {
  state.authFailures += 1

  if (state.authFailures < AUTH_FAILURE_THRESHOLD) {
    return false
  }

  const message = formatErrForLog(err).message
  deps.handlers.setStatus({ connected: false, lastError: message })
  deps.api.logger.error('telegram.auth_failure_threshold', { authFailures: state.authFailures })

  return true
}

function markDisconnected(deps: PollDeps, state: PollState, err: unknown): void {
  deps.api.logger.warn('telegram.poll_error', {
    err: formatErrForLog(err),
    backoffMs: state.backoffMs,
  })

  if (state.connected) {
    state.connected = false
    deps.handlers.setStatus({ connected: false, lastError: formatErrForLog(err).message })
  }
}

async function backoffAndContinue(deps: PollDeps, state: PollState): Promise<boolean> {
  try {
    await sleep(state.backoffMs, deps.signal)
  } catch {
    return true // aborted while backing off
  }

  state.backoffMs = Math.min(state.backoffMs * 2, POLL_BACKOFF_MAX_MS)

  return false
}
