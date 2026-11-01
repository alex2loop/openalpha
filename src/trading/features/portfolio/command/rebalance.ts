import type {
  CommandMessageValues,
  SlashCommand,
  SlashContext,
  SlashResult,
} from '@/core/types/command'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { PortfolioService } from '@/trading/features/portfolio/types'
import type { ProfileService } from '@/trading/features/profile/types'
import type { MarketRef } from '@/trading/kernel/instrument'
import { quoteConventionsFor } from '@/trading/features/market-data/command/quote-conventions'
import { renderRebalanceText } from '@/trading/features/portfolio/render/rebalance'
import { parseTickers, usage } from '@/trading/kernel/surface/surface'
import { planAffordances } from '@/trading/render/affordance'
import { answerSurfaceOf, resolveRenderContext } from '@/trading/render/format'

const USAGE: 'slash.tradingRebalanceUsage' = 'slash.tradingRebalanceUsage'

/** `role: 'operator'` for the same reason as `/portfolio`: advice is derived from the operator's
 *  own book. */
interface AdviceCommandDeps {
  readonly portfolio: Pick<PortfolioService, 'rebalanceAbsolute'>
  readonly profiles: Pick<ProfileService, 'get'>
  readonly marketData: Pick<MarketDataService, 'markets' | 'quoteConvention'>
  /** A market no venue holds has no segment to rebalance, so a ticker in it is not accepted. */
  readonly heldMarkets: ReadonlySet<MarketRef>
  /** The operator's own clock, so every rendered instant reads in one zone. */
  readonly timezone: string
}

export function createRebalanceCommand(deps: AdviceCommandDeps): SlashCommand {
  return {
    name: 'rebalance',
    description: { kind: 'localized', key: 'slash.tradingRebalanceHelp' },
    messageKeys: [USAGE],
    policy: {
      surfaces: ['channel', 'repl'],
      role: 'operator',
      action: 'read',
      execution: { progressKey: 'slash.tradingRebalanceProgress' },
      selfContained: true,
    },
    usage: () => ({ key: USAGE, values: buildUsageValues(heldMarketsOf(deps)) }),
    run: async (ctx): Promise<SlashResult> => run(deps, ctx),
  }
}

async function run(deps: AdviceCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  const markets = heldMarketsOf(deps)
  const listedOnly = ctx.args.length > 0
  const tickers = listedOnly ? parseTickers(ctx.args, markets) : null

  if (listedOnly && tickers === null) {
    return usage(USAGE, buildUsageValues(markets))
  }

  const { advice, sizing, freshness, book } = await deps.portfolio.rebalanceAbsolute({
    now: Date.now(),
    signal: ctx.signal,
    ...(tickers === null ? {} : { tickers }),
  })
  const profile = await deps.profiles.get({ signal: ctx.signal })

  return {
    kind: 'text',
    affordances: planAffordances(ctx.locale),
    text: renderRebalanceText(ctx.locale, advice, {
      context: resolveRenderContext(deps.timezone, answerSurfaceOf(ctx)),
      listedOnly,
      sizing,
      ...(freshness === undefined ? {} : { freshness }),
      entryTranchePct: profile.entryTranchePct,
      maximumSectorPctNav: profile.maximumSectorPctNav,
      ...(book === undefined
        ? {}
        : {
            book,
            quoteConventions: quoteConventionsFor(
              deps.marketData,
              advice.kind === 'ready' ? advice.rebalance.map((row) => row.instrument) : []
            ),
          }),
    }),
  }
}

function heldMarketsOf(deps: AdviceCommandDeps): readonly MarketRef[] {
  return deps.marketData.markets().filter((market) => deps.heldMarkets.has(market))
}

function buildUsageValues(markets: readonly MarketRef[]): CommandMessageValues {
  return { markets: markets.join(', ') }
}
