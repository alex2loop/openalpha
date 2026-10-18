import { randomUUID } from 'node:crypto'

import type { z } from 'zod'

import type { ChannelId } from '@/core/channels'
import type { SessionId } from '@/core/ids'
import type { JsonOutputContract } from '@/core/llm'
import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { ParentLink, Runner, RunResult } from '@/engine/api'
import type { CheckResult } from '@/trading/features/themes/analyst/checks'
import type { ThemeRunNote, ThemeStepFailure } from '@/trading/features/themes/types'
import { agentId, LOCAL_USER_ID, sessionId } from '@/core/ids'
import { scrubCredentials } from '@/core/security/credentials'
import { isRetryableHalt, parseResearchJson } from '@/engine/api'
import { THEME_ANALYST_AGENT_ID } from '@/trading/kernel/config'

const RESEARCH_TOOL = 'research'
/** One turn to research, one to answer, room for a tool error in between. */
const MAXIMUM_TURNS = 4
const MAXIMUM_REPAIR_ISSUES = 5
const MAXIMUM_LOGGED_ISSUES = 3
const MAXIMUM_LOGGED_ERROR_CHARS = 200

export interface AnalystDeps {
  readonly runner: Pick<Runner, 'run'>
  readonly logger: Logger
}

/** Shared by every call of one `/themes` run: one budget and one research quota for the lot. */
export interface AnalystSession {
  readonly channel: ChannelId
  readonly locale: Locale
  readonly billingSessionId: SessionId | null
  readonly parent: ParentLink
  readonly signal: AbortSignal
}

interface AnalystCall<T, R> {
  readonly subject: string
  readonly instructions: string
  readonly message: string
  readonly reply: { readonly schema: z.ZodType<T>; readonly contract: JsonOutputContract }
  readonly check: (value: T) => CheckResult<R>
  readonly session: AnalystSession
  /** Off where the message already carries every figure the answer may rest on. */
  readonly research: boolean
}

export type AnalystResult<R> =
  | { readonly kind: 'value'; readonly value: R; readonly model?: string }
  | { readonly kind: 'failed'; readonly failure: Pick<ThemeRunNote, 'cause' | 'env'> }

type Attempt<R> =
  | { readonly kind: 'value'; readonly value: R; readonly model?: string }
  | { readonly kind: 'halted'; readonly result: RunResult }
  | { readonly kind: 'invalid'; readonly issues: readonly string[] }

/** A repair re-asks without tools: a provider drops the output contract while tools are offered,
 *  and the contract is what the repair is for. */
async function attempt<T, R>(
  deps: AnalystDeps,
  call: AnalystCall<T, R>,
  allowResearch: boolean
): Promise<Attempt<R>> {
  const result = await deps.runner.run(
    {
      agentId: agentId(THEME_ANALYST_AGENT_ID),
      sessionId: sessionId(randomUUID()),
      userId: LOCAL_USER_ID,
      channel: call.session.channel,
      userMessage: call.message,
    },
    {
      instructions: call.instructions,
      persistence: 'ephemeral',
      parentSignal: call.session.signal,
      parent: call.session.parent,
      outputContract: call.reply.contract,
      answerVisibility: 'hidden',
      reasoningVisibility: 'hidden',
      maxTurns: MAXIMUM_TURNS,
      allowedTools: allowResearch ? [RESEARCH_TOOL] : [],
      billingSessionId: call.session.billingSessionId,
    }
  )

  if (result.reason !== 'completed') {
    return { kind: 'halted', result }
  }

  const parsed = parseResearchJson(call.reply.schema, result.text)
  const checked = parsed.kind === 'invalid' ? parsed : call.check(parsed.value)

  if (checked.kind === 'invalid') {
    return { kind: 'invalid', issues: checked.issues }
  }

  return {
    kind: 'value',
    value: checked.value,
    ...(result.totals.modelName === undefined ? {} : { model: result.totals.modelName }),
  }
}

function repairMessage(message: string, issues: readonly string[]): string {
  return [
    message,
    '',
    'Your previous answer was rejected:',
    ...issues.slice(0, MAXIMUM_REPAIR_ISSUES).map((issue) => `- ${issue}`),
    'Answer again, correcting those points and changing nothing else.',
  ].join('\n')
}

/** Undefined when the first attempt stands. A budget halt is final: the budget is shared and spent. */
async function reattempt<T, R>(
  deps: AnalystDeps,
  call: AnalystCall<T, R>,
  first: Attempt<R>
): Promise<Attempt<R> | undefined> {
  if (first.kind === 'invalid') {
    deps.logger.warn('trading.theme_repaired', {
      subject: call.subject,
      issues: first.issues.slice(0, MAXIMUM_LOGGED_ISSUES),
    })

    return attempt(deps, { ...call, message: repairMessage(call.message, first.issues) }, false)
  }

  const retryable =
    first.kind === 'halted' &&
    first.result.reason !== 'budget' &&
    isRetryableHalt(first.result) &&
    !call.session.signal.aborted

  return retryable ? attempt(deps, call, call.research) : undefined
}

function toResult<T, R>(
  deps: AnalystDeps,
  call: AnalystCall<T, R>,
  last: Attempt<R>
): AnalystResult<R> {
  if (last.kind === 'value') {
    return last
  }

  if (last.kind === 'invalid') {
    deps.logger.warn('trading.theme_invalid', {
      subject: call.subject,
      issues: last.issues.slice(0, MAXIMUM_LOGGED_ISSUES),
    })

    return { kind: 'failed', failure: { cause: 'invalid' } }
  }

  deps.logger.warn('trading.theme_halted', {
    subject: call.subject,
    reason: last.result.reason,
    ...(last.result.errorMessage === undefined
      ? {}
      : {
          errorMessage: scrubCredentials(last.result.errorMessage).slice(
            0,
            MAXIMUM_LOGGED_ERROR_CHARS
          ),
        }),
  })

  return {
    kind: 'failed',
    failure: {
      cause: haltCauseOf(last.result),
      ...(last.result.missingEnv === undefined ? {} : { env: last.result.missingEnv }),
    },
  }
}

/** A failure worded for the operator is setup they must fix, such as an unset key. */
function haltCauseOf(result: RunResult): ThemeStepFailure {
  if (result.reason === 'budget') {
    return 'budget'
  }

  return result.operator === undefined ? 'halted' : 'setup'
}

/** At most two runs: one repair for an answer that failed its schema or checks, one retry for a
 *  provider the chain could not place. */
export async function askAnalyst<T, R>(
  deps: AnalystDeps,
  call: AnalystCall<T, R>
): Promise<AnalystResult<R>> {
  const first = await attempt(deps, call, call.research)
  const second = await reattempt(deps, call, first)

  return toResult(deps, call, second ?? first)
}
