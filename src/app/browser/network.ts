import type { FetchGuard } from '@/core/ssrf/fetch-guard'
import { ToolError } from '@/core/errors'
import { hasLikelySecret } from '@/core/security/credentials'
import { isGlobMatch } from '@/core/utils/glob'
import { MS_PER_SECOND } from '@/core/utils/time'

// A page's request is the visitor's own, from the visitor's own address, and a browser reads a
// redirect only by following it: so the daemon's pin-and-vet of each hop has no equivalent. What
// stays needs no socket: https only, the caller's host list, no secret in the URL, a deadline.
const FETCH_TIMEOUT_MS = 30 * MS_PER_SECOND
const HTTPS_PROTOCOL = 'https:'
const IP_LITERAL_RE = /^(?:\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]+\])$/i
const LOCAL_SUFFIXES = Object.freeze(['.local', '.internal', '.localhost'])

export const BROWSER_FETCH_GUARD: FetchGuard = {
  async guardedFetch(url, init, options) {
    const target = parsePublicUrl(url)

    assertHostAllowed(options?.allowlist, target.hostname)

    const response = await fetch(target, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
      credentials: 'omit',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
    })
    const finalUrl = response.url === '' ? target.toString() : response.url

    // The redirect has already been followed; what it landed on is judged like the first host.
    try {
      assertHostAllowed(options?.allowlist, new URL(finalUrl).hostname)
    } catch (err: unknown) {
      await response.body?.cancel().catch(() => undefined)

      throw err
    }

    return { response, finalUrl }
  },
  guardedLoopbackFetch: () =>
    Promise.reject(new ToolError('host_blocked', 'a page has no local endpoint to reach')),
}

// The owner's rule (`assertHostAllowlisted`): an absent or empty list allows every host, and an
// entry is a glob. It cannot be imported, since its file resolves names.
function assertHostAllowed(allowlist: readonly string[] | undefined, hostname: string): void {
  if (
    allowlist !== undefined &&
    allowlist.length > 0 &&
    !allowlist.some((h) => isGlobMatch(h, hostname))
  ) {
    throw new ToolError('host_blocked', `host ${hostname} is not in the agent allowlist`)
  }
}

function parsePublicUrl(raw: string): URL {
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
