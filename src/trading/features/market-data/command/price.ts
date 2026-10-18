import type {
  CommandMessageValues,
  SlashCommand,
  SlashContext,
  SlashResult,
} from '@/core/types/command'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { MarketEvent } from '@/trading/kernel/market/market-data'
import { renderQuoteText } from '@/trading/features/market-data/render/quote'
import { parseTickerRequest, usage } from '@/trading/kernel/surface/surface'
import { shiftCalendarDay } from '@/trading/markets/calendar'
import { resolveRenderContext } from '@/trading/render/format'

const USAGE: 'slash.tradingPriceUsage' = 'slash.tradingPriceUsage'
/** How far ahead a quote names what is coming. Calendar days rather than sessions: the command has
 *  no calendar, and a dated corporate event is published against the calendar anyway. */
const UPCOMING_HORIZON_DAYS = 14

/** Market-agnostic by construction: the command takes a ticker and detection routes it to whichever
 *  market claims it, so a market's own vocabulary never has to be restated here. */
interface PriceCommandDeps {
  readonly marketData: Pick<MarketDataService, 'quote' | 'markets' | 'events'>
  /** The operator's own clock, so every rendered instant reads in one zone. */
  readonly timezone: string
}

export function createPriceCommand(deps: PriceCommandDeps): SlashCommand {
  return {
    name: 'price',
    description: { kind: 'localized', key: 'slash.tradingPriceHelp' },
    messageKeys: [USAGE],
    policy: {
      surfaces: ['channel', 'repl'],
      role: 'member',
      action: 'read',
      execution: { progressKey: 'slash.tradingPriceProgress' },
      transcript: 'echo',
    },
    usage: () => ({ key: USAGE, values: buildUsageValues(deps) }),
    run: async (ctx): Promise<SlashResult> => run(deps, ctx),
  }
}

async function run(deps: PriceCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  const [raw, ...rest] = ctx.args
  const request = parseTickerRequest(raw, deps.marketData.markets())

  if (rest.length > 0 || request === null) {
    return usage(USAGE, buildUsageValues(deps))
  }

  const now = Date.now()
  const result = await deps.marketData.quote({
    ...request,
    withPreviousClose: true,
    now,
    signal: ctx.signal,
  })

  if (result.kind === 'unavailable') {
    return {
      kind: 'text',
      text: renderQuoteText(ctx.locale, result, {
        context: resolveRenderContext(deps.timezone, ctx.surface),
      }),
    }
  }

  return {
    kind: 'text',
    text: renderQuoteText(ctx.locale, result, {
      context: resolveRenderContext(deps.timezone, ctx.surface),
      events: await upcoming(deps, {
        instrument: result.value.quote.instrument,
        fromDay: result.value.observed.day,
        now,
        ctx,
      }),
    }),
  }
}

function buildUsageValues(deps: PriceCommandDeps): CommandMessageValues {
  return { markets: deps.marketData.markets().join(', ') }
}

/** An enrichment, never the answer: a calendar that could not be read costs the quote a line, not
 *  its caveats. */
async function upcoming(
  deps: PriceCommandDeps,
  request: {
    readonly instrument: InstrumentRef
    readonly fromDay: TradingDay
    readonly now: number
    readonly ctx: SlashContext
  }
): Promise<readonly MarketEvent[]> {
  const result = await deps.marketData.events({
    market: request.instrument.market,
    ticker: request.instrument.ticker,
    fromDay: request.fromDay,
    toDay: shiftCalendarDay(request.fromDay, UPCOMING_HORIZON_DAYS),
    now: request.now,
    signal: request.ctx.signal,
  })

  return result.kind === 'unavailable' ? [] : result.value
}
