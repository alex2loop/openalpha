import type { AdapterHandlers, InboundInbox, InboundMessage } from '@/channels/types'
import type { Logger } from '@/core/logging/logger'
import { acceptInbound } from '@/channels/delivery/inbox-accept'
import { formatErrForLog } from '@/core/security/credentials'

import type { FetchFn, ZaloApiResponse, ZaloEvent } from './client'
import {
  deleteWebhook,
  getUpdates,
  toEpochMs,
  ZALO_LONG_POLL_TIMEOUT_SEC,
  ZALO_UNAUTHORIZED_CODE,
} from './client'
import { ZALO_CHANNEL_ID } from './config'

const AUTH_FAILURE_THRESHOLD = 3
const POLL_BACKOFF_INITIAL_MS = 1_000
const POLL_BACKOFF_MAX_MS = 30_000
const POLL_BACKOFF_FACTOR = 2
const LONG_POLL_TIMEOUT_ERROR_CODE = 408
const INBOX_ACCEPT_MAX_ATTEMPTS = 3

interface ZaloPollDeps {
  readonly token: string
  readonly handlers: AdapterHandlers
  readonly inbox: InboundInbox
  readonly signal: AbortSignal
  readonly logger: Logger
  readonly fetchImpl?: FetchFn
}

interface PollState {
  backoffMs: number
  authFailures: number
}

export async function runZaloPollLoop(deps: ZaloPollDeps): Promise<void> {
  await clearWebhook(deps)

  const state: PollState = {
    backoffMs: POLL_BACKOFF_INITIAL_MS,
    authFailures: 0,
  }

  while (!deps.signal.aborted) {
    const stop = await pollOnce(deps, state)

    if (stop) {
      return
    }
  }
}

// A failure here is logged, not fatal: the poll that follows reports a webhook still standing.
async function clearWebhook(deps: ZaloPollDeps): Promise<void> {
  const res: ZaloApiResponse<unknown> = await deleteWebhook(transportOf(deps)).catch(
    (err: unknown) => ({ ok: false, description: formatErrForLog(err).message })
  )

  if (res.ok || deps.signal.aborted) {
    return
  }

  deps.logger.warn('zalo.delete_webhook_failed', {
    errorCode: res.error_code,
    description: res.description,
  })
}

async function pollOnce(deps: ZaloPollDeps, state: PollState): Promise<boolean> {
  const res = await fetchUpdate(deps, state)

  if (!res) {
    return false
  }

  if (!res.ok) {
    return handlePollFailure(deps, state, res)
  }

  const outcome = await acceptEvent(deps, state, res.result)

  if (outcome === 'aborted') {
    return true
  }

  if (outcome === 'dropped') {
    return false
  }

  resetPollState(state)
  deps.handlers.setStatus({ connected: true, lastError: null })
  return false
}

function resetPollState(state: PollState): void {
  state.authFailures = 0
  state.backoffMs = POLL_BACKOFF_INITIAL_MS
}

type AcceptOutcome = 'accepted' | 'dropped' | 'aborted'

// Zalo hands an event to one long-poll and offers no cursor to hold, so unlike Telegram there is no
// offset to leave unadvanced: a write that fails here is the only chance the message gets. Retrying
// the same event costs nothing — the next poll cannot return it again.
async function acceptEvent(
  deps: ZaloPollDeps,
  state: PollState,
  event: ZaloEvent | undefined
): Promise<AcceptOutcome> {
  if (!event) {
    return 'accepted'
  }

  for (let attempt = 1; attempt <= INBOX_ACCEPT_MAX_ATTEMPTS; attempt++) {
    try {
      await handleZaloEvent(deps, event)

      return 'accepted'
    } catch (err: unknown) {
      if (deps.signal.aborted) {
        return 'aborted'
      }

      deps.logger.warn('zalo.inbox_persist_failed', {
        attempt,
        err: formatErrForLog(err),
      })
      await backOff(deps, state)
    }
  }

  deps.logger.warn('zalo.inbox_event_dropped', { eventName: event.event_name })

  return 'dropped'
}

