import { isBlockedIpv4, resolveIpv4Suffix } from '@/core/ssrf/ipv4'

const IPV6_GROUPS = 8
const IPV6_BITS = 128n
const IPV6_ALL_ONES = (1n << IPV6_BITS) - 1n
const HEX_GROUP_WIDTH = 4
const ZERO_GROUP = '0'.repeat(HEX_GROUP_WIDTH)
const IPV4_SUFFIX_BITS = 32n
const IPV4_SUFFIX_MASK = (1n << IPV4_SUFFIX_BITS) - 1n
const COLONS_RE = /:/g

// Blocked IPv6 ranges - 128-bit BigInt masking with correct CIDR boundaries.
// Prefixes expressed as 32-char hex strings (no colons); bits = prefix length.
const BLOCKED_IPV6_RANGES: ReadonlyArray<{ prefix: string; bits: bigint }> = [
  { prefix: '00000000000000000000000000000000', bits: 128n }, // :: (unspecified)
  { prefix: '00000000000000000000000000000001', bits: 128n }, // ::1 loopback
  { prefix: 'fe800000000000000000000000000000', bits: 10n }, // fe80::/10 link-local
  { prefix: 'fc000000000000000000000000000000', bits: 7n }, // fc00::/7 ULA (fc+fd)
  { prefix: 'fec00000000000000000000000000000', bits: 10n }, // fec0::/10 site-local (deprecated)
  { prefix: 'ff000000000000000000000000000000', bits: 8n }, // ff00::/8 multicast
  { prefix: '20010db8000000000000000000000000', bits: 32n }, // 2001:db8::/32 documentation
]

// Valid hex group: 1-4 hex chars (used to reject non-hex groups like 'gggg').
const HEX_GROUP_RE = /^[0-9a-f]{1,4}$/
// IPv4-mapped ::ffff:0:0/96 (RFC 4291 §2.5.5.2): top 96 bits fixed, low 32 carry the IPv4.
const IPV4_MAPPED_PREFIX = BigInt('0x00000000000000000000ffff00000000')
// IPv4-translated ::ffff:0:0:0/96 (RFC 2765) carries an IPv4 the same way; a SIIT gateway dials it.
const IPV4_TRANSLATED_PREFIX = BigInt('0x0000000000000000ffff000000000000')
const IPV4_MAPPED_MASK = IPV6_ALL_ONES ^ IPV4_SUFFIX_MASK

// NAT64 well-known prefix (RFC 6052): 64:ff9b::/96 carries an IPv4 in the low 32 bits.
const NAT64_PREFIX = BigInt('0x0064ff9b000000000000000000000000')
const NAT64_MASK = BigInt('0xffffffffffffffffffffffff00000000')

// NAT64 local-use prefix (RFC 8215): 64:ff9b:1::/48. Embeds the IPv4 per RFC 6052 §2.2's general
// format for PL=48 — bits 48-71 carry the address's top 24 bits, bits 72-79 are a reserved 'u'
// octet, bits 80-87 carry the last 8 bits, and bits 88-127 are a zero suffix.
const NAT64_LOCAL_PREFIX = BigInt('0x0064ff9b000100000000000000000000')
const NAT64_LOCAL_BITS = 48n
const NAT64_LOCAL_HIGH_SHIFT = 56n
const NAT64_LOCAL_LOW_SHIFT = 40n
const IPV4_HIGH24_MASK = 0xffffffn
const IPV4_LOW8_MASK = 0xffn

// 6to4 prefix (RFC 3056): 2002::/16 carries an IPv4 in bits 16-47.
const SIXTO4_PREFIX = BigInt('0x20020000000000000000000000000000')
const SIXTO4_MASK = BigInt('0xffff0000000000000000000000000000')

// Teredo prefix (RFC 4380 §4): 2001::/32 embeds the server IPv4 in the clear (bits 32-63) and the
// client IPv4 XORed with all ones (bits 96-127).
const TEREDO_PREFIX = BigInt('0x20010000000000000000000000000000')
const TEREDO_MASK = BigInt('0xffffffff000000000000000000000000')

interface Ipv6Split {
  readonly left: readonly string[]
  readonly right: readonly string[]
  readonly doubleColon: boolean
}

// Expects a bare (bracket-free) literal - callers strip URL '[...]' brackets first.
export function isBlockedIpv6(ip: string): boolean {
  const expanded = expandIpv6(ip)

  // fail-CLOSED - malformed IPv6 is refused, not allowed
  if (!expanded) {
    return true
  }

  const addr = BigInt(`0x${expanded.replace(COLONS_RE, '')}`)

  if (hasBlockedEmbeddedIpv4(addr)) {
    return true
  }

  for (const { prefix, bits } of BLOCKED_IPV6_RANGES) {
    const mask = prefixMask(bits)

    if ((addr & mask) === (BigInt(`0x${prefix}`) & mask)) {
      return true
    }
  }

  return false
}

