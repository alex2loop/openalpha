import { createHash } from 'node:crypto'

// 16-char sha256 prefix for content-dedup / loop-detection fingerprints (not security).
export function hashString(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

// Full lowercase SHA-256 hex digest of a string via Web Crypto. Used for evidence-excerpt text
// hashing, where the full digest is the dedup/comparison key (not a security boundary).
export async function sha256Hex(s: string): Promise<string> {
  const data = new TextEncoder().encode(s)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return bufferToHex(digest)
}

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let out = ''
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0')
  }
  return out
}

/** JSON with every object's keys in code-unit order, so equal values always serialize alike. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value ?? null, sortKeys)
}

function sortKeys(_key: string, value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value
  }

  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => (left < right ? -1 : 1))
  )
}
