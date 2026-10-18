import { randomUUID } from 'node:crypto'

import type { z } from 'zod'

import type { Logger } from '@/core/logging/logger'
import type { Budget } from '@/core/types/budget'
import type { Locale } from '@/core/types/locale'
import type { Runner, RunResult } from '@/engine/api'
import type { SuggestionRequest } from '@/trading/features/suggestion/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { DebateRole } from '@/trading/kernel/config'
import { agentId, LOCAL_USER_ID, sessionId } from '@/core/ids'
import { scrubCredentials } from '@/core/security/credentials'
import {
  isRetryableHalt,
  languageName,
  parseResearchJson,
  toResearchOutputContract,
} from '@/engine/api'
import { languageIssues } from '@/trading/features/suggestion/debate/language'

// A failed role is diagnosed from its log line alone — the persona's own transcript is hidden and
// its budget slice is spent — so both failure lines carry what distinguishes one cause from the
// next, bounded so a runaway message cannot flood the log.
const MAXIMUM_LOGGED_ISSUES = 3
const MAXIMUM_LOGGED_ERROR_CHARS = 200
const MAXIMUM_REPAIR_ISSUES = 5
const SETUP_HALT_CAUSE = 'setup'

export interface RoleRunDeps {
  readonly runner: Runner
  readonly logger: Logger
  readonly maximumTurnsPerRole: number
}

/** The role's own output schema: parsed once, and rendered into its strict JSON contract. */
export type RoleSchema<T> = z.ZodType<T>

/** A role's prompt in two halves. `instructions` is what every call of the role shares on one
 *  market and rides the system prompt, where a provider's prompt cache serves it; `message` is this
 *  call's evidence. Anything that differs per call belongs in `message`. */
export interface RolePrompt {
  readonly instructions: string
  readonly message: string
}

interface RoleRunContext<T> {
  readonly role: DebateRole
  readonly prompt: RolePrompt
  /** Keeps a role's calls on one market on the endpoint whose cache holds its instructions. */
  readonly routingKey: string
  readonly schema: RoleSchema<T>
  readonly request: SuggestionRequest
  readonly budget: Budget
  readonly signal: AbortSignal
  /** Spend lands here whether the role answers, halts, or fails its schema. */
}

export type RoleRunResult<T> =
  | { readonly kind: 'value'; readonly value: T; readonly modelName?: string }
  | { readonly kind: 'failed'; readonly caveat: Caveat }

/** The failed arm alone, so a helper that only ever fails does not name a value type it cannot
 *  produce. It is assignable to `RoleRunResult<T>` for every `T`. */
type RoleFailure = Extract<RoleRunResult<never>, { readonly kind: 'failed' }>

/** One call to a persona, before the caller decides what a failure means. */
type RoleAttempt<T> =
  | { readonly kind: 'value'; readonly value: T; readonly modelName?: string }
  | { readonly kind: 'halted'; readonly result: RunResult }
  | { readonly kind: 'invalid'; readonly issues: readonly string[] }

/** The one place a persona call is constructed. Every control is applied unconditionally
 *  regardless of role or mode: the role's registered trusted profile, a strict JSON output
 *  contract, hidden answer and reasoning, ephemeral persistence, a unique child session id, the
 *  parent run's billing and run identity, the caller's locale, an already-sliced budget this
 *  function never subdivides, the configured turn cap, and the caller's combined abort signal. Six
 *  personas means six chances to omit one if this were inlined per role.
 *
 *  A persona carries no tools at all, which is what lets the output contract be enforced on the
 *  wire: a provider drops a schema it cannot reconcile with a tool list, and a persona's methods
 *  arrive in its prompt rather than through a call it would have to choose to make.
 *
 *  A persona is asked at most twice, for the two failures a second ask can clear. An answer that
 *  failed the schema is re-asked carrying what failed: re-sending the identical prompt asks the
 *  model to guess which field it got wrong. A run the provider chain could not place at all is
 *  re-asked unchanged, because the chain waits out its cooldown before the next attempt. A second
 *  failure is the caller's cue to yield hold. */
export async function runRole<T>(
  deps: RoleRunDeps,
  context: RoleRunContext<T>
): Promise<RoleRunResult<T>> {
  const first = await attemptRole(deps, context)
  const second = await reattemptRole(deps, context, first)

  return toRoleResult(deps, context.role, second ?? first)
}

/** Undefined when the first answer stands — as a value, or as a failure a second ask cannot fix. */
async function reattemptRole<T>(
  deps: RoleRunDeps,
  context: RoleRunContext<T>,
  first: RoleAttempt<T>
): Promise<RoleAttempt<T> | undefined> {
  if (first.kind === 'invalid') {
    deps.logger.warn('trading.debate_role_repaired', {
      role: context.role,
      issueCount: first.issues.length,
      issues: first.issues.slice(0, MAXIMUM_LOGGED_ISSUES),
    })

    return attemptRole(deps, { ...context, prompt: repairPrompt(context.prompt, first.issues) })
  }

  if (first.kind === 'halted' && isRetryableHalt(first.result) && !context.signal.aborted) {
    deps.logger.warn('trading.debate_role_retried', {
      role: context.role,
      cause: haltCause(first.result),
    })

    return attemptRole(deps, context)
  }

  return undefined
}

