import type { API, ThreadType } from 'zca-js'
import { CloseReason, Zalo } from 'zca-js'

import type { AdapterHandlers, InboundInbox } from '@/channels/types'
import type { ChannelId } from '@/core/channels'
import type { Logger } from '@/core/logging/logger'
import type { LruMap } from '@/core/utils/collections'
import { BRAND } from '@/core/brand'
import { abortError, ChannelError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { sleep } from '@/core/utils/time'

import {
  type ProfileLocation,
  readZaloPersonalCredentials,
  writeZaloPersonalCredentials,
} from './credentials'
import { attachZaloPersonalListener, resolveBotName } from './listener'

const RECONNECT_INITIAL_MS = 5_000
const RECONNECT_MAX_MS = 300_000
// A session that stayed up this long was healthy, so the next drop starts the backoff over; one
// that keeps falling sooner (Zalo Web taking the session back, say) keeps backing off.
const SESSION_STABLE_MS = RECONNECT_MAX_MS
const REQUEST_TIMEOUT_MS = 15_000
const LOGIN_COMMAND = `${BRAND.name} zalo login`

type SessionEndReason =
  | 'not_authenticated'
  | 'login_failed'
  | 'duplicate_connection'
  | 'connection_closed'

interface SessionEnd {
  readonly reason: SessionEndReason
  readonly detail?: Record<string, unknown>
}

interface ZaloPersonalSessionDeps {
  readonly location: ProfileLocation
  readonly channelId: ChannelId
  readonly handlers: AdapterHandlers
  readonly inbox: InboundInbox
  readonly logger: Logger
  readonly signal: AbortSignal
  readonly threadTypes: LruMap<string, ThreadType>
  /** The logged-in client sends go through, or null while there is none. */
  readonly setApi: (api: API | null) => void
}

// Runs until the signal aborts. Each pass logs in from the stored credentials, so a fresh
// `zalo login` while the daemon runs is picked up at the next reconnect without a restart.
export async function runZaloPersonalSession(deps: ZaloPersonalSessionDeps): Promise<void> {
  let delayMs = RECONNECT_INITIAL_MS
  let lastReason: SessionEndReason | undefined

  while (!deps.signal.aborted) {
    const startedAt = performance.now()
    const end = await runSessionOnce(deps)

    deps.setApi(null)

    if (deps.signal.aborted) {
      return
    }

    const wasStable = performance.now() - startedAt >= SESSION_STABLE_MS

    reportSessionEnd(deps, end, wasStable || end.reason !== lastReason)
    lastReason = end.reason

    if (wasStable) {
      delayMs = RECONNECT_INITIAL_MS
    }

    // An abort ends the wait early, and the loop condition then ends the session.
    await sleep(delayMs, deps.signal).catch(() => undefined)
    delayMs = Math.min(delayMs * 2, RECONNECT_MAX_MS)
  }
}

async function runSessionOnce(deps: ZaloPersonalSessionDeps): Promise<SessionEnd> {
  const credentials = await readZaloPersonalCredentials(deps.location)

  if (credentials === undefined) {
    return { reason: 'not_authenticated', detail: { fix: LOGIN_COMMAND } }
  }

  let api: API

  try {
    api = await new Zalo({ logging: false, polyfill: createZaloPersonalFetch(deps.signal) }).login(
      credentials
    )
  } catch (err: unknown) {
    return { reason: 'login_failed', detail: { err: formatErrForLog(err), fix: LOGIN_COMMAND } }
  }

  await writeZaloPersonalCredentials(deps.location, api).catch((err: unknown) => {
    deps.logger.warn('zalo_personal.credentials_write_failed', { err: formatErrForLog(err) })
  })

  return await listenUntilClosed(deps, api)
}

async function listenUntilClosed(deps: ZaloPersonalSessionDeps, api: API): Promise<SessionEnd> {
  const botName = await resolveBotName(api)
  const listener = attachZaloPersonalListener({
    api,
    threadTypes: deps.threadTypes,
    handlers: deps.handlers,
    inbox: deps.inbox,
    logger: deps.logger,
    signal: deps.signal,
    botName,
    channelId: deps.channelId,
  })

  deps.setApi(api)

  try {
    const { code, reason } = await listener.closed
    const displaced = code === CloseReason.DuplicateConnection

    return {
      reason: displaced ? 'duplicate_connection' : 'connection_closed',
      detail: { code, closeReason: reason },
    }
  } finally {
    await listener.dispose()
  }
}

// One line per change of state: a session that fails the same way every few minutes says so once.
function reportSessionEnd(
  deps: ZaloPersonalSessionDeps,
  end: SessionEnd,
  shouldLog: boolean
): void {
  deps.handlers.setStatus({ connected: false, lastError: end.reason })

  if (shouldLog) {
    deps.logger.warn('zalo_personal.session_ended', { reason: end.reason, ...end.detail })
  }
}

function createZaloPersonalFetch(lifetimeSignal: AbortSignal): typeof fetch {
  return Object.assign(
    async (input: string | URL | Request, init?: BunFetchRequestInit): Promise<Response> => {
      if (lifetimeSignal.aborted) {
        throw abortError(lifetimeSignal)
      }

      const callerSignal = init?.signal ?? undefined

      if (callerSignal?.aborted) {
        throw abortError(callerSignal)
      }

      const controller = new AbortController()
      const timer = setTimeout(() => {
        controller.abort(new ChannelError('send_failed', 'zalo_personal transport timed out'))
      }, REQUEST_TIMEOUT_MS)
      const onCallerAbort = (): void => controller.abort(abortError(callerSignal))
      const onLifetimeAbort = (): void => controller.abort(abortError(lifetimeSignal))

      callerSignal?.addEventListener('abort', onCallerAbort, { once: true })
      lifetimeSignal.addEventListener('abort', onLifetimeAbort, { once: true })

      try {
        return await globalThis.fetch(input, { ...init, signal: controller.signal })
      } finally {
        clearTimeout(timer)
        callerSignal?.removeEventListener('abort', onCallerAbort)
        lifetimeSignal.removeEventListener('abort', onLifetimeAbort)
      }
    },
    globalThis.fetch
  )
}
