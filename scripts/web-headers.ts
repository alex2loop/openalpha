// The `_headers` file both static sites ship. Cloudflare applies it to every asset it serves; the
// hardening set is shared so the two sites cannot drift apart.
const NOINDEX_HEADER = 'X-Robots-Tag: noindex, nofollow'

const HARDENING_HEADERS: readonly string[] = [
  'Referrer-Policy: no-referrer',
  'X-Content-Type-Options: nosniff',
  'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
]

export interface HeadersOptions {
  /** A staging deploy asks crawlers to stay away; the real domain leaves it out. */
  readonly noindex: boolean
}

/** `directives` are joined as one policy, in the order given. */
export function buildHeadersFile(
  directives: readonly string[],
  options: HeadersOptions
): string {
  const headers = [
    `Content-Security-Policy: ${directives.join('; ')}`,
    ...HARDENING_HEADERS,
    ...(options.noindex ? [NOINDEX_HEADER] : []),
  ]

  return `/*\n${headers.map((header) => `  ${header}`).join('\n')}\n`
}

/** The directives no page of either site has a use for. */
export const LOCKED_DIRECTIVES: readonly string[] = [
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
]
