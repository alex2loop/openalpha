import type { FetchGuard } from '@/core/ssrf/fetch-guard'
import { ToolError } from '@/core/errors'
import { hasLikelySecret } from '@/core/security/credentials'
import { MS_PER_SECOND } from '@/core/utils/time'

// A page's request is the visitor's own, from the visitor's own address, so the daemon's pin-and-vet
// of every hop has nothing to protect: the browser refuses private ranges itself and reads a
// redirect only by following it. What stays is the part that does not need a socket - https only,
// the caller's host list, no credential in the request, a deadline.
const FETCH_TIMEOUT_MS = 30 * MS_PER_SECOND
const HTTPS_PROTOCOL = 'https:'
const IP_LITERAL_RE = /^(?:\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]+\])$/i
const LOCAL_SUFFIXES = Object.freeze(['.local', '.internal', '.localhost'])

export const BROWSER_FETCH_GUARD: FetchGuard = {
  async guardedFetch(url, init, options) {
    const target = toPublicUrl(url)

    if (options?.allowlist !== undefined && !options.allowlist.includes(target.hostname)) {
      throw new ToolError('host_blocked', `host ${target.hostname} is not allowed`)
    }

    const response = await fetch(target, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
      credentials: 'omit',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
    })

    return { response, finalUrl: response.url === '' ? target.toString() : response.url }
  },
  guardedLoopbackFetch: () =>
    Promise.reject(new ToolError('host_blocked', 'a page has no local endpoint to reach')),
}

function toPublicUrl(raw: string): URL {
  let url: URL

  try {
    url = new URL(raw)
  } catch {
    throw new ToolError('invalid_input', 'url is not valid')
  }

  if (url.protocol !== HTTPS_PROTOCOL || url.username !== '' || url.password !== '') {
    throw new ToolError('host_blocked', 'only plain https addresses are allowed')
  }

  if (
    IP_LITERAL_RE.test(url.hostname) ||
    url.hostname === 'localhost' ||
    LOCAL_SUFFIXES.some((suffix) => url.hostname.endsWith(suffix))
  ) {
    throw new ToolError('host_blocked', `host ${url.hostname} is not a public name`)
  }

  if (hasLikelySecret(`${url.pathname}${url.search}`)) {
    throw new ToolError('credential_leak', 'outbound url contains a secret pattern')
  }

  return url
}
