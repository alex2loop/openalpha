import { ValidationError } from '@/core/errors'

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

export const LOCAL_USER_ID: UserId = userId('local')
export const DEFAULT_AGENT_ID: AgentId = agentId('chat')
