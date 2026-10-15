import { randomUUID } from 'node:crypto'

import type { z } from 'zod'

import type { JsonOutputContract, ProviderModelId } from '@/core/llm'
import type { Logger } from '@/core/logging/logger'
import type { StreamEvent } from '@/core/stream-events'
import type { Budget } from '@/core/types/budget'
import type {
  ResearchChildResult,
  ResearchInvocation,
  ResearchRole,
} from '@/engine/research/contracts'
import type { RunInput, Runner, RunOptions, RunResult } from '@/engine/types/run'
import { agentId, sessionId } from '@/core/ids'
import { formatErrForLog, scrubCredentials } from '@/core/security/credentials'
import { createDelegatedApproval } from '@/engine/hooks/approval'
import { MAX_RESEARCH_ERROR_CHARS } from '@/engine/research/contracts'

import { CONTRACT_REPAIR_TOOLS, parseResearchJson } from '../evidence/parse'

export const MAX_LOGGED_ISSUE_PATHS = 8
// Invalid output is model prose: warn stays metadata-only; the scrubbed preview lives at debug.
const MAX_LOGGED_OUTPUT_PREVIEW_CHARS = 300
const OUTPUT_ISSUE_PATH = 'output'
const INVALID_RESEARCH_CHILD_MESSAGE = 'research child returned invalid structured output'

// A salvage hook recovers a usable value from output the full schema rejected; `dropped` counts
// the pruned items. Returning undefined keeps the invalid-output path.
export type ChildSalvage<T> = (
  raw: string
) => { readonly value: T; readonly dropped: number } | undefined

interface ResearchChildInput<T> {
  readonly role: ResearchRole
  readonly prompt: string
  readonly schema: z.ZodType<T>
  readonly outputContract: JsonOutputContract
  readonly budget: Budget
  readonly invocation: ResearchInvocation
  readonly logger: Logger
  readonly questionId?: string
  readonly salvage?: ChildSalvage<T>
}

interface ChildObservation {
  providerModel?: ProviderModelId
}

export async function runResearchChild<T>(
  runner: Runner,
  input: ResearchChildInput<T>
): Promise<ResearchChildResult<T>> {
  if (input.invocation.signal.aborted) {
    return Promise.resolve({
      kind: 'halted',
      reason: 'aborted',
      message: 'research child aborted before start',
    })
  }

  const observation: ChildObservation = {}
  const result = await attemptChild({ runner, input, observation })

  if (result.reason !== 'completed') {
    return {
      kind: 'halted',
      reason: result.reason,
      message: childResultMessage(result),
      ...providerModelField(observation),
      ...(result.haltCode === undefined ? {} : { haltCode: result.haltCode }),
    }
  }

  const parsed = parseChildOutput(input, result.text)

  if (parsed.kind !== 'invalid') {
    return settleChildResult(input, parsed, observation)
  }

  // The contract was never enforced on a request carrying tools, so the answer was only asked for
  // JSON in prose. The repair withholds them; a run that halts there keeps the first diagnosis.
  const repair = await attemptChild({
    runner,
    input,
    observation,
    allowedTools: CONTRACT_REPAIR_TOOLS,
  })
  const repaired =
    repair.reason === 'completed' ? parseChildOutput(input, repair.text) : { ...parsed }

  return settleChildResult(input, repaired, observation)
}

interface ChildAttempt<T> {
  readonly runner: Runner
  readonly input: ResearchChildInput<T>
  readonly observation: ChildObservation
  readonly allowedTools?: readonly string[]
}

/** A private session per attempt, so a repair never resumes the transcript it replaces. */
async function attemptChild<T>(attempt: ChildAttempt<T>): Promise<RunResult> {
  const { input, observation, allowedTools } = attempt
  const runInput: RunInput = {
    agentId: agentId(input.role),
    sessionId: sessionId(randomUUID()),
    userId: input.invocation.userId,
    channel: input.invocation.channel,
    userMessage: input.prompt,
    onChunk: (event) => observeChildEvent(input.invocation, observation, event),
  }
  const options = researchRunOptions(input)
  const result = await attempt.runner.run(
    runInput,
    allowedTools === undefined ? options : { ...options, allowedTools }
  )

  input.invocation.addDelegatedUsage(result.totals)

  return result
}

/** Pure: what the answer yielded, before an attempt is spent deciding whether it is the last. */
type ChildOutput<T> =
  | { readonly kind: 'value'; readonly value: T }
  | {
      readonly kind: 'salvaged'
      readonly value: T
      readonly dropped: number
      readonly issues: readonly string[]
    }
  | { readonly kind: 'invalid'; readonly text: string; readonly issues: readonly string[] }

function parseChildOutput<T>(input: ResearchChildInput<T>, text: string): ChildOutput<T> {
  const parsed = parseResearchJson(input.schema, text)

  if (parsed.kind === 'value') {
    return { kind: 'value', value: parsed.value }
  }

  const salvaged = input.salvage?.(text)

  return salvaged === undefined
    ? { kind: 'invalid', text, issues: parsed.issues }
    : { kind: 'salvaged', value: salvaged.value, dropped: salvaged.dropped, issues: parsed.issues }
}

/** Logged where the outcome is final, so a repaired answer never reports the attempt it replaced. */
function settleChildResult<T>(
  input: ResearchChildInput<T>,
  output: ChildOutput<T>,
  observation: ChildObservation
): ResearchChildResult<T> {
  if (output.kind === 'salvaged') {
    logSalvagedChildOutput(input, { issues: output.issues, dropped: output.dropped, observation })

    return { kind: 'value', value: output.value, ...providerModelField(observation) }
  }

  if (output.kind === 'invalid') {
    logInvalidChildOutput(input, { text: output.text, issues: output.issues, observation })

    return { kind: 'invalid', issues: output.issues, ...providerModelField(observation) }
  }

  return { kind: 'value', value: output.value, ...providerModelField(observation) }
}