async function fetchUpdate(
  deps: ZaloPollDeps,
  state: PollState
): Promise<ZaloApiResponse<ZaloEvent> | undefined> {
  try {
    return await getUpdates({ ...transportOf(deps), timeoutSec: ZALO_LONG_POLL_TIMEOUT_SEC })
  } catch (err: unknown) {
    if (deps.signal.aborted) {
      return undefined
    }

    deps.logger.warn('zalo.poll_network_error', { err: formatErrForLog(err) })
    deps.handlers.setStatus({ connected: false, lastError: 'poll_network_error' })
    await backOff(deps, state)
    return undefined
  }
}

async function handlePollFailure(
  deps: ZaloPollDeps,
  state: PollState,
  res: ZaloApiResponse<ZaloEvent>
): Promise<boolean> {
  // An idle long poll ends as a server answer: a quiet channel's only success, and what restores a
  // connection a network error marked down.
  if (res.error_code === LONG_POLL_TIMEOUT_ERROR_CODE) {
    resetPollState(state)
    deps.handlers.setStatus({ connected: true, lastError: null })

    return false
  }

  if (res.error_code === ZALO_UNAUTHORIZED_CODE) {
    state.authFailures += 1
    deps.logger.warn('zalo.poll_unauthorized', { failures: state.authFailures })

    if (state.authFailures >= AUTH_FAILURE_THRESHOLD) {
      deps.logger.error('zalo.auth_failed', { failures: state.authFailures })
      deps.handlers.setStatus({ running: false, connected: false, lastError: 'auth_failed' })

      return true
    }

    await backOff(deps, state)

    return false
  }

  deps.logger.warn('zalo.poll_failed', {
    errorCode: res.error_code,
    description: res.description,
  })
  deps.handlers.setStatus({
    connected: false,
    lastError: `poll_failed_${res.error_code ?? 'unknown'}`,
  })
  await backOff(deps, state)

  return false
}

async function handleZaloEvent(deps: ZaloPollDeps, event: ZaloEvent): Promise<void> {
  const msg = toInboundMessage(event)

  // An update no admission rule could let in is never stored, so a stranger cannot grow the inbox.
  if (!msg || deps.handlers.canAdmit?.(msg.chatId, msg.userId) === false) {
    return
  }

  // Land in the durable inbox (deduped by event_name:message_id) before the next poll. The channel
  // runtime claims and dispatches these asynchronously — never the poll loop directly.
  await acceptInbound({
    inbox: deps.inbox,
    channel: ZALO_CHANNEL_ID,
    updateId: `${event.event_name}:${msg.messageId}`,
    payload: { kind: 'message', msg },
    acceptedAt: Date.now(),
  })
}

function toInboundMessage(event: ZaloEvent): InboundMessage | undefined {
  const m = event.message

  if (m === undefined) {
    return undefined
  }

  const text = m.text ?? m.caption ?? ''

  if (!text) {
    return undefined
  }

  const isGroup = m.chat.chat_type === 'GROUP'

  return {
    channel: ZALO_CHANNEL_ID,
    chatId: String(m.chat.id),
    userId: String(m.from.id),
    text,
    messageId: String(m.message_id),
    receivedAt: toEpochMs(m.date),
    isGroup,
    // The Bot API carries no mention field: Zalo delivers a group message to a bot only when it is
    // @mentioned, so whatever arrives was addressed to it. Admission still decides who may use it.
    addressedToBot: true,
  }
}

function transportOf(deps: ZaloPollDeps): {
  readonly token: string
  readonly signal: AbortSignal
  readonly fetchImpl?: FetchFn
} {
  return {
    token: deps.token,
    signal: deps.signal,
    ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
  }
}

async function backOff(deps: ZaloPollDeps, state: PollState): Promise<void> {
  await abortableSleep(state.backoffMs, deps.signal)
  state.backoffMs = Math.min(state.backoffMs * POLL_BACKOFF_FACTOR, POLL_BACKOFF_MAX_MS)
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }

    signal.addEventListener('abort', onAbort, { once: true })
  })
}
