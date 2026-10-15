import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import type { OnStreamEvent } from '@/core/stream-events'
import type { ToolInvocationContext, ToolResult } from '@/core/tool'
import type { LLMUsageTotals } from '@/core/types/usage'
import type { AgentProfile, Budget, BudgetSlice, RunOnceOptions, RunResult } from '@/engine/api'
import { RunHalted, ToolError } from '@/core/errors'
import { sessionId } from '@/core/ids'
import { formatErrForLog, scrubCredentials } from '@/core/security/credentials'
import {
  AGENT_BUDGET_FRACTION,
  createBudgetSlicesWithin,
  createDelegatedApproval,
  HALT_CODE_TO_REASON,
} from '@/engine/api'

const MAX_PROMPT_CHARS = 20_000

export const delegationInput = z.object({
  agent_id: z
    .string()
    .trim()
    .min(1)
    .describe('One id from the <delegates> block, exactly as listed.'),
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(MAX_PROMPT_CHARS)
    .describe(
      'The child starts fresh and sees only this text: state one objective, the exact output format, the background it needs, and the scope bounds.'
    ),
})

export const delegateParallelInput = z.object({
  items: z
    .array(delegationInput)
    .min(2)
    .describe('Two or more independent specialist briefs that can run concurrently.'),
})

export type DelegationInput = z.infer<typeof delegationInput>

interface ResolvedDelegation {
  readonly agent: AgentProfile
  readonly input: DelegationInput
}

interface ChildResultSummary {
  readonly agent_id: string
  readonly reason: RunResult['reason']
  readonly text: string
}

type ChildRunSettlement =
  | { readonly kind: 'completed'; readonly result: RunResult }
  | { readonly kind: 'budget_exhausted'; readonly result: RunResult; readonly message: string }
  | { readonly kind: 'approval_timeout'; readonly result: RunResult; readonly message: string }

export function resolveDelegation(
  input: DelegationInput,
  ctx: ToolInvocationContext
): ResolvedDelegation {
  const agent = ctx.services.agents.get(input.agent_id)

  if (agent === null) {
    throw new ToolError('invalid_input', `unknown agent: ${input.agent_id}`)
  }

  const parent = ctx.services.agents.get(ctx.agentId)

  if (parent === null || !parent.delegates.includes(agent.id)) {
    throw new ToolError('unauthorized', `agent ${ctx.agentId} cannot delegate to ${agent.id}`)
  }

  if (
    ctx.callDepth >= ctx.config.loop.delegationDepth ||
    agent.id === ctx.agentId ||
    ctx.delegationChain.includes(agent.id)
  ) {
    throw new ToolError('depth_limit', 'delegation limit reached')
  }

  return { agent, input }
}

// Called after the budget slices exist, so a budget refusal never consumes quota.
function reserveDelegationQuota(ctx: ToolInvocationContext, count: number): void {
  if (ctx.delegationQuota === undefined) {
    throw new ToolError('delegate_full', 'delegation quota unavailable')
  }

  ctx.delegationQuota.reserve(count)
}

export async function runSingleChild(
  delegation: ResolvedDelegation,
  ctx: ToolInvocationContext
): Promise<ToolResult> {
  const [slice] = allocateChildBudgets(ctx, 1)

  if (slice === undefined) {
    return budgetRefusal()
  }

  try {
    reserveDelegationQuota(ctx, 1)

    const settlement = await runChild(delegation, ctx, slice)

    addDelegatedUsage(ctx, settlement.result.totals)

    return {
      content: childResultToString(delegation.agent.id, settlement),
      isError: settlement.kind !== 'completed',
    }
  } finally {
    slice.settle()
  }
}

export async function runParallelChildren(
  delegations: readonly ResolvedDelegation[],
  ctx: ToolInvocationContext
): Promise<ToolResult> {
  const slices = allocateChildBudgets(ctx, delegations.length)

  if (slices.length === 0) {
    return budgetRefusal()
  }

  try {
    reserveDelegationQuota(ctx, delegations.length)

    const runs: Array<Promise<ChildRunSettlement>> = []

    for (const [index, delegation] of delegations.entries()) {
      const slice = slices[index]

      if (slice === undefined) {
        return { content: 'budget slice unavailable', isError: true, errorCode: 'unexpected' }
      }

      runs.push(runChild(delegation, ctx, slice))
    }

    const results = await Promise.allSettled(runs)

    for (const result of results) {
      if (result.status === 'fulfilled') {
        addDelegatedUsage(ctx, result.value.result.totals)
      }
    }

    return summarizeParallelResults(ctx, delegations, results)
  } finally {
    for (const slice of slices) {
      slice.settle()
    }
  }
}

// Children share a hard-capped cut of the parent's remainder; the rest is what the parent spends
// reading their results and answering. The caller settles every slice it is handed.
function allocateChildBudgets(ctx: ToolInvocationContext, count: number): readonly BudgetSlice[] {
  const allocationUsd = ctx.budget.remainingUsd() * AGENT_BUDGET_FRACTION

  return createBudgetSlicesWithin(ctx.budget, allocationUsd, count)
}

function budgetRefusal(): ToolResult {
  return {
    content: 'insufficient budget to start delegated work',
    isError: true,
    errorCode: 'budget_exhausted',
  }
}

function addDelegatedUsage(ctx: ToolInvocationContext, childTotals: LLMUsageTotals): void {
  if (ctx.addDelegatedUsage === undefined) {
    throw new ToolError('unexpected', 'delegated usage rollup unavailable')
  }

  ctx.addDelegatedUsage(childTotals)
}

