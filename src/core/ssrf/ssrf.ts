import { abortError, ToolError } from '@/core/errors'
import { type DnsLookupFn, defaultDnsLookup } from '@/core/ssrf/dns'
import { isBlockedIpv4 } from '@/core/ssrf/ipv4'
import { isBlockedIpv6 } from '@/core/ssrf/ipv6'

// Cloud-metadata endpoints + container/host-network conventions. Pre-DNS glob match.
const BLOCKED_HOSTS: readonly string[] = [
  'localhost',
  '*.localhost',
  '*.local',
  '*.internal',
  'metadata.google.internal',
  'metadata.goog',
  'metadata.azure.com',
  '169.254.169.254', // AWS/GCP/Azure IMDS
  '*.compute.internal', // AWS
  'host.docker.internal',
  'gateway.docker.internal',
]

// Match any four-decimal-segment form (routes non-canonical octets to the strict parser for
// rejection), or IPv6 literals (requires ':'). Decimal-only so a four-label hex domain such as
// 'de.ad.be.ef' stays a hostname; URL parsing has already canonicalized real hex/octal literals.
const IP_LITERAL_RE = /^\d+(?:\.\d+){3}$|^\[?[0-9a-fA-F:.]*:[0-9a-fA-F:.]*\]?$/

// `localhost.` is the same host as `localhost`: DNS treats the trailing dot as the root label.
const TRAILING_DOT_RE = /\.$/

const IPV4_LITERAL_RE = /^\d{1,3}(\.\d{1,3}){3}$/

// WHATWG URL.hostname keeps brackets on IPv6 literals (e.g. '[::1]').
const IPV6_BRACKETS_RE = /^\[|\]$/g

// Canonical SSRF guard: parse URL, HTTPS-only, pre-DNS block, resolve ONCE, post-DNS block.
// Returns the resolved IP so callers can pin the TCP connection (prevents DNS rebinding
// between the SSRF check and the actual connect — the caller MUST use the returned IP).
export async function assertEndpointSafe(
  endpoint: string,
  signal: AbortSignal,
  lookup: DnsLookupFn = defaultDnsLookup
): Promise<string> {
  if (signal.aborted) {
    return Promise.reject(abortError(signal))
  }

  const { hostname } = parseHttpsUrl(endpoint)

  assertPreDnsSafe(hostname)

  return resolveSafeIp(hostname, signal, lookup)
}

// Parse + enforce HTTPS-only. The one URL-vetting entry shared with NetworkPolicy.guardedFetch.
export function parseHttpsUrl(endpoint: string): URL {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new ToolError('host_blocked', `malformed endpoint: ${endpoint}`)
  }

  if (url.protocol !== 'https:') {
    throw new ToolError('host_blocked', 'only HTTPS endpoints are allowed')
  }

  return url
}

function assertPreDnsSafe(hostname: string): void {
  const name = hostname.replace(TRAILING_DOT_RE, '')

  if (BLOCKED_HOSTS.some((h) => isGlobMatch(h, name))) {
    throw new ToolError('host_blocked', `host ${hostname} matches blocked-host pattern`)
  }
  if (!IP_LITERAL_RE.test(hostname)) {
    return
  }

  // isBlockedIp owns canonical form as well as range: a non-canonical literal (leading zeros, an
  // out-of-range octet, a malformed group) fails its parse and comes back blocked.
  if (isBlockedIp(stripBrackets(hostname))) {
    throw new ToolError('host_blocked', `host ${hostname} is not a routable public IP literal`)
  }
}

async function resolveSafeIp(
  hostname: string,
  signal: AbortSignal,
  lookup: DnsLookupFn
): Promise<string> {
  // Literal hosts skip DNS - the bare IP is vetted and pinned directly.
  const literal = asIpLiteral(hostname)

  if (literal !== null) {
    if (isBlockedIp(literal)) {
      throw new ToolError('host_blocked', 'endpoint is a blocked IP')
    }

    return literal
  }

  // Single DNS resolution — MUST NOT resolve again after this point.
  const address = await lookup(hostname, signal)

  if (isBlockedIp(address)) {
    throw new ToolError('host_blocked', `host ${hostname} resolves to blocked IP ${address}`)
  }

  return address
}

// Enforce the agent-level allowlist. Empty list = allow all.
export function assertHostAllowlisted(hosts: readonly string[], hostname: string): void {
  if (hosts.length === 0) {
    return
  }

  const allowed = hosts.some((h) => isGlobMatch(h, hostname))

  if (!allowed) {
    throw new ToolError('host_blocked', `host ${hostname} is not in the agent allowlist`)
  }
}

// Bracketed-IPv6 or dotted-quad hostname as a bare literal; null when the host needs DNS.
function asIpLiteral(hostname: string): string | null {
  if (hostname.includes(':')) {
    return stripBrackets(hostname)
  }
  if (IPV4_LITERAL_RE.test(hostname)) {
    return hostname
  }
  return null
}

function isBlockedIp(ip: string): boolean {
  return ip.includes(':') ? isBlockedIpv6(ip) : isBlockedIpv4(ip)
}

function stripBrackets(hostname: string): string {
  return hostname.replace(IPV6_BRACKETS_RE, '')
}

function isGlobMatch(pattern: string, hostname: string): boolean {
  if (pattern === '*') {
    return true
  }

  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1) // '.example.com'

    return hostname === pattern.slice(2) || hostname.endsWith(suffix)
  }

  return pattern === hostname
}
