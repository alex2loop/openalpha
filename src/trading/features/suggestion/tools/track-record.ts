import { z } from 'zod'

import type { ToolDefinition } from '@/core/tool'
import type { SuggestionService } from '@/trading/features/suggestion/suggestion'
import { createTool } from '@/core/tool'
import { type AgentMarketData, toAgentTrackRecord } from '@/trading/features/suggestion/agent-view'
import { hasAgreementSample } from '@/trading/features/suggestion/track-record/agreement'
import { rootAgentFocus } from '@/trading/kernel/operator/focus'
import { toAgentJson } from '@/trading/kernel/surface/agent-json'
import { renderFocusLabel } from '@/trading/render/focus'
import { SURFACE_LIMITS } from '@/trading/surface-limits'

export function createSuggestionTrackRecordTool(
  suggestions: SuggestionService,
  marketData: AgentMarketData
): ToolDefinition {
  return createTool({
    name: 'suggestion_track_record',
    description:
      'Summarize past suggestion performance: win rate, mean and median return versus benchmark, and calibration by conviction band.' +
      ' Lead with how many suggestions have been made, how many have actually been scored and across how many names,' +
      ' then the rates - a rate quoted without its sample overstates what the record supports.',
    inputSchema: z.strictObject({
      limit: z
        .int()
        .positive()
        .max(SURFACE_LIMITS.maximumTrackRecordItems)
        .optional()
        .describe(
          `Resolved suggestions to return, newest first, up to ${SURFACE_LIMITS.maximumTrackRecordItems}.`
        ),
      strategyVersion: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Only suggestions scored under this strategy version, as printed in a suggestion footer. Omit for all.'
        ),
    }),
    capability: 'read',
    presentation: { label: 'Track record', emoji: '📈' },
    async execute(args, ctx): Promise<string> {
      // The record of the focus the asking agent works under: the operator's book unless it has its
      // own `[focus]`, whose calls are scored apart and are never the book's. The agreement is read
      // for that same focus, never for one the agent used before an edit.
      const { focus } = rootAgentFocus(ctx)
      const [report, focuses] = await Promise.all([
        suggestions.summarize({
          limit: args.limit ?? SURFACE_LIMITS.maximumTrackRecordItems,
          focusKey: focus.key,
          ...(args.strategyVersion === undefined ? {} : { strategyVersion: args.strategyVersion }),
          signal: ctx.signal,
        }),
        suggestions.focusRecords({ signal: ctx.signal }),
      ])
      const agreement = focuses.find((view) => view.focusKey === focus.key)?.agreement

      return toAgentJson({
        ...toAgentTrackRecord(report, { ...ctx, marketData }),
        focus: renderFocusLabel(ctx.locale, focus.focus),
        ...(agreement === undefined || !hasAgreementSample(agreement)
          ? {}
          : {
              agreement: {
                comparedCount: agreement.comparedCount,
                matchedCount: agreement.matchedCount,
              },
            }),
      })
    },
  })
}
