import type { NetworkPin, SocialEndpoint } from '@/social/types'
import { apiBasePath } from '@/social/pin/api-base'

const PARAM_SEGMENT_RE = /^\{[a-z0-9_]+\}$/
const PARAM_VALUE_RE = /^[A-Za-z0-9_-]+$/
/** Encoded dots and slashes, a backslash, a query or a fragment: none belongs in a path the model
 *  writes, and each is a way to make the normalised URL differ from the template it matched. */
const FORBIDDEN_PATH_RE = /(%2e|%2f|%5c|\\|\?|#)/i
const DOT_SEGMENTS: ReadonlySet<string> = new Set(['.', '..'])

type PathMatch =
  | { readonly kind: 'matched'; readonly endpoint: SocialEndpoint }
  | { readonly kind: 'refused' }
  | { readonly kind: 'unknown' }

export function matchEndpoint(pin: NetworkPin, method: string, path: string): PathMatch {
  if (!path.startsWith('/') || FORBIDDEN_PATH_RE.test(path)) {
    return { kind: 'refused' }
  }

  const segments = path.slice(1).split('/')

  if (segments.some((segment) => segment === '' || DOT_SEGMENTS.has(segment))) {
    return { kind: 'refused' }
  }

  // The most literal template wins: `/agents/{name}` must not take `/agents/me`'s label.
  const [endpoint] = pin.endpoints
    .filter((candidate) => candidate.method === method && isTemplateMatch(candidate.path, segments))
    .toSorted((a, b) => paramCount(a.path) - paramCount(b.path))

  return endpoint === undefined ? { kind: 'unknown' } : { kind: 'matched', endpoint }
}

function paramCount(template: string): number {
  return template.split('/').filter((part) => PARAM_SEGMENT_RE.test(part)).length
}

/** Belt to `matchEndpoint`'s braces: the URL actually built still sits under the API base. */
export function isUnderApiBase(apiBase: string, path: string): boolean {
  const base = new URL(apiBase)
  const prefix = apiBasePath(apiBase)
  const url = new URL(`${prefix}${path}`, base.origin)

  return url.origin === base.origin && url.pathname.startsWith(`${prefix}/`)
}

function isTemplateMatch(template: string, segments: readonly string[]): boolean {
  const parts = template.slice(1).split('/')

  return (
    parts.length === segments.length &&
    parts.every((part, index) => {
      const segment = segments[index] ?? ''

      return PARAM_SEGMENT_RE.test(part) ? PARAM_VALUE_RE.test(segment) : part === segment
    })
  )
}
