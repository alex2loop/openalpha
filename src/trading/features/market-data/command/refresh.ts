import type {
  CommandMessageValues,
  SlashCommand,
  SlashContext,
  SlashResult,
} from '@/core/types/command'
import type { MarketRef } from '@/trading/kernel/instrument'
import type {
  RefreshAllMarketDataOptions,
  RefreshMarketDataResult,
} from '@/trading/kernel/market/refresh'
import { renderRefreshText } from '@/trading/features/market-data/render/refresh'
import { parseRegisteredMarket, usage } from '@/trading/kernel/surface/surface'
import { resolveRenderContext } from '@/trading/render/format'

const USAGE: 'slash.tradingRefreshUsage' = 'slash.tradingRefreshUsage'
const LIVE_ONLY: 'slash.tradingRefreshLiveOnly' = 'slash.tradingRefreshLiveOnly'
const FORCE_ARG = 'force'

interface RefreshCommandDeps {
  /** The one function this command drives, declared where it is consumed: a feature may not reach
   *  the service aggregate, and this command needs none of the rest of it. */
  refreshMarketData(
    options: RefreshAllMarketDataOptions
  ): Promise<readonly RefreshMarketDataResult[]>
  /** The markets the registry can actually refresh, so the command never offers one that cannot. */
  readonly markets: readonly MarketRef[]
  /** Every registered market, so one that stores nothing is told why rather than handed the usage. */
  readonly registered: readonly MarketRef[]
  /** The operator's own clock, so every anchor reads in the one zone the message uses. */
  readonly timezone: string
}

interface RefreshArgs {
  readonly forced: boolean
  readonly market?: MarketRef
}

export function createRefreshCommand(deps: RefreshCommandDeps): SlashCommand {
  return {
    name: 'refresh',
    description: { kind: 'localized', key: 'slash.tradingRefreshHelp' },
    messageKeys: [USAGE, LIVE_ONLY],
    policy: {
      surfaces: ['channel', 'repl'],
      role: 'operator',
      action: 'mutate',
      execution: { progressKey: 'slash.tradingRefreshProgress' },
    },
    // Classified rather than positional, so both slots are offered at either position.
    completeFor: () => [...deps.markets, FORCE_ARG],
    usage: () => ({ key: USAGE, values: buildUsageValues(deps) }),
    run: async (ctx): Promise<SlashResult> => run(deps, ctx),
  }
}

async function run(deps: RefreshCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  const parsed = parseRefreshArgs(ctx.args, deps.markets)

  if (parsed === null) {
    return refusal(deps, ctx.args)
  }

  // Absent rather than `false`/`undefined`: absence is the one meaning of "everything", and
  // `exactOptionalPropertyTypes` rejects forwarding an optional field any other way.
  const results = await deps.refreshMarketData({
    ...(parsed.forced ? { forced: true } : {}),
    ...(parsed.market === undefined ? {} : { markets: [parsed.market] }),
    signal: ctx.signal,
    ...(ctx.progress === undefined ? {} : { progress: ctx.progress }),
  })

  // Only an unqualified sweep skips anything: a market named on the line is always refreshed.
  const skipped =
    parsed.market === undefined
      ? deps.markets.filter((market) => !results.some((result) => result.market === market))
      : []

  return {
    kind: 'text',
    text: renderRefreshText(
      ctx.locale,
      { results, skipped },
      resolveRenderContext(deps.timezone, ctx.surface)
    ),
  }
}

/** A market read live on every use has nothing stored to refresh, which is a different answer from a
 *  line the command cannot parse. */
function refusal(deps: RefreshCommandDeps, args: readonly string[]): SlashResult {
  const live = args
    .map((arg) => parseRegisteredMarket(arg, deps.registered))
    .find((market): market is MarketRef => market !== null && !deps.markets.includes(market))

  return live === undefined
    ? usage(USAGE, buildUsageValues(deps))
    : usage(LIVE_ONLY, { market: { key: `trading.market.${live}` } })
}

function buildUsageValues(deps: RefreshCommandDeps): CommandMessageValues {
  return { markets: deps.markets.join(', ') }
}

/** `null` for a token that names neither slot, or one that names a slot already filled — either is
 *  the usage line rather than a silent overwrite. */
function parseRefreshArgs(
  args: readonly string[],
  registered: readonly MarketRef[]
): RefreshArgs | null {
  let forced = false
  let market: MarketRef | undefined

  for (const arg of args) {
    const parsedMarket = parseRegisteredMarket(arg, registered)

    if (parsedMarket !== null && market === undefined) {
      market = parsedMarket
      continue
    }

    if (arg.toLowerCase() !== FORCE_ARG || forced) {
      return null
    }

    forced = true
  }

  return { forced, ...(market === undefined ? {} : { market }) }
}
