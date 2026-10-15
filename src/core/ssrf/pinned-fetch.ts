import type { IncomingHttpHeaders } from 'node:http'
import type { RequestOptions } from 'node:https'
import { request } from 'node:https'
import { Readable } from 'node:stream'

import { abortError, ToolError } from '@/core/errors'

// Socket inactivity bound. Without it a peer that accepts the connection and never answers leaves
// the promise, the socket, and every awaiting caller pinned for the process lifetime.
const PINNED_IDLE_TIMEOUT_MS = 30_000
// req.setTimeout arms only once the socket is connected, so it bounds nothing while the connect is
// in flight — a black-holed SYN would otherwise wait out the OS retry budget (minutes).
const PINNED_RESPONSE_TIMEOUT_MS = 30_000

export type FetchFn = (url: string | URL, options?: RequestInit) => Promise<Response>

interface PinnedDial {
  readonly ip: string
  /** Only a caller that vetted the destination itself sends a body; redirects are never followed. */
  readonly allowBody: boolean
}

export function createPinnedFetch(
  pinnedIp: string,
  options: { readonly allowBody?: boolean } = {}
): FetchFn {
  const dial: PinnedDial = { ip: pinnedIp, allowBody: options.allowBody === true }

  return (url, init) => sendPinnedRequest(new URL(url), dial, init)
}

function sendPinnedRequest(
  url: URL,
  dial: PinnedDial,
  options: RequestInit | undefined
): Promise<Response> {
  const signal = options?.signal ?? undefined
  const body = options?.body ?? undefined

  if (signal?.aborted) {
    return Promise.reject(abortError(signal))
  }
  if (body !== undefined && !(dial.allowBody && typeof body === 'string')) {
    return Promise.reject(new ToolError('invalid_input', 'pinned fetch does not support this body'))
  }

  return new Promise((resolve, reject) => {
    const req = request(url, pinnedRequestOptions(dial.ip, options, signal), (incoming) => {
      clearTimeout(responseTimer)

      if (incoming.statusCode === undefined) {
        incoming.destroy()
        reject(new ToolError('unexpected', 'pinned fetch returned no HTTP status'))
        return
      }

      resolve(
        new Response(Readable.toWeb(incoming), {
          status: incoming.statusCode,
          ...(incoming.statusMessage === undefined ? {} : { statusText: incoming.statusMessage }),
          headers: toResponseHeaders(incoming.headers),
        })
      )
    })

    // Stays attached for the request's whole lifetime: an abort destroys the socket mid-connect,
    // and the connect failure then arrives as a second 'error' — with no listener it would escape
    // as an uncaught exception and kill the process. A second reject() is a no-op.
    const onError = (err: Error): void => {
      clearTimeout(responseTimer)
      reject(signal?.aborted ? abortError(signal) : err)
    }

    // Covers connect through response headers; the idle timer governs the body from there.
    const responseTimer = setTimeout(() => {
      req.destroy(
        new ToolError(
          'timeout',
          `pinned fetch got no response in ${PINNED_RESPONSE_TIMEOUT_MS}ms: ${url.host}`
        )
      )
    }, PINNED_RESPONSE_TIMEOUT_MS)

    req.on('error', onError)
    // destroy(err) surfaces through the same 'error' listener, so the timeout settles the promise.
    req.setTimeout(PINNED_IDLE_TIMEOUT_MS, () => {
      req.destroy(
        new ToolError('timeout', `pinned fetch idle for ${PINNED_IDLE_TIMEOUT_MS}ms: ${url.host}`)
      )
    })
    req.end(typeof body === 'string' ? body : undefined)
  })
}

// The lookup callback is what pins the dial: the vetted IP is dialled directly, so no second
// resolution can land on a different address than the one the SSRF check cleared.
function pinnedRequestOptions(
  pinnedIp: string,
  options: RequestInit | undefined,
  signal: AbortSignal | undefined
): RequestOptions {
  const family = pinnedIp.includes(':') ? 6 : 4

  return {
    agent: false,
    headers: toNodeHeaders(options?.headers),
    method: options?.method,
    signal,
    lookup: (_hostname, lookupOptions, callback) => {
      if (lookupOptions.all) {
        callback(null, [{ address: pinnedIp, family }])
        return
      }

      callback(null, pinnedIp, family)
    },
  }
}

function toNodeHeaders(headers: RequestInit['headers']): Record<string, string> {
  return Object.fromEntries(new Headers(headers).entries())
}

function toResponseHeaders(source: IncomingHttpHeaders): Headers {
  const headers = new Headers()

  for (const [name, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item)
      }
    } else if (value !== undefined) {
      headers.append(name, value)
    }
  }

  return headers
}