async function runChild(
  delegation: ResolvedDelegation,
  ctx: ToolInvocationContext,
  budget: Budget
): Promise<ChildRunSettlement> {
  ctx.reportProgress?.({
    key: 'progress.agentStarted',
    params: { agent: delegation.agent.id },
    mode: 'transient',
  })

  const onChunk = childOnChunk(ctx)
  const result = await ctx.services.runner.run(
    {
      agentId: delegation.agent.id,
      // A private session keeps the child's transcript out of the parent's trail; persistence is
      // ephemeral so nothing is written to the durable record.
      sessionId: sessionId(randomUUID()),
      userId: ctx.userId,
      channel: ctx.channel,
      userMessage: delegation.input.prompt,
      ...(onChunk === undefined ? {} : { onChunk }),
    },
    childRunOptions(ctx, budget)
  )

  ctx.reportProgress?.({
    key: 'progress.agentFinished',
    params: { agent: delegation.agent.id, reason: result.reason },
    mode: 'transient',
  })

  return toChildRunSettlement(result)
}

function childOnChunk(ctx: ToolInvocationContext): OnStreamEvent | undefined {
  if (ctx.callDepth !== 0 || ctx.reportProgress === undefined) {
    return undefined
  }

  const reportProgress = ctx.reportProgress
  let modelReported = false

  return (event) => {
    switch (event.type) {
      case 'tool_execution_start':
        reportProgress({
          key: 'progress.childToolStarted',
          params: { label: event.label },
          mode: 'transient',
        })
        return
      case 'turn_metric':
        if (!modelReported) {
          reportProgress({
            key: 'progress.childModel',
            params: { model: event.model },
            mode: 'transient',
          })
          modelReported = true
        }
        return
      default:
        return
    }
  }
}

// The parent invocation's chatId is the one route predicate: a routed child gets a one-time
// delegated scope and the same chat target so the parent surface's operator can answer; a headless
// child gets unavailable approval and its dangerous calls block before any prompt is emitted.
function childRunOptions(ctx: ToolInvocationContext, budget: Budget): RunOnceOptions {
  const common: RunOnceOptions = {
    budgetSlice: budget,
    parentSignal: ctx.signal,
    parent: {
      callDepth: ctx.callDepth,
      delegationChain: [...ctx.delegationChain, ctx.agentId],
      sharedBudget: budget,
      delegationQuota: ctx.delegationQuota,
    },
    persistence: 'ephemeral',
    billingSessionId: ctx.billingSessionId,
    billingAgentId: ctx.billingAgentId,
    parentRunId: ctx.runId,
  }

  if (ctx.chatId === undefined) {
    return { ...common, approvalMode: 'unavailable' }
  }

  return {
    ...common,
    approvalMode: 'manual',
    approval: createDelegatedApproval(ctx.runId),
    chatId: ctx.chatId,
  }
}

function childResultToString(agentId: string, settlement: ChildRunSettlement): string {
  const base = {
    agent_id: agentId,
    reason: settlement.result.reason,
    text: settlement.result.text,
  }

  if (settlement.kind === 'completed') {
    return JSON.stringify(base)
  }

  return JSON.stringify({
    ...base,
    budget_exhausted: settlement.kind === 'budget_exhausted',
    approval_timeout: settlement.kind === 'approval_timeout',
    message: settlement.message,
  })
}

function childSettlementNotice(settlement: ChildRunSettlement): string {
  if (settlement.kind === 'completed') {
    return ''
  }

  const label = settlement.kind === 'budget_exhausted' ? 'budget exhausted' : 'approval timeout'

  return `\n\n[${label}: ${settlement.message}]`
}

function toChildRunSettlement(result: RunResult): ChildRunSettlement {
  if (result.reason === 'budget') {
    return {
      kind: 'budget_exhausted',
      result,
      message: result.errorMessage ?? 'child budget exhausted',
    }
  }

  if (result.completionCode !== undefined) {
    return {
      kind: 'approval_timeout',
      result,
      message: `child ended without action: ${result.completionCode}`,
    }
  }

  return { kind: 'completed', result }
}

function summarizeParallelResults(
  ctx: ToolInvocationContext,
  delegations: readonly ResolvedDelegation[],
  results: readonly PromiseSettledResult<ChildRunSettlement>[]
): ToolResult {
  const children = delegations.map((delegation, index) =>
    summarizeChildResult(ctx, delegation, results[index])
  )

  const isError = results.some(
    (result) =>
      result.status === 'rejected' ||
      (result.status === 'fulfilled' && result.value.kind !== 'completed')
  )

  return {
    content: JSON.stringify({ children }),
    isError,
  }
}

function summarizeChildResult(
  ctx: ToolInvocationContext,
  delegation: ResolvedDelegation,
  result: PromiseSettledResult<ChildRunSettlement> | undefined
): ChildResultSummary {
  if (result?.status === 'fulfilled') {
    const settlement = result.value
    const notice = childSettlementNotice(settlement)

    return {
      agent_id: delegation.agent.id,
      reason: settlement.result.reason,
      text: `${settlement.result.text}${notice}`,
    }
  }

  if (result?.status === 'rejected') {
    const error = result.reason instanceof Error ? result.reason : new Error(String(result.reason))
    ctx.logger.error('delegate_parallel.child_failed', {
      agent: delegation.agent.id,
      err: formatErrForLog(error),
    })

    return {
      agent_id: delegation.agent.id,
      // A halted child keeps its halt reason: the parent must be able to tell "hit its budget cap"
      // (retrying burns more cap) from "crashed" (retryable).
      reason: error instanceof RunHalted ? HALT_CODE_TO_REASON[error.code] : 'error',
      text: scrubCredentials(error.message),
    }
  }

  return {
    agent_id: delegation.agent.id,
    reason: 'error',
    text: 'child runner failed before producing a result',
  }
}
