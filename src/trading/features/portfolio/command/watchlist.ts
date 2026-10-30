import type {
  CommandMessageValues,
  SlashCommand,
  SlashContext,
  SlashResult,
} from '@/core/types/command'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { ProfileService } from '@/trading/features/profile/types'
import type { MarketRef } from '@/trading/kernel/instrument'
import { quoteConventionsFor } from '@/trading/features/market-data/command/quote-conventions'
import { resolveMarketIcons } from '@/trading/features/market-data/reads/describe'
import { renderQuotesText } from '@/trading/features/market-data/render/quotes'
import { renderWatchlistText } from '@/trading/features/portfolio/render/watchlist'
import { parseMember, parseTickers, usage } from '@/trading/kernel/surface/surface'
import { answerSurfaceOf, resolveRenderContext } from '@/trading/render/format'

const USAGE: 'slash.tradingWatchlistUsage' = 'slash.tradingWatchlistUsage'
const ACTIONS = Object.freeze(['add', 'remove'] as const)

/** The one slash path that writes the watchlist. `profile_update` replaces the whole array, which
 *  is why asking an agent to add a name can drop the rest; this appends and removes. */
interface WatchlistCommandDeps {
  readonly profiles: Pick<ProfileService, 'get' | 'updateWatchlist'>
  /** Read here so `show` can price the list it owns without re-implementing the quoteBoard path. */
  readonly marketData: Pick<
    MarketDataService,
    'describeMarkets' | 'markets' | 'quoteBoard' | 'quoteConvention'
  >
  /** The operator's own clock, so every rendered instant reads in one zone. */
  readonly timezone: string
}

export function createWatchlistCommand(deps: WatchlistCommandDeps): SlashCommand {
  return {
    name: 'watchlist',
    description: { kind: 'localized', key: 'slash.tradingWatchlistHelp' },
    messageKeys: [USAGE],
    policy: {
      surfaces: ['channel', 'repl'],
      role: 'operator',
      action: 'mutate',
      execution: { progressKey: 'slash.tradingWatchlistProgress' },
    },
    completeFor: (args) => (args.length === 1 ? ACTIONS : []),
    usage: () => ({ key: USAGE, values: buildUsageValues(deps.marketData.markets()) }),
    run: async (ctx): Promise<SlashResult> => run(deps, ctx),
  }
}

async function run(deps: WatchlistCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  const [action, ...rest] = ctx.args

  if (action === undefined) {
    return runShow(deps, ctx)
  }

  const markets = deps.marketData.markets()
  const kind = parseMember(action, ACTIONS)
  const tickers = parseTickers(rest, markets)

  if (kind === null || tickers === null) {
    return usage(USAGE, buildUsageValues(markets))
  }

  const result = await deps.profiles.updateWatchlist({
    kind,
    tickers,
    signal: ctx.signal,
  })

  return { kind: 'text', text: renderWatchlistText(ctx.locale, result) }
}

function buildUsageValues(markets: readonly MarketRef[]): CommandMessageValues {
  return { markets: markets.join(', ') }
}

async function runShow(deps: WatchlistCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  const profile = await deps.profiles.get({
    signal: ctx.signal,
  })

  if (profile.watchlist.length === 0) {
    return {
      kind: 'text',
      text: renderWatchlistText(ctx.locale, {
        kind: 'watchlist',
        instruments: [],
        instrumentKinds: new Map(),
      }),
    }
  }

  const quoteBoard = await deps.marketData.quoteBoard({
    instruments: profile.watchlist,
    signal: ctx.signal,
  })

  return {
    kind: 'text',
    text: renderQuotesText(ctx.locale, quoteBoard, {
      context: resolveRenderContext(deps.timezone, answerSurfaceOf(ctx)),
      quoteConventions: quoteConventionsFor(deps.marketData, quoteBoard.items),
      marketIcons: resolveMarketIcons(deps.marketData),
    }),
  }
}
