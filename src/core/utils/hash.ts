import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

const HASH_STRING_LENGTH = 16

// 16-char sha256 prefix for content-dedup / loop-detection fingerprints (not security).
export function hashString(s: string): string {
  return sha256Hex(s).slice(0, HASH_STRING_LENGTH)
}

// Full lowercase SHA-256 hex digest of a string. Used for evidence-excerpt text hashing and
// persisted ids, where the full digest is the dedup/comparison key (not a security boundary).
export function sha256Hex(s: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(s)))
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
