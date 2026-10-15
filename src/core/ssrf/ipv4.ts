const IPV4_OCTETS = 4
const IPV4_BITS = 32
const IPV4_ALL_ONES = 0xffffffff
// Canonical decimal octet: 0-255, no leading zeros (those read as octal in some HTTP clients).
const CANONICAL_OCTET_RE = /^(?:\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])$/

// RFC1918, loopback, link-local, CGNAT, benchmark, documentation, multicast, reserved
const BLOCKED_IP_RANGES: ReadonlyArray<{ prefix: number; bits: number }> = [
  { prefix: 0x00000000, bits: 8 }, // 0.0.0.0/8
  { prefix: 0x7f000000, bits: 8 }, // 127.0.0.0/8 loopback
  { prefix: 0xa9fe0000, bits: 16 }, // 169.254.0.0/16 link-local
  { prefix: 0x0a000000, bits: 8 }, // 10.0.0.0/8 RFC1918
  { prefix: 0xac100000, bits: 12 }, // 172.16.0.0/12 RFC1918
  { prefix: 0xc0a80000, bits: 16 }, // 192.168.0.0/16 RFC1918
  { prefix: 0x64400000, bits: 10 }, // 100.64.0.0/10 CGNAT/Tailscale
  { prefix: 0xc0000000, bits: 24 }, // 192.0.0.0/24 IETF protocol assignments
  { prefix: 0xc0000200, bits: 24 }, // 192.0.2.0/24 TEST-NET-1
  { prefix: 0xc6120000, bits: 15 }, // 198.18.0.0/15 benchmark
  { prefix: 0xc6336400, bits: 24 }, // 198.51.100.0/24 TEST-NET-2
  { prefix: 0xcb007100, bits: 24 }, // 203.0.113.0/24 TEST-NET-3
  { prefix: 0xe0000000, bits: 4 }, // 224.0.0.0/4 multicast
  { prefix: 0xf0000000, bits: 4 }, // 240.0.0.0/4 reserved
]

export function isBlockedIpv4(ip: string): boolean {
  const n = ipToInt(ip)

  if (n === null) {
    // fail-CLOSED - invalid IPv4 is refused, matching isBlockedIpv6 behaviour
    return true
  }

  for (const { prefix, bits } of BLOCKED_IP_RANGES) {
    const mask = bits === IPV4_BITS ? IPV4_ALL_ONES : ~(IPV4_ALL_ONES >>> bits)

    if ((n & (mask >>> 0)) >>> 0 === prefix >>> 0) {
      return true
    }
  }

  return false
}

function ipToInt(ip: string): number | null {
  const parts = ip.split('.')

  if (parts.length !== IPV4_OCTETS) {
    return null
  }

  let n = 0
  for (const p of parts) {
    // Shape first, then value. Number() alone is not a validator here: it reads '' as 0, tolerates
    // surrounding whitespace, and treats '1e2' as 100 — so 'a.b.c.' and '1e2.0.0.1' would parse
    // into an address that was never written, and this function must fail closed on both.
    if (!CANONICAL_OCTET_RE.test(p)) {
      return null
    }

    n = (n << 8) | Number(p)
  }

  return n >>> 0
}

// Convert a dotted-quad IPv4 suffix of an IPv6 literal (RFC 4291 §2.5.5, e.g. ::ffff:1.2.3.4)
// into two hex groups ('0102:0304' for 1.2.3.4), or null when it is not a valid IPv4.
export function resolveIpv4Suffix(right: string): string | null {
  const parts = right.split('.')

  if (parts.length !== IPV4_OCTETS || !parts.every((p) => CANONICAL_OCTET_RE.test(p))) {
    return null
  }

  const [a, b, c, d] = parts.map(Number)

  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    return null
  }

  const hi = ((a << 8) | b).toString(16).padStart(4, '0')
  const lo = ((c << 8) | d).toString(16).padStart(4, '0')

  return `${hi}:${lo}`
}
