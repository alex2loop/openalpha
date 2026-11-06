import type { Logger } from '@/core/logging/logger'
import type {
  CommandMessageValues,
  SlashCommand,
  SlashContext,
  SlashResult,
} from '@/core/types/command'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { MarketRef, Region } from '@/trading/kernel/instrument'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { renderOverviewText } from '@/trading/features/market-data/render/overview'
import { unsupportedCapability } from '@/trading/features/market-data/resolve'
import { parseMember, usage } from '@/trading/kernel/surface/surface'
import { marketAffordances } from '@/trading/render/affordance'
import { answerSurfaceOf, resolveRenderContext } from '@/trading/render/format'

const USAGE: 'slash.tradingOverviewUsage' = 'slash.tradingOverviewUsage'

/** `/market` is not this command: it is the intraday report over the operator's own positions and
 *  watchlist, and it owns enable/disable for the scheduled fire, so it is a mutate. A read-only
 *  market picture must not inherit that gate. */
interface OverviewCommandDeps {
  /** The operator's own clock, so every rendered instant reads in one zone. */
  readonly timezone: string
  readonly marketData: Pick<
    MarketDataService,
    'overview' | 'macroRisk' | 'markets' | 'describeMarkets'
  >
  /** Which region's macro read heads the message: its drivers price every market below it, so a
   *  page narrowed to markets outside that region carries none. */
  readonly defaultRegion: Region
  readonly heldMarkets: ReadonlySet<MarketRef>
  /** `false` where the edition makes no call on the market, so the macro states readings only;
   *  absent states the composite. */
  readonly statesComposite?: false
  /** What a bare `/overview` covers: the markets a segment, holding or watched name keeps in use. */
  readonly marketsInUse: (signal: AbortSignal) => Promise<ReadonlySet<MarketRef>>
  readonly logger: Logger
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
      selfContained: true,
      transcript: 'echo',
    },
    usage: () => ({ key: USAGE, values: buildUsageValues(deps) }),
    run: async (ctx): Promise<SlashResult> => run(deps, ctx),
  }
}

/** The markets in use by default, as the brief reads them; named markets narrow the page to them,
 *  which is what each market's button under the full page opens. */
async function run(deps: OverviewCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  const known = deps.marketData.markets()
  const named = ctx.args.map((arg) => parseMember(arg, known))

  if (named.some((market) => market === null)) {
    return usage(USAGE, buildUsageValues(deps))
  }

  const markets = named.filter((market): market is MarketRef => market !== null)
  const covered = markets.length === 0 ? await defaultMarkets(deps, ctx.signal) : markets

  // One clock for the whole message, so the macro read and every market block are stamped with the
  // same instant rather than each with its own.
  const now = Date.now()
  const progress = ctx.progress === undefined ? {} : { progress: ctx.progress }
  // `overview()` returns an array rather than a `SourceResult`: a market whose read failed already
  // arrives as an unavailable section, so there is nothing to catch and no fallback to write.
  const [overviews, macro] = await Promise.all([
    deps.marketData.overview({
      now,
      signal: ctx.signal,
      ...progress,
      markets: covered,
    }),
    readsRegion(deps, markets)
      ? deps.marketData.macroRisk({
          region: deps.defaultRegion,
          now,
          signal: ctx.signal,
          ...progress,
        })
      : unsupportedCapability(),
  ])

  return {
    kind: 'text',
    affordances:
      markets.length === 0
        ? marketAffordances(
            ctx.locale,
            overviews.map((overview) => overview.market)
          )
        : [],
    text: renderPage(deps, ctx, { overviews, macro, now }),
  }
}

type PageRead = Omit<Parameters<typeof renderOverviewText>[1], 'heldMarkets' | 'statesComposite'>

function renderPage(deps: OverviewCommandDeps, ctx: SlashContext, read: PageRead): string {
  return renderOverviewText(
    ctx.locale,
    {
      ...read,
      heldMarkets: deps.heldMarkets,
      statesComposite: deps.statesComposite !== false,
    },
    resolveRenderContext(deps.timezone, answerSurfaceOf(ctx))
  )
}

/** A page with nothing to show is worse than a wide one, so a failed or empty read of what is in use
 *  covers every market. */
async function defaultMarkets(
  deps: OverviewCommandDeps,
  signal: AbortSignal
): Promise<readonly MarketRef[]> {
  try {
    const inUse = await deps.marketsInUse(signal)

    if (inUse.size > 0) {
      return [...inUse]
    }
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    deps.logger.warn('trading.overview_markets_in_use_failed', { err: formatErrForLog(err) })
  }

  return deps.marketData.markets()
}

function buildUsageValues(deps: OverviewCommandDeps): CommandMessageValues {
  return { markets: deps.marketData.markets().join(', ') }
}

function readsRegion(deps: OverviewCommandDeps, markets: readonly MarketRef[]): boolean {
  if (markets.length === 0) {
    return true
  }

  return deps.marketData
    .describeMarkets()
    .some((entry) => markets.includes(entry.market) && entry.region === deps.defaultRegion)
}
