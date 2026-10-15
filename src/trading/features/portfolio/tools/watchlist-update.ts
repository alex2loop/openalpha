import { z } from 'zod'

import type { ToolDefinition } from '@/core/tool'
import type { AgentProfile } from '@/trading/features/profile/types'
import { createTool } from '@/core/tool'
import { renderWatchlistText } from '@/trading/features/portfolio/render/watchlist'
import { WATCHLIST_MAXIMUM_ENTRIES } from '@/trading/features/profile/policy'
import { tickerInput } from '@/trading/kernel/surface/surface'
import { joinToolDetail, renderToolAction } from '@/trading/render/tool-detail'

/** The one path that edits the watchlist by name. `profile_update` replaces whole records, so
 *  adding a single name through it drops every other one — silently, and only the operator can
 *  tell. Add and remove are the operations an agent actually needs, so they are what it gets. */
export function createWatchlistUpdateTool(profiles: AgentProfile): ToolDefinition {
  return createTool({
    name: 'watchlist_update',
    description:
      'Add names to, or remove names from, the operator watchlist. Appends and removes by ticker — the names not mentioned are left alone. Use this whenever the operator wants to start or stop following a name; never rewrite the watchlist through profile_update.',
    inputSchema: z.strictObject({
      action: z
        .enum(['add', 'remove'])
        .describe('add puts the tickers on the watchlist, remove takes them off.'),
      tickers: z
        .array(tickerInput)
        .min(1)
        .max(WATCHLIST_MAXIMUM_ENTRIES)
        .describe(`One to ${WATCHLIST_MAXIMUM_ENTRIES} tickers.`),
    }),
    capability: 'write',
    presentation: {
      label: 'Update watchlist',
      emoji: '👀',
      detail: (input, locale) =>
        joinToolDetail([renderToolAction(locale, input.action), input.tickers.join(' ')]),
    },
    async execute(args, ctx): Promise<string> {
      const result = await profiles.updateWatchlist({
        kind: args.action,
        tickers: args.tickers.map((symbol) => ({ ticker: symbol })),
        defaultLocale: ctx.locale,
        signal: ctx.signal,
      })

      return renderWatchlistText(ctx.locale, result)
    },
  })
}
