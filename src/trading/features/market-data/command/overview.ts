import type { SlashCommand, SlashContext, SlashResult } from '@/core/types/command'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { MarketRef, Region } from '@/trading/kernel/instrument'
import { renderOverviewText } from '@/trading/features/market-data/render/overview'
import { usage } from '@/trading/kernel/surface/surface'
import { marketAffordances } from '@/trading/render/affordance'
import { resolveRenderContext } from '@/trading/render/format'

const USAGE: 'slash.tradingOverviewUsage' = 'slash.tradingOverviewUsage'

/** `/market` is not this command: it is the intraday report over the operator's own positions and
 *  watchlist, and it owns enable/disable for the scheduled fire, so it is a mutate. A read-only
 *  market picture must not inherit that gate. */
interface OverviewCommandDeps {
  /** The operator's own clock, so every rendered instant reads in one zone. */
  readonly timezone: string
  readonly marketData: Pick<MarketDataService, 'overview' | 'macroRisk'>
  /** Which region's macro read heads the message: its drivers price every market below it. */
  readonly defaultRegion: Region
  readonly heldMarkets: ReadonlySet<MarketRef>
}

export function createOverviewCommand(deps: OverviewCommandDeps): SlashCommand {
  return {
    name: 'overview',
    description: { kind: 'localized', key: 'slash.tradingOverviewHelp' },
    messageKeys: [USAGE],
    policy: {
      surfaces: ['channel', 'repl'],
      role: 'member',
      action: 'read',
      execution: { progressKey: 'slash.tradingOverviewProgress' },
      transcript: 'echo',
    },
    run: async (ctx): Promise<SlashResult> => run(deps, ctx),
  }
}

async function run(deps: OverviewCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  if (ctx.args.length > 0) {
    return usage(USAGE)
  }

  // One clock for the whole message, so the macro read and every market block are stamped with the
  // same instant rather than each with its own.
  const now = Date.now()
  const progress = ctx.progress === undefined ? {} : { progress: ctx.progress }
  // `overview()` returns an array rather than a `SourceResult`: a market whose read failed already
  // arrives as an unavailable section, so there is nothing to catch and no fallback to write.
  const [overviews, macro] = await Promise.all([
    deps.marketData.overview({ now, signal: ctx.signal, ...progress }),
    deps.marketData.macroRisk({ region: deps.defaultRegion, now, signal: ctx.signal, ...progress }),
  ])

  return {
    kind: 'text',
    affordances: marketAffordances(
      ctx.locale,
      overviews.map((overview) => overview.market)
    ),
    text: renderOverviewText(
      ctx.locale,
      { overviews, macro, heldMarkets: deps.heldMarkets, now },
      resolveRenderContext(deps.timezone, ctx.surface)
    ),
  }
}
