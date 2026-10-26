import type {
  ClientFrame,
  CONTRACT_REFUSED_CLOSE_CODE,
  CONTRACT_REFUSED_REASON_PREFIX,
  CONTRACT_VERSION,
  ServerFrame,
} from '@/app/server/wire/socket'
import { nextDelayMs } from '@/web/api/backoff'
import { ApiFailure, getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'

// Typed against the daemon's constants, so a change there fails the typecheck until the page follows.
const EXPECTED_CONTRACT_VERSION: typeof CONTRACT_VERSION = 1
const CONTRACT_REFUSED_CODE: typeof CONTRACT_REFUSED_CLOSE_CODE = 1011
const CONTRACT_REFUSED_PREFIX: typeof CONTRACT_REFUSED_REASON_PREFIX = 'contract '
const STABLE_AFTER_MS = 10_000
const UNAUTHORIZED_STATUS = 401

export type ConnectionStatus = 'connecting' | 'live' | 'offline' | 'refused' | 'outdated'

interface FeedSocketDeps {
  readonly url: () => string
  readonly onFrame: (frame: ServerFrame) => void
  /** `retryAt` (epoch ms) rides with `offline` while a retry is armed: when the next attempt starts. */
  readonly onStatus: (status: ConnectionStatus, retryAt?: number) => void
  readonly onOpen: () => void
}

export interface FeedSocket {
  /** False unless the socket is `live`. */
  send(frame: ClientFrame): boolean
  /** Connects at once while a retry waits; on a live socket, drops it and reconnects on the backoff. */
  retryNow(): void
  close(): void
}

// One feed socket's mutable state; `connection` owns the listeners of the current `WebSocket`.
interface SocketState {
  readonly deps: FeedSocketDeps
  readonly lifetime: AbortController
  status: ConnectionStatus
  attempt: number
  socket: WebSocket | undefined
  connection: AbortController | undefined
  retryTimer: ReturnType<typeof setTimeout> | undefined
  stableTimer: ReturnType<typeof setTimeout> | undefined
}

/** The page's one socket. It says hello, goes `live` on a matching welcome, and on any drop asks the
 *  daemon why: a browser exposes no handshake status, so `/v1/health` then `/v1/state` tell an
 *  absent daemon (`offline`, retried with backoff) from an ended sign-in (`refused`, never retried). */
export function createFeedSocket(deps: FeedSocketDeps): FeedSocket {
  const state: SocketState = {
    deps,
    lifetime: new AbortController(),
    status: 'connecting',
    attempt: 0,
    socket: undefined,
    connection: undefined,
    retryTimer: undefined,
    stableTimer: undefined,
  }

  deps.onStatus(state.status)
  connect(state)

  return {
    send: (frame) => send(state, frame),
    retryNow: () => retryNow(state),
    close: () => close(state),
  }
}

function connect(state: SocketState): void {
  state.retryTimer = undefined

  if (state.lifetime.signal.aborted) {
    return
  }

  // An attempt under way has nothing armed: the bar drops its countdown until the next verdict.
  if (state.status === 'offline') {
    setStatus(state, 'offline')
  }

  const controller = new AbortController()
  const { signal } = controller

  state.connection = controller

  try {
    state.socket = new WebSocket(state.deps.url())
  } catch {
    // `drop` catches every probe failure and nothing else in it throws, so it never rejects.
    drop(state).catch(() => undefined)
    return
  }

  const ws = state.socket

  ws.addEventListener('open', () => sendHello(ws), { signal })
  ws.addEventListener('message', (event) => receive(state, event.data), { signal })
  // `drop` never rejects (see above).
  ws.addEventListener('close', (event) => drop(state, event).catch(() => undefined), { signal })
  ws.addEventListener('error', () => drop(state).catch(() => undefined), { signal })
}

function sendHello(ws: WebSocket): void {
  const hello: ClientFrame = { type: 'hello', contractVersion: EXPECTED_CONTRACT_VERSION }

  ws.send(JSON.stringify(hello))
}

function receive(state: SocketState, data: unknown): void {
  const frame = parseFrame(data)

  if (frame === undefined) {
    return
  }

  if (frame.type === 'welcome') {
    welcome(state, frame.contractVersion)
    return
  }

  state.deps.onFrame(frame)
}

function welcome(state: SocketState, contractVersion: number): void {
  if (contractVersion !== EXPECTED_CONTRACT_VERSION) {
    release(state)
    setStatus(state, 'outdated')
    return
  }

  setStatus(state, 'live')
  state.stableTimer = setTimeout(() => {
    state.attempt = 0
  }, STABLE_AFTER_MS)
  state.deps.onOpen()
}

// Runs once per connection: releasing it removes the listener that would call it again.
async function drop(state: SocketState, event?: CloseEvent): Promise<void> {
  release(state)

  if (state.lifetime.signal.aborted || state.status === 'outdated') {
    return
  }

  if (event !== undefined && isContractRefusal(event)) {
    setStatus(state, 'outdated')
    return
  }

  if (state.status === 'live') {
    setStatus(state, 'connecting')
  }

  const verdict = await classify(state.lifetime.signal)

  if (state.lifetime.signal.aborted) {
    return
  }

  if (verdict === 'refused') {
    setStatus(state, 'refused')
    return
  }

  const delayMs = nextDelayMs(state.attempt, Math.random)

  state.attempt++
  state.retryTimer = setTimeout(() => connect(state), delayMs)
  setStatus(state, 'offline', Date.now() + delayMs)
}

function send(state: SocketState, frame: ClientFrame): boolean {
  if (state.status !== 'live' || state.socket === undefined) {
    return false
  }

  try {
    state.socket.send(JSON.stringify(frame))
    return true
  } catch {
    return false
  }
}

function retryNow(state: SocketState): void {
  if (state.status === 'live') {
    // `drop` catches every probe failure and nothing else in it throws, so it never rejects.
    drop(state).catch(() => undefined)
    return
  }

  if (state.retryTimer === undefined) {
    return
  }

  clearTimeout(state.retryTimer)
  connect(state)
}

function close(state: SocketState): void {
  state.lifetime.abort()
  clearTimeout(state.retryTimer)
  state.retryTimer = undefined
  release(state)
}

// Undoes one connection: its listeners, its stable timer and the socket itself.
function release(state: SocketState): void {
  state.connection?.abort()
  state.connection = undefined
  clearTimeout(state.stableTimer)
  state.stableTimer = undefined
  state.socket?.close()
  state.socket = undefined
}

function setStatus(state: SocketState, next: ConnectionStatus, retryAt?: number): void {
  state.status = next
  state.deps.onStatus(next, retryAt)
}

async function classify(signal: AbortSignal): Promise<'offline' | 'refused'> {
  try {
    await getJson(ROUTES.health, { signal })
    await getJson(ROUTES.state, { signal })
  } catch (error: unknown) {
    if (error instanceof ApiFailure && error.status === UNAUTHORIZED_STATUS) {
      return 'refused'
    }
  }

  return 'offline'
}

function isContractRefusal(event: CloseEvent): boolean {
  return event.code === CONTRACT_REFUSED_CODE && event.reason.startsWith(CONTRACT_REFUSED_PREFIX)
}

// A malformed frame is dropped; an unknown `type` passes, for the router to ignore.
function parseFrame(data: unknown): ServerFrame | undefined {
  if (typeof data !== 'string') {
    return undefined
  }

  try {
    const value: unknown = JSON.parse(data)

    if (typeof value !== 'object' || value === null || !('type' in value)) {
      return undefined
    }

    // why-safe: the router switches on `type` and `kind` and ignores any it does not know.
    return typeof value.type === 'string' ? (value as ServerFrame) : undefined
  } catch {
    return undefined
  }
}
