// The `_headers` file both static sites ship. Cloudflare applies it to every asset it serves; the
// hardening set is shared so the two sites cannot drift apart.
const NOINDEX_HEADER = 'X-Robots-Tag: noindex, nofollow'
// Cloudflare drops a `_headers` line past this length, and the policy line grows with every
// host.
const MAXIMUM_LINE_LENGTH = 2000

const HARDENING_HEADERS: readonly string[] = [
  'Strict-Transport-Security: max-age=31536000; includeSubDomains',
  'Referrer-Policy: no-referrer',
  'X-Content-Type-Options: nosniff',
  'Cross-Origin-Opener-Policy: same-origin',
  'Cross-Origin-Resource-Policy: same-origin',
  'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()',
]

/** The directives no page of either site has a use for. */
export const LOCKED_DIRECTIVES: readonly string[] = [
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
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

  const lines = headers.map((header) => `  ${header}`)
  const tooLong = lines.find((line) => line.length > MAXIMUM_LINE_LENGTH)

  if (tooLong !== undefined) {
    throw new Error(
      `web-headers: a _headers line is ${tooLong.length} characters, over the ` +
        `${MAXIMUM_LINE_LENGTH} Cloudflare allows: ${tooLong.slice(0, 40)}...`
    )
  }

  return `/*\n${lines.join('\n')}\n`
}