/** Zod issues are `path: message` over the model's own output, so they name the offending field
 *  without quoting anything back to it. */
function repairPrompt(prompt: RolePrompt, issues: readonly string[]): RolePrompt {
  return {
    ...prompt,
    message: [
      prompt.message,
      '',
      'Your previous answer was rejected against this schema:',
      ...issues.slice(0, MAXIMUM_REPAIR_ISSUES).map((issue) => `- ${issue}`),
      'Answer again, correcting those fields and changing nothing else.',
    ].join('\n'),
  }
}

function toRoleResult<T>(
  deps: RoleRunDeps,
  role: DebateRole,
  attempt: RoleAttempt<T>
): RoleRunResult<T> {
  if (attempt.kind === 'value') {
    return attempt
  }

  return attempt.kind === 'halted'
    ? haltFailure(deps, role, attempt.result)
    : invalidOutputFailure(deps, role, attempt.issues)
}

async function attemptRole<T>(
  deps: RoleRunDeps,
  context: RoleRunContext<T>
): Promise<RoleAttempt<T>> {
  const result = await deps.runner.run(
    {
      agentId: agentId(context.role),
      sessionId: sessionId(randomUUID()),
      userId: LOCAL_USER_ID,
      channel: context.request.channel,
      userMessage: localizedMessage(context.prompt.message, context.request.locale),
    },
    {
      instructions: context.prompt.instructions,
      routingKey: context.routingKey,
      persistence: 'ephemeral',
      parentSignal: context.signal,
      budgetSlice: context.budget,
      outputContract: toResearchOutputContract(context.role, context.schema),
      answerVisibility: 'hidden',
      reasoningVisibility: 'hidden',
      maxTurns: deps.maximumTurnsPerRole,
      billingSessionId: context.request.billingSessionId,
      ...(context.request.billingAgentId === undefined
        ? {}
        : { billingAgentId: context.request.billingAgentId }),
      ...(context.request.parentRunId === undefined
        ? {}
        : { parentRunId: context.request.parentRunId }),
    }
  )

  if (result.reason !== 'completed') {
    return { kind: 'halted', result }
  }

  const parsed = parseResearchJson(context.schema, result.text)

  if (parsed.kind === 'invalid') {
    return { kind: 'invalid', issues: parsed.issues }
  }

  const language = languageIssues(context.request.locale, parsed.value)

  if (language.length > 0) {
    return { kind: 'invalid', issues: language }
  }

  return {
    kind: 'value',
    value: parsed.value,
    ...(result.totals.modelName === undefined ? {} : { modelName: result.totals.modelName }),
  }
}

/** The debate's prose is stored under the suggestion's `authoredLocale`, so the request's locale —
 *  not the process locale the engine's system block carries — is what a persona writes in. Naming
 *  the ids and enums keeps a translated `stance` from failing the schema. */
function localizedMessage(message: string, locale: Locale): string {
  return [
    message,
    '',
    `Write every free-text field in ${languageName(locale)}.`,
    'Leave ids, enum values, and URLs exactly as specified.',
  ].join('\n')
}

/** What the operator can act on, most specific first: which ceiling refused the call or how the
 *  provider classified its own refusal, then the halt code, then the bare reason. A blocked plan
 *  and a provider blip both halt as `llm_error`, and only one of them clears by running again. */
function haltCause(result: RunResult): string {
  // A failure worded for the operator is setup they must fix, which no retry clears.
  if (result.operator !== undefined) {
    return SETUP_HALT_CAUSE
  }

  return result.haltDetail ?? result.haltCode ?? result.reason
}

/** The run did not complete: a budget slice, the turn cap, the loop guard, or a transport error.
 *  Only the engine's own message separates those, so it is what the log carries. */
function haltFailure(deps: RoleRunDeps, role: DebateRole, result: RunResult): RoleFailure {
  deps.logger.warn('trading.debate_role_halted', {
    role,
    reason: result.reason,
    ...(result.haltCode === undefined ? {} : { haltCode: result.haltCode }),
    ...(result.errorMessage === undefined
      ? {}
      : {
          errorMessage: scrubCredentials(result.errorMessage).slice(0, MAXIMUM_LOGGED_ERROR_CHARS),
        }),
  })

  return {
    kind: 'failed',
    caveat: {
      code: 'suggestion.debate-degraded',
      detail: {
        role,
        cause: haltCause(result),
        ...(result.missingEnv === undefined ? {} : { env: result.missingEnv }),
      },
    },
  }
}

/** The run completed but its text did not satisfy the role's schema. The issues name which field
 *  failed, which is what separates a truncated payload from a wrong shape. */
function invalidOutputFailure(
  deps: RoleRunDeps,
  role: DebateRole,
  issues: readonly string[]
): RoleFailure {
  deps.logger.warn('trading.debate_role_invalid_output', {
    role,
    issueCount: issues.length,
    issues: issues.slice(0, MAXIMUM_LOGGED_ISSUES),
  })

  return {
    kind: 'failed',
    caveat: { code: 'suggestion.debate-degraded', detail: { role, cause: 'invalid-output' } },
  }
}