function logSalvagedChildOutput<T>(
  input: ResearchChildInput<T>,
  detail: {
    readonly issues: readonly string[]
    readonly dropped: number
    readonly observation: ChildObservation
  }
): void {
  input.logger.warn('research.child_output_salvaged', {
    dropped: detail.dropped,
    issuePaths: toSanitizedIssuePaths(detail.issues),
    outcome: 'salvaged',
    ...(input.questionId === undefined ? {} : { questionId: input.questionId }),
    ...providerLogFields(detail.observation),
  })
}

function logInvalidChildOutput<T>(
  input: ResearchChildInput<T>,
  detail: {
    readonly text: string
    readonly issues: readonly string[]
    readonly observation: ChildObservation
  }
): void {
  input.logger.warn('research.child_invalid_output', {
    issueCount: detail.issues.length,
    issuePaths: toSanitizedIssuePaths(detail.issues),
    textBytes: new TextEncoder().encode(detail.text).byteLength,
    outcome: 'invalid',
    ...(input.questionId === undefined ? {} : { questionId: input.questionId }),
    ...providerLogFields(detail.observation),
  })
  input.logger.debug('research.child_invalid_output_preview', {
    preview: scrubCredentials(detail.text.slice(0, MAX_LOGGED_OUTPUT_PREVIEW_CHARS)),
    ...(input.questionId === undefined ? {} : { questionId: input.questionId }),
    ...providerLogFields(detail.observation),
  })
}

/** Reduces parser issues to their code-owned schema paths, safe for logs and failure messages. */
export function toSanitizedIssuePaths(issues: readonly string[]): readonly string[] {
  const paths = new Set<string>()

  for (const issue of issues) {
    const separatorIndex = issue.indexOf(':')
    // Parser issues are "schema.path: message"; retain only the code-owned path prefix.
    const path = separatorIndex > 0 ? issue.slice(0, separatorIndex) : OUTPUT_ISSUE_PATH

    paths.add(path)
    if (paths.size === MAX_LOGGED_ISSUE_PATHS) {
      break
    }
  }
  return [...paths]
}

// The one invalid-output message: code-owned schema paths only. The raw issues ride
// correctionIssues, which only the retry's correction block reads.
export function invalidResearchChildMessage(issues: readonly string[]): string {
  const paths = toSanitizedIssuePaths(issues)
  return paths.length === 0
    ? INVALID_RESEARCH_CHILD_MESSAGE
    : `${INVALID_RESEARCH_CHILD_MESSAGE}: ${paths.join('; ')}`
}

function providerLogFields(observation: ChildObservation): {
  readonly provider?: string
  readonly model?: string
} {
  return observation.providerModel === undefined ? {} : observation.providerModel
}

function providerModelField(observation: ChildObservation): {
  readonly providerModel?: ProviderModelId
} {
  return observation.providerModel === undefined ? {} : { providerModel: observation.providerModel }
}

function researchRunOptions<T>(input: ResearchChildInput<T>): RunOptions {
  const common: RunOptions = {
    persistence: 'ephemeral',
    parentSignal: input.invocation.signal,
    budgetSlice: input.budget,
    outputContract: input.outputContract,
    answerVisibility: 'hidden',
    reasoningVisibility: 'hidden',
  }

  return childRunOptions(common, input.invocation, input.budget)
}

function observeChildEvent(
  invocation: ResearchInvocation,
  observation: ChildObservation,
  event: StreamEvent
): void {
  if (event.type === 'turn_metric') {
    observation.providerModel = { provider: event.provider, model: event.model }
    return
  }

  if (event.type === 'provider_fallback') {
    invocation.reportProgress?.({
      key: 'progress.researchWarning',
      params: {
        code: 'fallback_started',
        values: { from: event.from, to: event.to, reason: event.reason },
      },
    })
  }
}

function boundedMessage(value: unknown): string {
  return formatErrForLog(value).message.slice(0, MAX_RESEARCH_ERROR_CHARS)
}

function childResultMessage(result: RunResult): string {
  if (result.errorMessage !== undefined) {
    return boundedMessage(result.errorMessage)
  }

  switch (result.reason) {
    case 'completed':
      return 'research child completed without a valid result'
    case 'aborted':
      return 'research child aborted'
    case 'budget':
      return 'research child budget exhausted'
    case 'timeout':
      return 'research child timed out'
    case 'turn_limit':
      return 'research child reached its turn limit'
    case 'loop':
      return 'research child stopped by the loop detector'
    case 'error':
      return 'research child failed at the model boundary'
  }
}

function childRunOptions(
  common: RunOptions,
  invocation: ResearchInvocation,
  budget: Budget
): RunOptions {
  const parent = invocation.parent

  if (parent === undefined) {
    return { ...common, billingSessionId: null, approvalMode: 'unavailable' }
  }

  const linked: RunOptions = {
    ...common,
    billingSessionId: parent.billingSessionId,
    billingAgentId: parent.billingAgentId,
    parentRunId: parent.runId,
    parent: {
      callDepth: parent.callDepth,
      delegationChain: [...parent.delegationChain, parent.agentId],
      sharedBudget: budget,
      delegationQuota: invocation.delegationQuota,
    },
  }

  if (parent.chatId === undefined) {
    return { ...linked, approvalMode: 'unavailable' }
  }

  return {
    ...linked,
    approvalMode: 'manual',
    approval: createDelegatedApproval(parent.runId),
    chatId: parent.chatId,
  }
}
