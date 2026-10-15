import { z } from 'zod'

import type { HeartbeatCommitmentId } from '@/core/ids'
import type { HeartbeatCommitmentInput } from '@/scheduler/heartbeat/types'
import { MS_PER_DAY, MS_PER_MINUTE } from '@/core/utils/time'

// Fixed protocol safety invariants that bound untrusted model output. They are not runtime tuning.
const HEARTBEAT_RESPONSE_PREFIX = '[HEARTBEAT_RESPOND]'
const MAX_COMMITMENTS_PER_RESPONSE = 5
const MAX_COMMITMENT_PROMPT_CHARS = 500
const MIN_COMMITMENT_DELAY_MS = MS_PER_MINUTE
const MAX_COMMITMENT_DELAY_MS = 30 * MS_PER_DAY
const EMPTY_COMMITMENT_INPUTS: readonly HeartbeatCommitmentInput[] = []

export const HEARTBEAT_RESPONSE_INSTRUCTION = `Return exactly one structured heartbeat response.
To notify:
[HEARTBEAT_RESPOND] {"notify":true,"summary":"operator-visible text","commitments":[]}
To stay silent:
[HEARTBEAT_RESPOND] {"notify":false,"commitments":[]}
Return at most ${MAX_COMMITMENTS_PER_RESPONSE} commitments.
Each commitment prompt is at most ${MAX_COMMITMENT_PROMPT_CHARS} characters.
Each dueInMs is an integer from ${MIN_COMMITMENT_DELAY_MS} through ${MAX_COMMITMENT_DELAY_MS}.`

const HEARTBEAT_COMMITMENT_INPUT_SCHEMA = z.strictObject({
  prompt: z.string().trim().min(1).max(MAX_COMMITMENT_PROMPT_CHARS),
  dueInMs: z.int().min(MIN_COMMITMENT_DELAY_MS).max(MAX_COMMITMENT_DELAY_MS),
})

const HEARTBEAT_SILENT_SCHEMA = z.strictObject({
  notify: z.literal(false),
  commitments: z
    .array(HEARTBEAT_COMMITMENT_INPUT_SCHEMA)
    .max(MAX_COMMITMENTS_PER_RESPONSE)
    .optional(),
})

const HEARTBEAT_NOTIFY_SCHEMA = z.strictObject({
  notify: z.literal(true),
  summary: z.string().trim().min(1),
  commitments: z
    .array(HEARTBEAT_COMMITMENT_INPUT_SCHEMA)
    .max(MAX_COMMITMENTS_PER_RESPONSE)
    .optional(),
})

// `notify` is the existing wire discriminator, so a discriminated union selects the right branch
// in one pass instead of trying both object schemas in order.
const HEARTBEAT_RESPOND_SCHEMA = z.discriminatedUnion('notify', [
  HEARTBEAT_SILENT_SCHEMA,
  HEARTBEAT_NOTIFY_SCHEMA,
])

type HeartbeatResponseErrorCode = 'missing_prefix' | 'invalid_json' | 'invalid_payload'

export type HeartbeatResponse =
  | {
      readonly kind: 'silent'
      readonly commitments: readonly HeartbeatCommitmentInput[]
    }
  | {
      readonly kind: 'notify'
      readonly text: string
      readonly commitments: readonly HeartbeatCommitmentInput[]
    }
  | { readonly kind: 'invalid'; readonly code: HeartbeatResponseErrorCode }

/** What a visit that ended at its own turn cap settles with, so it completes without a parse. */
export const SILENT_HEARTBEAT_RESPONSE: HeartbeatResponse = Object.freeze({
  kind: 'silent',
  commitments: EMPTY_COMMITMENT_INPUTS,
})

interface HeartbeatTaskOutcome {
  readonly notificationText?: string
  readonly consumedCommitmentIds: readonly HeartbeatCommitmentId[]
  readonly newCommitmentInputs: readonly HeartbeatCommitmentInput[]
}

export function parseHeartbeatResponse(text: string): HeartbeatResponse {
  const trimmed = text.trim()

  if (!trimmed.startsWith(HEARTBEAT_RESPONSE_PREFIX)) {
    return { kind: 'invalid', code: 'missing_prefix' }
  }

  const payload = trimmed.slice(HEARTBEAT_RESPONSE_PREFIX.length).trim()

  let parsed: unknown

  try {
    parsed = JSON.parse(payload)
  } catch {
    return { kind: 'invalid', code: 'invalid_json' }
  }

  const result = HEARTBEAT_RESPOND_SCHEMA.safeParse(parsed)

  if (!result.success) {
    return { kind: 'invalid', code: 'invalid_payload' }
  }

  const value = result.data
  const commitments = value.commitments ?? EMPTY_COMMITMENT_INPUTS

  if (value.notify) {
    return { kind: 'notify', text: value.summary, commitments }
  }

  return { kind: 'silent', commitments }
}

// The sole place a response's state becomes persistence and delivery state. Every branch is
// exhaustive over HeartbeatResponse so a new kind forces an update here.
export function toHeartbeatTaskOutcome(
  response: HeartbeatResponse,
  presentedCommitmentIds: readonly HeartbeatCommitmentId[]
): HeartbeatTaskOutcome {
  switch (response.kind) {
    case 'invalid':
      // Invalid output advances cadence but leaves presented commitments to return next run.
      return {
        consumedCommitmentIds: [],
        newCommitmentInputs: EMPTY_COMMITMENT_INPUTS,
      }
    case 'silent':
      return {
        consumedCommitmentIds: presentedCommitmentIds,
        newCommitmentInputs: response.commitments,
      }
    case 'notify':
      return {
        notificationText: response.text,
        consumedCommitmentIds: presentedCommitmentIds,
        newCommitmentInputs: response.commitments,
      }
    default: {
      const unreachable: never = response
      return unreachable
    }
  }
}
