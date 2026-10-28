import type { ToolDefinition } from '@/core/tool'
import type { Locale } from '@/core/types/locale'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type {
  LiveIndexReading,
  MarketBoard,
  MarketBreadth,
  MarketDataOverview,
  MarketDataOverviewRow,
  MarketLeader,
  MarketLeaders,
  MarketMover,
  MarketMovers,
  MarketRange,
} from '@/trading/kernel/market/market-overview'
import type { AgentWriter, PriceWriter } from '@/trading/kernel/surface/agent-json'
import { createTool } from '@/core/tool'
import { agentMacro } from '@/trading/features/market-data/tools/macro-risk'
import { fractionToPct, toAgentJson } from '@/trading/kernel/surface/agent-json'
import { noInput } from '@/trading/kernel/surface/surface'
import { formatFlow, formatSignedFlow } from '@/trading/render/format'
import { formatPrice, formatScaledPrice } from '@/trading/render/money'

export function createMarketOverviewTool(marketData: MarketDataService): ToolDefinition {
  return createTool({
    name: 'market_overview',
    description:
      'Every registered market\'s headline levels in one call - the first-party answer to "how is the market today", which must never come from the web. Each entry names its own market and carries that market\'s levels, plus the breadth, turnover, flow, sentiment and the session\'s biggest movers it publishes - this is where "which ticker rose or fell most today" is answered. Freshness is in the shape and you must carry it into your answer: everything under `settledSession` describes the completed session named by `settledSession.day` - never call any of it "today" or "this morning" unless that day is today - while a row\'s `live` block is the current price at its `observedTime`. Read that price against `live.session`, which carries the high, low and volume the intraday series has recorded since `session.fromTime` - a level alone does not say whether a market is being led or given back. Those are the series\' extremes from that time onward, not the session\'s: an opening auction before `fromTime` is not in them, so call them the high and low since `fromTime` and never "the day\'s high" or "the open". `sessionState` is the market\'s state as you read this, so an open market beside an earlier `settledSession.day` means today\'s session has not settled yet and only `live` describes it. State which session each number you quote came from, and never combine a live price with a settled breadth or flow figure in one claim about "today". Money amounts arrive already written for the operator\'s locale - quote them exactly as given and never rescale or re-derive one. Turnover is order-matched value only, excluding negotiated put-through blocks, so it reads below a press total that includes them - say which you quoted. `settledSession.universe` names the boards every total under it was measured over: quote that name, and never call those totals the whole market - a measured universe is never all of one. A market listing on more than one exchange also carries `boards`, the same session split per board: quote a board\'s own row when the operator names one, the totals otherwise, and say which you used - a blended count matches no exchange\'s published summary. A `market-data.board-flow-diverges` caveat means the boards ran opposite ways on foreign flow, so the market total is arithmetic no exchange published and the board rows are the answer. `breadth.measured` is the denominator its counts are out of, and `aboveMa50Ratio` is a share of `components.above50` plus `components.below50`: quote a breadth number with the base it came from. `turnoverRatio` reads only beside `turnoverReference`, which carries the sessions in its mean and the mean itself - quote both or neither, because every window yields a different multiple. Each entry in `leaders` carries the `changePct` that name settled at: use it, and never derive a percentage of your own from prices elsewhere in this payload. `leaders.mostTraded` ranks money and `movers.gainers` ranks price - a name in the first is not a gainer, and merging the two lists drops whatever actually rose most. Takes no arguments: the whole picture is the answer, and reporting only the part the operator asked about is your job, not this tool\'s. Use market_price for one named instrument instead.',
    inputSchema: noInput,
    capability: 'net',
    // Eager because the fallback is silent: a model that cannot see this asks the web "how is the
    // market" and gets plausible numbers for facts we hold. Screening has no such substitute, so it
    // is the one that can afford to be searched for.
    eager: true,
    presentation: { label: 'Market overview', emoji: '🗺️' },
    async execute(_args, ctx): Promise<string> {
      const overviews = await marketData.overview({ now: Date.now(), signal: ctx.signal })

      return toAgentJson(
        overviews.map((overview) =>
          toPayload(overview, {
            locale: ctx.locale,
            price: priceWriterOf(marketData, overview, ctx.locale),
          })
        )
      )
    },
  })
}

