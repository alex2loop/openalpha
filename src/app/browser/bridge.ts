import type { BrowserKeyring } from '@/app/browser/keys'
import type { BrowserLogger } from '@/app/browser/logger'
import type { BrowserRoot, OpenedRoot } from '@/app/browser/root'
import type { ApiError } from '@/app/server/wire/errors'
import type { ClientFrame } from '@/app/server/wire/socket'
import type { WorkerCall, WorkerReply } from '@/app/server/wire/worker'
import type { FrameSink } from '@/app/server/ws/frame-sink'
import type { Locale } from '@/core/types/locale'
import { openBrowserRoot } from '@/app/browser/root'
import { handleHttp } from '@/app/server/http/dispatch'
import { API_ERROR_STATUS } from '@/app/server/wire/errors'
import { closeChatClient, followChatBus } from '@/app/server/ws/chat-client'
import { handleChatFrame } from '@/app/server/ws/frames'
import { toLaneTag } from '@/app/server/ws/runs'
import { formatErrForLog } from '@/core/security/credentials'
import { bindLocale } from '@/i18n'

/** A request reaches the same route table the daemon serves; only the host of its URL is made up. */
const REQUEST_ORIGIN = 'http://worker.invalid'
const JSON_CONTENT_TYPE = 'application/json'

/** What a started worker holds between calls. `root` is absent until `start` opens the database and
 *  again after the page is told it lost it. */
interface BridgeState {
  root?: BrowserRoot | undefined
  stopFeed?: (() => void) | undefined
  locale: Locale
  /** Set by `shutdown`: nothing opens a database after it. */
  closed: boolean
  /** The last lifecycle operation; the next one waits on it. Replaced, never appended to. */
  tail: Promise<void>
  /** One per request in flight, keyed by the page's id and removed when the request settles. */
  readonly controllers: Map<string, AbortController>
}

interface BridgeContext {
  readonly post: (reply: WorkerReply) => void
  readonly keyring: BrowserKeyring
  readonly logger: BrowserLogger
  readonly wasmUrl: string
  readonly state: BridgeState
  /** Aborts every request in flight, stops the chat client and the bus listeners, and closes the
   *  database, after any start still opening it. Idempotent. */
  shutdown(): Promise<void>
}

export function createBridgeContext(
  options: Pick<BridgeContext, 'post' | 'keyring' | 'logger' | 'wasmUrl'> & { locale: Locale }
): BridgeContext {
  const state: BridgeState = {
    locale: options.locale,
    closed: false,
    tail: Promise.resolve(),
    controllers: new Map(),
  }

  return {
    post: options.post,
    keyring: options.keyring,
    logger: options.logger,
    wasmUrl: options.wasmUrl,
    state,
    shutdown: () => {
      state.closed = true

      return enqueue(state, () => releaseRoot(state, options.logger))
    },
  }
}

/** One message from the page. Never rejects: a call that fails is answered or logged, so a worker
 *  with a bad call keeps serving the good ones. */
export async function handleWorkerCall(call: WorkerCall, ctx: BridgeContext): Promise<void> {
  try {
    await dispatchCall(call, ctx)
  } catch (err: unknown) {
    ctx.logger.error('browser.call_failed', { kind: call.kind, err: formatErrForLog(err) })
  }
}

async function dispatchCall(call: WorkerCall, ctx: BridgeContext): Promise<void> {
  const { state } = ctx

  switch (call.kind) {
    case 'start':
      ctx.keyring.update(call.keys)

      return enqueue(state, async () => {
        state.locale = call.locale

        await start(ctx, call.steal)
      })
    case 'keys':
      ctx.keyring.update(call.keys)

      return
    case 'locale':
      // The config the engine runs on is frozen at start, so a new language is a new start.
      return enqueue(state, async () => {
        state.locale = call.locale

        if (state.root !== undefined) {
          await start(ctx, false)
        }
      })
    case 'http':
      return serveHttp(ctx, call)
    case 'frame':
      return serveFrame(ctx, call.frame)
    case 'abort':
      // An id nobody holds (settled, or never sent) is ignored.
      state.controllers.get(call.id)?.abort()

      return
    default: {
      const exhaustive: never = call
      return exhaustive
    }
  }
}

// Lifecycle operations run one at a time, so a restart tears the old root down fully before the
// new one asks for the lock, and a second start never meets the first one's lock.
function enqueue(state: BridgeState, operation: () => Promise<void>): Promise<void> {
  const next = state.tail.then(operation)

  state.tail = next.catch(() => undefined)

  return next
}

