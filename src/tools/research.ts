import { z } from 'zod'

import type { ResearchDepth } from '@/core/config/resolve'
import type { ToolInvocationContext, ToolResult } from '@/core/tool'
import type {
  ForegroundResearchInteraction,
  ResearchParent,
  ResearchPlanDecision,
  ResearchPlanLimitBase,
  ResearchPlanReview,
  ResearchProgress,
  ReviewResearchPlan,
} from '@/engine/api'
import { RESEARCH_DEPTHS, RESEARCH_PROFILE_DEPTHS } from '@/core/config/resolve'
import { ToolError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { createTool } from '@/core/tool'
import {
  RESEARCH_QUERY_MAX_CHARS,
  toAgentResearchResult,
  toResearchResultDisplay,
} from '@/engine/api'

const ResearchInputSchema = z.strictObject({
  query: z
    .string()
    .trim()
    .min(1)
    .max(RESEARCH_QUERY_MAX_CHARS)
    .describe(
      'The question to answer with sourced evidence, one sentence, naming the instrument or topic and the timeframe.'
    ),
  depth: z
    .enum(RESEARCH_DEPTHS)
    .optional()
    .describe(
      'light for a quick sourced check, medium for a few sources, deep for a full multi-source pass. Omit for medium.'
    ),
})

interface ReviewWiring {
  readonly reviewPlan: ReviewResearchPlan
  readonly planLimitBase: ResearchPlanLimitBase
}

export const researchTool = createTool({
  name: 'research',
  description:
    'Gather current, external, multi-source evidence at light, medium, or deep depth when material claims need sources. A claim marked forecast is an expectation, target, or guidance its source states: present it as that, never as an outcome. Code retains role roster, permissions, approval, quota, depth, and budget authority.',
  inputSchema: ResearchInputSchema,
  capability: 'delegate',
  eager: true,
  presentation: {
    label: 'Research',
    emoji: '🔎',
    detailKeys: ['query'],
    lifecycleOwner: 'progress',
  },
  async execute(args, ctx): Promise<ToolResult> {
    if (ctx.delegationQuota === undefined || ctx.addDelegatedUsage === undefined) {
      throw new ToolError('delegate_full', 'research run context is unavailable')
    }

    const depth = args.depth ?? RESEARCH_PROFILE_DEPTHS.standard
    const interaction = ctx.researchInteraction
    const review = resolveReviewWiring(ctx, depth)

    try {
      const result = await ctx.services.research.run(
        { query: args.query, depth },
        {
          locale: ctx.locale,
          userId: ctx.userId,
          channel: ctx.channel,
          signal: ctx.signal,
          budget: ctx.budget,
          delegationQuota: ctx.delegationQuota,
          parent: toResearchParent(ctx),
          addDelegatedUsage: ctx.addDelegatedUsage,
          addExternalCost: ctx.addExternalCost,
          ...(interaction === undefined
            ? {}
            : { reportProgress: (message) => reportSafely(ctx, interaction, message) }),
          ...(review === undefined ? {} : review),
        }
      )

      return {
        content: JSON.stringify(toAgentResearchResult(result)),
        isError: result.status === 'failed',
        display: toResearchResultDisplay(result),
      }
    } finally {
      finishInteraction(ctx, interaction)
    }
  },
})

// Interactive review is a top-level deep-research privilege: it pauses the run clock while the
// human decides, so a delegated child or a lighter depth never waits on a hidden prompt.
function resolveReviewWiring(
  ctx: ToolInvocationContext,
  depth: ResearchDepth
): ReviewWiring | undefined {
  const reviewPlan = ctx.researchInteraction?.reviewPlan

  if (depth !== 'deep' || ctx.callDepth !== 0 || reviewPlan === undefined) {
    return undefined
  }

  return {
    reviewPlan: (input) => reviewWithPausedDeadline(ctx, reviewPlan, input),
    planLimitBase: {
      maxDurationMs: ctx.maxDurationMs,
      remainingCostUsd: ctx.budget.remainingUsd(),
    },
  }
}

async function reviewWithPausedDeadline(
  ctx: ToolInvocationContext,
  reviewPlan: ReviewResearchPlan,
  input: ResearchPlanReview
): Promise<ResearchPlanDecision> {
  if (ctx.signal.aborted) {
    return { kind: 'cancel' }
  }

  ctx.deadline.pause()
  try {
    return await reviewPlan(input)
  } catch (err: unknown) {
    ctx.logger.warn('research.plan_review_failed', { err: formatErrForLog(err) })
    return { kind: 'cancel' }
  } finally {
    ctx.deadline.resume()
  }
}

// Surface callbacks are observational: a throwing renderer is logged, never propagated into research.
function reportSafely(
  ctx: ToolInvocationContext,
  interaction: ForegroundResearchInteraction,
  message: ResearchProgress
): void {
  try {
    interaction.reportProgress(message)
  } catch (err: unknown) {
    ctx.logger.warn('research.progress_report_failed', { err: formatErrForLog(err) })
  }
}

function finishInteraction(
  ctx: ToolInvocationContext,
  interaction: ForegroundResearchInteraction | undefined
): void {
  if (interaction === undefined) {
    return
  }

  try {
    interaction.finish()
  } catch (err: unknown) {
    ctx.logger.warn('research.interaction_finish_failed', { err: formatErrForLog(err) })
  }
}

function toResearchParent(ctx: ToolInvocationContext): ResearchParent {
  const parent = {
    runId: ctx.runId,
    billingSessionId: ctx.billingSessionId,
    billingAgentId: ctx.billingAgentId,
    agentId: ctx.agentId,
    callDepth: ctx.callDepth,
    delegationChain: [...ctx.delegationChain],
  }

  return ctx.chatId === undefined ? parent : { ...parent, chatId: ctx.chatId }
}