/** A market publishing index levels has no currency to name; one quoting money writes its prices as
 *  its own board shows them. */
function priceWriterOf(
  marketData: MarketDataService,
  overview: MarketDataOverview,
  locale: Locale
): PriceWriter {
  const { priceCurrency } = overview

  if (priceCurrency === undefined) {
    return (value) => formatPrice(locale, value)
  }

  const quoted = { ...marketData.quoteConvention(overview.market), currency: priceCurrency }

  return (value) => formatScaledPrice(locale, value, quoted)
}

/** Every amount and price leaves as the string a reader would see, because a model handed
 *  196500000000 has to divide by a billion to say it and one that misplaces the decimal reports a
 *  flow ten times the market's. Every `Pct` is percent points, and scores leave as bands. */
function toPayload(overview: MarketDataOverview, writer: AgentWriter): Record<string, unknown> {
  const { locale } = writer
  const { rows, marketCap, derivatives, etfFlows, range, macro, positioning } = overview
  const { narrowDeclineBelowPct } = overview
  // Named to be withheld: every field listed here re-enters under `settledSession`, and `notSettled`
  // is what is left — so a field added to the overview later stays top-level rather than being
  // silently dated to a session it may not describe.
  const {
    asOf,
    universe,
    breadth,
    turnover,
    turnoverRatio,
    turnoverReference,
    foreignNetValue,
    proprietaryNetValue,
    leaders,
    movers,
    boards,
    ...notSettled
  } = overview

  return {
    ...notSettled,
    rows: rows.map((row) => toRow(row, writer)),
    settledSession: toSettledSession(overview, locale),
    ...(range === undefined ? {} : { range: toRange(range, writer.price) }),
    ...(macro === undefined ? {} : { macro: agentMacro(macro, locale) }),
    ...(positioning?.yearPercentile === undefined
      ? {}
      : {
          positioning: {
            ...positioning,
            yearPercentile: fractionToPct(positioning.yearPercentile),
          },
        }),
    ...(narrowDeclineBelowPct === undefined
      ? {}
      : { narrowDeclineBelowPct: fractionToPct(narrowDeclineBelowPct) }),
    ...(marketCap === undefined ? {} : { marketCap: formatFlow(locale, marketCap) }),
    ...(derivatives?.openInterestUsd === undefined
      ? {}
      : {
          derivatives: {
            ...derivatives,
            openInterestUsd: formatFlow(locale, derivatives.openInterestUsd),
          },
        }),
    ...(etfFlows === undefined
      ? {}
      : {
          etfFlows: {
            ...etfFlows,
            netFlowUsd: formatSignedFlow(locale, etfFlows.netFlowUsd),
            windowNetFlowUsd: formatSignedFlow(locale, etfFlows.windowNetFlowUsd),
          },
        }),
  }
}

/** Every roll-up the market computed from its settled tape, under one key that names the session
 *  they belong to. Flat beside a live index reading they were read as "today", so the shape now
 *  carries the label the prose could only ask for. */
function toSettledSession(overview: MarketDataOverview, locale: Locale): Record<string, unknown> {
  const { asOf, universe, breadth, turnover, turnoverRatio, turnoverReference } = overview
  const { foreignNetValue, proprietaryNetValue, leaders, movers, boards } = overview

  return {
    day: asOf,
    ...(universe === undefined ? {} : { universe }),
    ...(breadth === undefined ? {} : { breadth: toBreadth(breadth) }),
    ...(turnover === undefined ? {} : { turnover: formatFlow(locale, turnover) }),
    ...(turnoverRatio === undefined ? {} : { turnoverRatio }),
    ...(turnoverReference === undefined
      ? {}
      : {
          turnoverReference: {
            sessions: turnoverReference.sessions,
            value: formatFlow(locale, turnoverReference.value),
          },
        }),
    ...(foreignNetValue === undefined
      ? {}
      : { foreignNetValue: formatSignedFlow(locale, foreignNetValue) }),
    ...(proprietaryNetValue === undefined
      ? {}
      : { proprietaryNetValue: formatSignedFlow(locale, proprietaryNetValue) }),
    ...(leaders === undefined ? {} : { leaders: toLeaders(leaders, locale) }),
    ...(movers === undefined ? {} : { movers: toMovers(movers, locale) }),
    ...(boards === undefined ? {} : { boards: boards.map((board) => toBoard(board, locale)) }),
  }
}

