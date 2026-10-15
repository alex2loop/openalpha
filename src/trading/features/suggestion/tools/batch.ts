import { z } from 'zod'

import type { DisplayText } from '@/core/stream-events'
import type { ToolDefinition, ToolInvocationContext, ToolResult } from '@/core/tool'
import type { SuggestionBatchScope } from '@/trading/features/suggestion/batch-types'
import type { SuggestionService } from '@/trading/features/suggestion/suggestion'
import type { DebateMode } from '@/trading/kernel/config'
import { SOCIAL_CHANNEL } from '@/core/channels'
import { ToolError, ValidationError } from '@/core/errors'
import { createTool } from '@/core/tool'
import { type AgentMarketData, toAgentBatchResult } from '@/trading/features/suggestion/agent-view'
import {
  labelOutsideFocus,
  renderBatchVerdicts,
} from '@/trading/features/suggestion/render/verdict'
import { rootAgentFocus } from '@/trading/kernel/operator/focus'
import { toAgentJson } from '@/trading/kernel/surface/agent-json'
import { instrumentQueryInput, type MarketSchema } from '@/trading/kernel/surface/surface'
import { reporterOf } from '@/trading/kernel/surface/tool-progress'
import { toMarkdownText } from '@/trading/render/fold'
import { SURFACE_LIMITS } from '@/trading/surface-limits'

/** A fan-out pays one debate per name inside a single chat turn, so discovery runs the shallow
 *  mode; the full debate is what `suggestion_run` spends on a ticker the operator named. */
const DISCOVERY_DEBATE_MODE = 'lean' satisfies DebateMode

type BatchInput = z.infer<ReturnType<typeof batchInputOf>>

// A discriminated union renders as a root `oneOf` without `type`/`properties`, which strict
// OpenAI-compatible servers (LM Studio, llama.cpp, vLLM) reject for tool `parameters`. The two scopes
// are expressed as a single object schema instead: `items` is optional here and required only when
// `scope` resolves to `items`, which the refine enforces and `toBatchScope` already branches on.
function batchInputOf(markets: MarketSchema) {
  const item = z.strictObject(instrumentQueryInput(markets))

  return z
    .strictObject({
      scope: z
        .enum(['watchlist', 'items'])
        .describe('Whether the batch runs over the watchlist, or over the tickers named in items.'),
      items: z
        .array(item)
        .nonempty()
        .max(SURFACE_LIMITS.maximumDiscoveryBatchItems)
        .describe(
          `One to ${SURFACE_LIMITS.maximumDiscoveryBatchItems} instruments; name the market only when the ticker alone is ambiguous.`
        )
        .optional(),
    })
    .refine(
      (input) =>
        input.scope === 'watchlist' || (input.items !== undefined && input.items.length > 0),
      { message: 'items is required when scope is "items"' }
    )
}

export function createSuggestionBatchTool(
  suggestions: SuggestionService,
  markets: MarketSchema,
  context: { readonly marketData: AgentMarketData }
): ToolDefinition {
  const { marketData } = context

  return createTool({
    name: 'suggestion_batch',
    description:
      'Run the suggestion pipeline across the watchlist or up to three named tickers, concurrently, with a shallower debate than suggestion_run. Prefer this for breadth - a watchlist sweep or a first pass over several names - but never when the operator asks for deep or thorough analysis: that ask routes to suggestion_run per name even with several named, because a batch verdict stored today blocks the fuller debate behind the cooldown. Only for the watchlist or tickers the operator named or picked off a market_screen board - never as a self-directed follow-up to a screen, because open-ended discovery ends at that board. Its `report` is the verdict list, in markdown and in the language of the operator: show it exactly as returned, adding at most one short line only when the operator asked something it does not answer. Every detail it leaves out is in the fields beside it, for follow-ups. A result carrying `units` states the quantity to buy or sell: give that number beside the entry when it is there. A buy whose `debate.traderStance` is `wait` still stands: give its `traderConditions` as timing cautions, never as a hold.',
    // Eager with market_screen and suggestion_run: a model that cannot see this one deepens the
    // operator's picks by calling suggestion_run once per ticker, serially, at one LLM debate each.
    eager: true,
    inputSchema: batchInputOf(markets),
    capability: 'net',
    presentation: { label: 'Batch suggestions', emoji: '💡' },
    async execute(args, ctx): Promise<ToolResult> {
      const now = Date.now()
      const progress = reporterOf(ctx)
      const { owner, focus } = rootAgentFocus(ctx)
      const ran = await suggestions.runBatch({
        scope: toBatchScope(args, ctx),
        debateMode: DISCOVERY_DEBATE_MODE,
        channel: ctx.channel,
        billingSessionId: ctx.billingSessionId,
        focus,
        agentId: owner,
        billingAgentId: ctx.billingAgentId,
        parentRunId: ctx.runId,
        budget: ctx.budget,
        ...(progress === undefined ? {} : { progress }),
        now,
        signal: ctx.signal,
      })

      const batch = {
        ...ran,
        results: ran.results.map((result) => labelOutsideFocus(ctx.locale, focus, result)),
      }

      // A model sees the projection, never the stored rows; the operator also sees order quantity.
      const projected = toAgentBatchResult(batch, { ...ctx, marketData })
      const verdicts = renderBatchVerdicts(ctx.locale, batch)

      return {
        content: toAgentJson({
          ...(verdicts === undefined ? {} : { report: toMarkdownText(verdicts) }),
          ...projected,
        }),
        isError: false,
        display: batchDisplay(verdicts),
      }
    },
  })
}

function batchDisplay(verdicts: string | undefined): DisplayText {
  return verdicts === undefined
    ? { key: 'toolSummaries.suggestionUnsupported' }
    : { key: 'toolSummaries.suggestionBatch', params: { verdicts } }
}

/** Only the service can expand a watchlist — a tool holds no profile store — so the scope names
 *  the intent and the service resolves it. */
function toBatchScope(args: BatchInput, ctx: ToolInvocationContext): SuggestionBatchScope {
  const { locale } = ctx

  if (args.scope === 'watchlist') {
    // The watchlist is the operator's own list: a visit to a public network names its tickers.
    if (ctx.channel === SOCIAL_CHANNEL) {
      throw new ToolError('unauthorized', 'the watchlist is private here; name tickers in items')
    }

    return { kind: 'watchlist', locale }
  }

  // The refine on the schema guarantees items here; this is the TS narrowing for it.
  if (args.items === undefined) {
    throw new ValidationError('items is required when scope is "items"')
  }

  return {
    kind: 'items',
    items: args.items.map((item) => ({
      locale,
      ticker: item.ticker,
      ...(item.market === undefined ? {} : { market: item.market }),
    })),
  }
}