async function start(ctx: BridgeContext, steal: boolean): Promise<void> {
  const { state } = ctx

  await releaseRoot(state, ctx.logger)

  if (state.closed) {
    return
  }

  const opened = await openBrowserRoot({
    locale: state.locale,
    steal,
    keyring: ctx.keyring,
    logger: ctx.logger,
    wasmUrl: ctx.wasmUrl,
    broadcast: (event) => ctx.post({ kind: 'frame', frame: { type: 'wire_event', ...event } }),
  })

  await serve(ctx, opened)
}

async function serve(ctx: BridgeContext, opened: OpenedRoot): Promise<void> {
  const { state } = ctx

  if (opened.kind === 'refused') {
    ctx.post({ kind: 'refused', reason: opened.reason })

    return
  }

  const { root } = opened

  // A shutdown that came while the database was opening has nobody left to serve.
  if (state.closed) {
    await root.close()

    return
  }

  state.root = root
  state.stopFeed = followChatBus({ sink: createSink(ctx), client: root.chat })
  watchLoss(ctx, root)
  ctx.post({ kind: 'ready', capabilities: root.capabilities })
}

// Another tab took the database: this one stops serving and says so; nothing it held is lost.
function watchLoss(ctx: BridgeContext, root: BrowserRoot): void {
  root.lost
    .then(() =>
      enqueue(ctx.state, async () => {
        if (ctx.state.root === root) {
          await releaseRoot(ctx.state, ctx.logger)
          ctx.post({ kind: 'refused', reason: 'taken-over' })
        }
      })
    )
    .catch((err: unknown) => {
      ctx.logger.error('browser.loss_handling_failed', { err: formatErrForLog(err) })
    })
}

// Cleanup logs and goes on: a failure here must not stop the next start from opening the lock.
async function releaseRoot(state: BridgeState, logger: BrowserLogger): Promise<void> {
  const { root, stopFeed } = state

  state.root = undefined
  state.stopFeed = undefined

  for (const controller of state.controllers.values()) {
    controller.abort()
  }

  try {
    stopFeed?.()

    if (root !== undefined) {
      closeChatClient(root.chat)
      await root.close()
    }
  } catch (err: unknown) {
    logger.error('browser.release_failed', { err: formatErrForLog(err) })
  }
}

async function serveHttp(
  ctx: BridgeContext,
  call: Extract<WorkerCall, { readonly kind: 'http' }>
): Promise<void> {
  const { root, controllers } = ctx.state

  if (root === undefined) {
    ctx.post(errorReply(call.id, 'unavailable'))

    return
  }

  // An id already in flight belongs to that request: answering it would settle the wrong caller.
  if (controllers.has(call.id)) {
    ctx.logger.warn('browser.http_duplicate_id', { path: call.path })

    return
  }

  const controller = new AbortController()

  controllers.set(call.id, controller)

  try {
    const response = await handleHttp(buildRequest(call, controller.signal), root.route)

    ctx.post({ kind: 'http', id: call.id, status: response.status, body: await response.text() })
  } catch (err: unknown) {
    ctx.logger.error('browser.http_failed', { path: call.path, err: formatErrForLog(err) })
    ctx.post(errorReply(call.id, 'internal'))
  } finally {
    controllers.delete(call.id)
  }
}

function buildRequest(
  call: Extract<WorkerCall, { readonly kind: 'http' }>,
  signal: AbortSignal
): Request {
  const init: RequestInit = { method: call.method, signal }

  if (call.body !== undefined) {
    init.body = call.body
    init.headers = { 'content-type': JSON_CONTENT_TYPE }
  }

  return new Request(new URL(call.path, REQUEST_ORIGIN).toString(), init)
}

function errorReply(id: string, code: 'unavailable' | 'internal'): WorkerReply {
  return {
    kind: 'http',
    id,
    status: API_ERROR_STATUS[code],
    body: JSON.stringify({ error: { code } } satisfies ApiError),
  }
}

// Chat with tools is not on the web: only a line that starts with `/` is a command. Anything else
// would reach the chat agent, which holds every tool the engine has.
async function serveFrame(ctx: BridgeContext, frame: ClientFrame): Promise<void> {
  const { root } = ctx.state

  if (root === undefined || frame.type === 'hello') {
    return
  }

  const sink = createSink(ctx)

  if ((frame.type === 'chat' || frame.type === 'steer') && !frame.message.trim().startsWith('/')) {
    sink.send({
      type: 'chat',
      kind: 'error',
      code: 'unavailable',
      message: bindLocale(ctx.state.locale).translate('errors.browserChatCommandsOnly'),
      ...toLaneTag(frame.id),
    })

    return
  }

  await handleChatFrame(frame, sink, root.chat)
}

/** Where a run's frames go: to the page, until the worker no longer holds a database to run on. */
function createSink(ctx: BridgeContext): FrameSink {
  return {
    send: (frame) => ctx.post({ kind: 'frame', frame }),
    get closed(): boolean {
      return ctx.state.root === undefined
    },
  }
}