/** A row's own two readings never merge: `changePct` belongs to the settled close beside it, so it
 *  travels inside `settled` rather than next to a `live` block carrying a change of its own. */
function toRow(row: MarketDataOverviewRow, writer: AgentWriter): Record<string, unknown> {
  const { instrument, quote, changePct, turnover, live, ...board } = row

  return {
    instrument,
    settled: {
      ...board,
      ...(quote === undefined ? {} : { price: writer.price(quote.price) }),
      ...(changePct === undefined ? {} : { changePct }),
      ...(turnover === undefined ? {} : { turnover: formatFlow(writer.locale, turnover) }),
    },
    ...(live === undefined ? {} : { live: toLive(live, writer.price) }),
  }
}

function toLive(live: LiveIndexReading, price: PriceWriter): Record<string, unknown> {
  const { session } = live

  return {
    ...live,
    price: price(live.price),
    ...(session === undefined
      ? {}
      : { session: { ...session, high: price(session.high), low: price(session.low) } }),
  }
}

function toRange(range: MarketRange, price: PriceWriter): Record<string, unknown> {
  return {
    ...range,
    support: price(range.support),
    resistance: price(range.resistance),
    supportPct: fractionToPct(range.supportPct),
    resistancePct: fractionToPct(range.resistancePct),
  }
}

function toBreadth(breadth: MarketBreadth): MarketBreadth {
  const { indexToMa50Pct, ma50SlopePct } = breadth

  return {
    ...breadth,
    ...(indexToMa50Pct === undefined ? {} : { indexToMa50Pct: fractionToPct(indexToMa50Pct) }),
    ...(ma50SlopePct === undefined ? {} : { ma50SlopePct: fractionToPct(ma50SlopePct) }),
  }
}

/** Signed on every list, `mostTraded` included: the type keeps a sell as the outflow it was, and a
 *  magnitude that drops its sign in one list and not another reads as two different measurements. */
function toLeaders(leaders: MarketLeaders, locale: Locale): Record<string, unknown> {
  const toEntry = (leader: MarketLeader): Record<string, unknown> => ({
    ...leader,
    value: formatSignedFlow(locale, leader.value),
    ...(leader.sharePct === undefined ? {} : { sharePct: fractionToPct(leader.sharePct) }),
  })

  return {
    ...leaders,
    ...(leaders.foreignBuys === undefined ? {} : { foreignBuys: leaders.foreignBuys.map(toEntry) }),
    ...(leaders.foreignSells === undefined
      ? {}
      : { foreignSells: leaders.foreignSells.map(toEntry) }),
    ...(leaders.proprietaryBuys === undefined
      ? {}
      : { proprietaryBuys: leaders.proprietaryBuys.map(toEntry) }),
    ...(leaders.proprietarySells === undefined
      ? {}
      : { proprietarySells: leaders.proprietarySells.map(toEntry) }),
    ...(leaders.mostTraded === undefined ? {} : { mostTraded: leaders.mostTraded.map(toEntry) }),
  }
}

function toMovers(movers: MarketMovers, locale: Locale): Record<string, unknown> {
  const toEntry = (mover: MarketMover): Record<string, unknown> => ({
    ...mover,
    turnover: formatFlow(locale, mover.turnover),
  })

  return { gainers: movers.gainers.map(toEntry), losers: movers.losers.map(toEntry) }
}

function toBoard(board: MarketBoard, locale: Locale): Record<string, unknown> {
  return {
    ...board,
    ...(board.breadth === undefined ? {} : { breadth: toBreadth(board.breadth) }),
    ...(board.turnover === undefined ? {} : { turnover: formatFlow(locale, board.turnover) }),
    ...(board.foreignNetValue === undefined
      ? {}
      : { foreignNetValue: formatSignedFlow(locale, board.foreignNetValue) }),
  }
}
