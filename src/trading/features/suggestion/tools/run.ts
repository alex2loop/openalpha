import { z } from 'zod'

import type { ToolDefinition, ToolInvocationContext, ToolResult } from '@/core/tool'
import type { SuggestionReportDeps } from '@/trading/features/suggestion/report'
import type { SuggestionService } from '@/trading/features/suggestion/suggestion'
import type { SuggestionRunResult } from '@/trading/features/suggestion/types'
import { SOCIAL_CHANNEL } from '@/core/channels'
import { createTool } from '@/core/tool'
import { toAgentRunResult } from '@/trading/features/suggestion/agent-view'
import { labelOutsideFocus, renderVerdict } from '@/trading/features/suggestion/render/verdict'
import { renderAgentReport } from '@/trading/features/suggestion/report'
import { DEBATE_MODES } from '@/trading/kernel/config'
import { isBookFocus, rootAgentFocus } from '@/trading/kernel/operator/focus'
import { toAgentJson } from '@/trading/kernel/surface/agent-json'
import { instrumentQueryInput, type MarketSchema } from '@/trading/kernel/surface/surface'
import { reporterOf } from '@/trading/kernel/surface/tool-progress'
import { renderFocusLabel } from '@/trading/render/focus'

interface SuggestionRunToolDeps extends SuggestionReportDeps {
  readonly suggestions: SuggestionService
}

export function createSuggestionRunTool(
  deps: SuggestionRunToolDeps,
  markets: MarketSchema
): ToolDefinition {
  return createTool({
    name: 'suggestion_run',
    description:
      'Run the staged suggestion pipeline for one instrument and return a buy or reduce trade idea with entry, stop, target, sizing, and conviction, or a hold whose `holdReasons` say why. The deep path: the full debate unless `mode` asks for lean, one name per call - when the operator asks for deep analysis of several named tickers, call this once per name instead of suggestion_batch, whose shallow verdict would block this fuller one behind the cooldown. Only for an instrument the operator named or picked - an open-ended ask is answered by the market_screen board alone, and deepening waits for the operator to choose. Its levels are built from the quote and the factor evidence the run priced against, both named in the result: report the verdict against that basis, and never restate it beside a live price as though the idea had been formed at that price. Its `report` is the analyst note on the call, in markdown and in the language of the operator: show it exactly as returned, adding at most one short line only when the operator asked something it does not answer. Every detail it leaves out is in the fields beside it, for follow-ups. A result carrying `units` states the quantity to buy or sell: give that number beside the entry when it is there. A buy whose `debate.traderStance` is `wait` still stands: give its `traderConditions` as timing cautions, never as a hold.',
    // Eager with market_screen: the funnel must be visible without tool_search.
    eager: true,
    inputSchema: z.strictObject({
      ...instrumentQueryInput(markets),
      force: z
        .literal(true)
        .optional()
        .describe(
          "Only when the operator asks, in any language, for a fresh run or a deep, thorough or detailed analysis: replaces today's stored suggestion."
        ),
      mode: z
        .enum(DEBATE_MODES)
        .optional()
        .describe(
          'Omit for the full debate. "lean" only when the operator asks, in any language, for a quick or short analysis: one analyst and a claim check. "full" only when the operator names it.'
        ),
    }),
    capability: 'net',
    // No detailKeys: every progress line and the verdict itself lead with the ticker, so a detail
    // here would print it twice on the completed line.
    presentation: { label: 'Suggestion', emoji: '💡' },
    async execute(args, ctx): Promise<ToolResult> {
      const now = Date.now()
      const progress = reporterOf(ctx)
      const { owner, focus } = rootAgentFocus(ctx)
      const ran = await deps.suggestions.run({
        locale: ctx.locale,
        channel: ctx.channel,
        billingSessionId: ctx.billingSessionId,
        focus: focus,
        agentId: owner,
        billingAgentId: ctx.billingAgentId,
        parentRunId: ctx.runId,
        ticker: args.ticker,
        ...(args.market === undefined ? {} : { market: args.market }),
        // A visit to a social network must not supersede the day's stored call: strangers' posts
        // are what it read before calling.
        ...(args.force === undefined || ctx.channel === SOCIAL_CHANNEL
          ? {}
          : { force: args.force }),
        ...(args.mode === undefined ? {} : { debateMode: args.mode }),
        ...(progress === undefined ? {} : { progress }),
        now,
        signal: ctx.signal,
      })
      const result = labelOutsideFocus(ctx.locale, focus, ran)

      return await toRunReply(deps, result, ctx)
    },
  })
}

/** A model sees the projection and the report, never the stored row; the operator's own client also
 *  sees the order quantity. */
async function toRunReply(
  deps: SuggestionRunToolDeps,
  result: SuggestionRunResult,
  ctx: ToolInvocationContext
): Promise<ToolResult> {
  const projected = toAgentRunResult(result, { ...ctx, marketData: deps.marketData })
  const { focus } = rootAgentFocus(ctx)
  const report = await renderAgentReport(deps, {
    result,
    locale: ctx.locale,
    ...(isBookFocus(focus) ? {} : { focusLabel: renderFocusLabel(ctx.locale, focus.focus) }),
    audience: ctx.audience,
    signal: ctx.signal,
  })

  return {
    content: toAgentJson({ report, ...projected }),
    isError: false,
    display: renderVerdict(ctx.locale, result),
  }
}
