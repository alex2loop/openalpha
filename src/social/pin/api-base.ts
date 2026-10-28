import type { FetchFn } from '@/core/ssrf/pinned-fetch'
import { ValidationError } from '@/core/errors'
import { NetworkPolicy } from '@/core/ssrf/network-policy'
import { withoutTrailingSlashes } from '@/core/utils/url'

const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/
const LOCAL_HOST = 'localhost'
const LOCAL_SUFFIX = '.localhost'
const TRAILING_DOT = /\.$/
const HTTPS_DEFAULT_PORT = ''

/** The API host is the operator's choice, not code's, so these checks are its SSRF stance: https on
 *  the default port, no credentials in the URL, and a name rather than an address or localhost. */
export function toApiBase(raw: string): string {
  const url = parseUrl(raw)
  const host = url.hostname.replace(TRAILING_DOT, '')

  if (
    url.protocol !== 'https:' ||
    url.port !== HTTPS_DEFAULT_PORT ||
    url.username !== '' ||
    url.password !== '' ||
    IPV4_LITERAL.test(host) ||
    host.startsWith('[') ||
    host === LOCAL_HOST ||
    host.endsWith(LOCAL_SUFFIX)
  ) {
    throw new ValidationError(`api base '${raw}' is not a public https host`, {
      key: 'social.badApiBase',
      params: { url: raw },
    })
  }

  return `${url.origin}${withoutTrailingSlashes(url.pathname)}`
}

/** The fetch for one request to the network: it dials the address the SSRF check cleared for the
 *  API host just now, so a DNS answer that changes before the dial cannot reach a private one. */
export async function pinnedApiFetch(apiBase: string, signal: AbortSignal): Promise<FetchFn> {
  return await NetworkPolicy.pinnedPublicFetch(apiBase, signal)
}

/** The base's path with no trailing slash, and `''` for a base that has none (`https://x.example`),
 *  so `${apiBasePath(base)}${path}` is never `//posts`. */
export function apiBasePath(apiBase: string): string {
  const path = new URL(apiBase).pathname

  return path === '/' ? '' : path
}

function parseUrl(raw: string): URL {
  try {
    return new URL(raw)
  } catch {
    throw new ValidationError(`api base '${raw}' is not a URL`, {
      key: 'social.badApiBase',
      params: { url: raw },
    })
  }
}
