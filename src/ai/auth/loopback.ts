import type { Server } from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'

import { abortError, isErrno, LLMError } from '@/core/errors'

const LOOPBACK_HOST = '127.0.0.1'
const LOOPBACK_ORIGIN = `http://${LOOPBACK_HOST}`
const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8' } as const
const OK_STATUS = 200
const BAD_REQUEST_STATUS = 400
const NOT_FOUND_STATUS = 404

interface LoopbackInput {
  readonly ports: readonly number[]
  readonly path: string
  readonly state: string
  readonly successHtml: string
  readonly errorHtml: string
  // Fires once the port is known, so the caller can build the redirect URI that names it.
  onListening(port: number): void
  readonly signal: AbortSignal
}

export async function awaitLoopbackCode(input: LoopbackInput): Promise<string> {
  if (input.signal.aborted) {
    throw abortError(input.signal)
  }

  let settle: ((outcome: string | Error) => void) | undefined
  const server = createServer((req, res) => {
    const reply = answerCallback(req.url, input)

    res.writeHead(reply.status, HTML_HEADERS)
    res.end(reply.html)

    if (reply.outcome !== undefined) {
      settle?.(reply.outcome)
    }
  })
  const port = await bindFirstFreePort(server, input.ports)

  if (input.signal.aborted) {
    await closeServer(server)
    throw abortError(input.signal)
  }

  input.onListening(port)

  // Nothing is awaited between binding and installing `settle`, so no request can arrive unhandled.
  return await new Promise<string>((resolve, reject) => {
    function finish(done: () => void): void {
      input.signal.removeEventListener('abort', onAbort)
      server.close(done)
    }

    function onAbort(): void {
      finish(() => reject(abortError(input.signal)))
    }

    settle = (outcome) => {
      finish(() => (typeof outcome === 'string' ? resolve(outcome) : reject(outcome)))
    }

    server.on('error', (err) => {
      finish(() => reject(new LLMError('auth', 'login callback server failed', { cause: err })))
    })

    input.signal.addEventListener('abort', onAbort, { once: true })
  })
}

interface CallbackReply {
  readonly status: number
  readonly html: string
  // Present only for a request that ends the login; anything else leaves the listener waiting, so
  // a stray hit on the loopback port cannot cancel a sign-in in progress.
  readonly outcome?: string | Error
}

function answerCallback(target: string | undefined, input: LoopbackInput): CallbackReply {
  const url = parseCallbackUrl(target)

  if (url === undefined) {
    return { status: BAD_REQUEST_STATUS, html: input.errorHtml }
  }

  if (url.pathname !== input.path) {
    return { status: NOT_FOUND_STATUS, html: input.errorHtml }
  }

  if (!statesMatch(url.searchParams.get('state'), input.state)) {
    return { status: BAD_REQUEST_STATUS, html: input.errorHtml }
  }

  const code = url.searchParams.get('code')

  if (code === null) {
    return {
      status: BAD_REQUEST_STATUS,
      html: input.errorHtml,
      outcome: new LLMError('auth', 'login callback carried no code'),
    }
  }

  return { status: OK_STATUS, html: input.successHtml, outcome: code }
}

// A request target such as `//[` is not a URL and makes the parser throw; it is a bad request, not
// a fault in the daemon.
function parseCallbackUrl(target: string | undefined): URL | undefined {
  try {
    return new URL(target ?? '/', LOOPBACK_ORIGIN)
  } catch {
    return undefined
  }
}

// Digest-compare so the CSRF token match is data-independent; timingSafeEqual needs equal lengths.
function statesMatch(received: string | null, expected: string): boolean {
  if (received === null) {
    return false
  }

  return timingSafeEqual(sha256(received), sha256(expected))
}

function sha256(value: string): Uint8Array {
  return createHash('sha256').update(value).digest()
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

// Only a taken port moves to the next candidate: any other listen failure is a real fault and the
// remaining ports would fail the same way.
async function bindFirstFreePort(server: Server, ports: readonly number[]): Promise<number> {
  let taken: unknown

  for (const port of ports) {
    const err = await listenOn(server, port)

    if (err === undefined) {
      return port
    }
    if (!isErrno(err, 'EADDRINUSE')) {
      throw new LLMError('auth', 'cannot bind the login callback port', { cause: err })
    }

    taken = err
  }

  throw new LLMError('auth', `login callback ports are all in use: ${ports.join(', ')}`, {
    cause: taken instanceof Error ? taken : undefined,
  })
}

function listenOn(server: Server, port: number): Promise<unknown> {
  return new Promise((resolve) => {
    const onError = (err: unknown): void => {
      server.removeListener('listening', onListening)
      resolve(err)
    }

    function onListening(): void {
      server.removeListener('error', onError)
      resolve(undefined)
    }

    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, LOOPBACK_HOST)
  })
}