function expandIpv6(raw: string): string | null {
  // Strip IPv6 zone ID (RFC 6874): fe80::1%eth0 -> fe80::1.
  const zoneIdx = raw.indexOf('%')
  const stripped = zoneIdx === -1 ? raw : raw.slice(0, zoneIdx)
  const split = splitIpv6Groups(stripped.toLowerCase())
  const right = resolveEmbeddedIpv4(split.right)

  if (right === null) {
    return null
  }

  const groups = assembleIpv6Groups(split, right)

  if (groups === null) {
    return null
  }

  return groups.map((g) => g.padStart(HEX_GROUP_WIDTH, '0')).join(':')
}

function splitIpv6Groups(lower: string): Ipv6Split {
  const dIdx = lower.indexOf('::')

  if (dIdx === -1) {
    return { left: lower.split(':'), right: [], doubleColon: false }
  }

  const left = dIdx > 0 ? lower.slice(0, dIdx).split(':') : []
  const right = dIdx + 2 < lower.length ? lower.slice(dIdx + 2).split(':') : []

  return { left, right, doubleColon: true }
}

// Last group may be an embedded IPv4 suffix (::ffff:1.2.3.4) - replace it with its
// two hex groups. Returns null when a dotted last group is not a valid IPv4.
function resolveEmbeddedIpv4(right: readonly string[]): readonly string[] | null {
  const last = right.at(-1)

  if (last === undefined || !last.includes('.')) {
    return right
  }

  const hexPair = resolveIpv4Suffix(last)

  if (hexPair === null) {
    return null
  }

  return [...right.slice(0, -1), ...hexPair.split(':')]
}

function assembleIpv6Groups(split: Ipv6Split, right: readonly string[]): readonly string[] | null {
  const missing = IPV6_GROUPS - split.left.length - right.length

  // RFC 4291: '::' represents one or more zero groups, so at least 1 must be inserted;
  // without '::' the address must already have exactly 8 groups (fail-closed on short forms).
  if (split.doubleColon && missing < 1) {
    return null
  }
  if (!split.doubleColon && missing !== 0) {
    return null
  }

  const groups = [...split.left, ...Array(missing).fill(ZERO_GROUP), ...right]

  if (groups.some((g) => !HEX_GROUP_RE.test(g))) {
    return null
  }

  return groups
}

function hasBlockedEmbeddedIpv4(addr: bigint): boolean {
  const prefix96 = addr & IPV4_MAPPED_MASK

  if (prefix96 === IPV4_MAPPED_PREFIX || prefix96 === IPV4_TRANSLATED_PREFIX) {
    return isBlockedIpv4(bigIntToIpv4(addr))
  }

  if ((addr & NAT64_MASK) === NAT64_PREFIX) {
    return isBlockedIpv4(bigIntToIpv4(addr))
  }

  const nat64LocalMask = prefixMask(NAT64_LOCAL_BITS)

  if ((addr & nat64LocalMask) === (NAT64_LOCAL_PREFIX & nat64LocalMask)) {
    const high = (addr >> NAT64_LOCAL_HIGH_SHIFT) & IPV4_HIGH24_MASK
    const low = (addr >> NAT64_LOCAL_LOW_SHIFT) & IPV4_LOW8_MASK
    return isBlockedIpv4(bigIntToIpv4((high << 8n) | low))
  }

  if ((addr & SIXTO4_MASK) === SIXTO4_PREFIX) {
    const embedded = (addr >> 80n) & IPV4_SUFFIX_MASK
    return isBlockedIpv4(bigIntToIpv4(embedded))
  }

  if ((addr & TEREDO_MASK) === TEREDO_PREFIX) {
    const server = (addr >> 64n) & IPV4_SUFFIX_MASK
    const client = (addr & IPV4_SUFFIX_MASK) ^ IPV4_SUFFIX_MASK
    return isBlockedIpv4(bigIntToIpv4(server)) || isBlockedIpv4(bigIntToIpv4(client))
  }

  // IPv4-compatible ::x.x.x.x (RFC 4291 §2.5.5.1) - top 96 bits all zero.
  // Unspecified (::) and loopback (::1) are caught by BLOCKED_IPV6_RANGES,
  // so we only need to check values > 1.
  const top96 = addr >> IPV4_SUFFIX_BITS
  const bottom32 = addr & IPV4_SUFFIX_MASK

  if (top96 === 0n && bottom32 > 1n) {
    return isBlockedIpv4(bigIntToIpv4(bottom32))
  }

  return false
}

function bigIntToIpv4(n: bigint): string {
  const v = Number(n & IPV4_SUFFIX_MASK)
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff].join('.')
}

// Mask covering the top `bits` of a 128-bit address (CIDR prefix mask).
function prefixMask(bits: bigint): bigint {
  return IPV6_ALL_ONES ^ ((1n << (IPV6_BITS - bits)) - 1n)
}
