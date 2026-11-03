import { ValidationError } from '@/core/errors'

const UUID_BYTES = 16
const UUID_V7_TIMESTAMP_BYTES = 6
const UUID_V7_VERSION = 0x70
const UUID_V7_VARIANT = 0x80
const UUID_V7_COUNTER_MASK = 0xfff
// A fresh millisecond seeds below half the range, so a burst has room to count up without wrapping.
const UUID_V7_COUNTER_SEED_MASK = 0x7ff
const BYTE_RANGE = 256
const HEX_RADIX = 16
const ID_CHARSET = /^[a-z0-9_-]{1,64}$/i
const PATH_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/

export type BrandTag<B extends string> = { readonly __brand: B }

export type SessionId = string & BrandTag<'SessionId'>
export type AgentId = string & BrandTag<'AgentId'>
export type RunId = string & BrandTag<'RunId'>
export type LLMAttemptId = string & BrandTag<'LLMAttemptId'>
export type UserId = string & BrandTag<'UserId'>
export type JobId = string & BrandTag<'JobId'>
export type HeartbeatCommitmentId = string & BrandTag<'HeartbeatCommitmentId'>

function invalidId(raw: string, label: string): ValidationError {
  return new ValidationError(`invalid ${label}: ${raw}`, {
    key: 'errors.idInvalid',
    params: { value: raw },
  })
}

function brandId<T extends string>(raw: string, label: string): T {
  if (!ID_CHARSET.test(raw)) {
    throw invalidId(raw, label)
  }
  // This function is the sole place a brand is minted, and the guard above is the brand's only
  // invariant.
  // why-safe: a `raw` that reaches here already satisfies `string & BrandTag`.
  return raw as T
}

function brandPathId<T extends string>(raw: string, label: string): T {
  if (!isPathId(raw)) {
    throw invalidId(raw, label)
  }

  // why-safe: the shared path-id guard above is the branded path identifier's only invariant.
  return raw as T
}

export function isPathId(raw: string): boolean {
  return PATH_ID_RE.test(raw)
}

export function sessionId(raw: string): SessionId {
  return brandId(raw, 'SessionId')
}

export function agentId(raw: string): AgentId {
  return brandPathId<AgentId>(raw, 'AgentId')
}

export function runId(raw: string): RunId {
  return brandId(raw, 'RunId')
}

export function llmAttemptId(raw: string): LLMAttemptId {
  return brandId(raw, 'LLMAttemptId')
}

export function userId(raw: string): UserId {
  return brandId(raw, 'UserId')
}

export function jobId(raw: string): JobId {
  return brandId(raw, 'JobId')
}

export function heartbeatCommitmentId(raw: string): HeartbeatCommitmentId {
  return brandId(raw, 'HeartbeatCommitmentId')
}

// Ids minted inside one millisecond must still sort in mint order, so the 12 bits after the version
// carry a counter (RFC 9562 method 1). The state is the generator's own, never a run's.
let lastTimestampMs = -1
let counter = 0

/** A UUIDv7 stamped `timestampMs`, same-millisecond mints ascending. */
export function buildUuidV7(timestampMs: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(UUID_BYTES))

  // Order holds only within the 12-bit counter range per millisecond; a different `timestampMs` reseeds it.
  counter =
    timestampMs === lastTimestampMs
      ? (counter + 1) & UUID_V7_COUNTER_MASK
      : (((bytes[6] ?? 0) << 8) | (bytes[7] ?? 0)) & UUID_V7_COUNTER_SEED_MASK
  lastTimestampMs = timestampMs

  for (let index = 0; index < UUID_V7_TIMESTAMP_BYTES; index++) {
    bytes[index] =
      Math.floor(timestampMs / BYTE_RANGE ** (UUID_V7_TIMESTAMP_BYTES - 1 - index)) % BYTE_RANGE
  }

  bytes[6] = UUID_V7_VERSION | (counter >> 8)
  bytes[7] = counter & (BYTE_RANGE - 1)
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | UUID_V7_VARIANT

  const hex = [...bytes].map((byte) => byte.toString(HEX_RADIX).padStart(2, '0')).join('')

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export const LOCAL_USER_ID: UserId = userId('local')
export const DEFAULT_AGENT_ID: AgentId = agentId('chat')
