import type { TradingDay } from '@/trading/kernel/instrument'
import type { DealerBoard } from '@/trading/kernel/market/market-data'
import type {
  MarketDataOverview,
  MarketDataOverviewRow,
} from '@/trading/kernel/market/market-overview'
import type {
  BriefReading,
  BriefSectionResult,
  BriefSectionRow,
} from '@/trading/kernel/operator/brief-section'
import { LEADER_KIND, MOVER_KIND } from '@/trading/kernel/market/market-overview'
import { BRIEF_SECTION_ORDER } from '@/trading/kernel/operator/brief-section'
import { priceSection, readySection, unavailableSection } from '@/trading/markets/brief-section'
import { MAXIMUM_NAMES_PER_LIST, rollupSections } from '@/trading/markets/overview-rollups'
import { changeAgainstClose } from '@/trading/sources/rows/normalization'

const PERCENT_PER_UNIT = 100

/** At or above this multiple of its own average, a session's turnover confirms the move it carried.
 *  A ratio against the market's own reference, so no market calibrates it separately. */
export const CONFIRMING_TURNOVER_RATIO = 1

/** The groups the brief also renders per market. The overview's caveats and provenance ride the
 *  first section, because they describe the whole read rather than any one group of it. */
export function overviewSections(overview: MarketDataOverview): readonly BriefSectionResult[] {
  const [first, ...rest] = publishedSections(overview)

  if (first === undefined) {
    return [unavailableSection(overview)]
  }

  return [withReadStamps(first, overview), ...rest]
}

/** Everything one market published, in the brief's section order. `/overview` reads it: that surface
 *  states provenance per block and caveats once per message, so nothing is stamped here. */
export function wholeMarketSections(overview: MarketDataOverview): readonly BriefSectionResult[] {
  const sections = [...publishedSections(overview), ...rollupSections(overview)]

  if (sections.length === 0) {
    // Caveats stripped: that surface states every read's caveats once, below the last block.
    return [{ ...unavailableSection(overview), caveats: [] }]
  }

  return [...sections].sort(
    (left, right) =>
      BRIEF_SECTION_ORDER.indexOf(left.kind) - BRIEF_SECTION_ORDER.indexOf(right.kind)
  )
}

/** One converter for every market: which sections exist is decided by which optional groups the
 *  overview carries, so a market grows a section by publishing a field, not by editing this file. */
function publishedSections(overview: MarketDataOverview): readonly BriefSectionResult[] {
  return [
    pricesSection(overview),
    quotesSection(overview),
    boardSection(overview),
    marketCapSection(overview),
    derivativesSection(overview),
    takerFlowSection(overview),
    etfFlowsSection(overview),
    positioningSection(overview),
    premiumSection(overview),
    rangeSection(overview),
    readingSection(overview),
    leadersSection(overview),
    moversSection(overview),
    sentimentSection(overview),
  ].filter((section) => section !== undefined)
}

function withReadStamps(
  section: BriefSectionResult,
  overview: MarketDataOverview
): BriefSectionResult {
  if (section.status !== 'ready') {
    return section
  }

  return { ...section, provenance: overview.provenance, caveats: overview.caveats }
}

/** Two sections, because one market's "quotes" are two different things: a name that publishes a
 *  settled close and a live reading is a price pair, while a dealer board publishes a bid and an ask
 *  that no pair describes. Splitting them lets each render as what it is. */
function pricesSection(overview: MarketDataOverview): BriefSectionResult | undefined {
  const rows = overview.rows.filter(isPricePair).map(toPriceRow)

  return rows.length === 0 ? undefined : priceSection(overview, rows)
}

function quotesSection(overview: MarketDataOverview): BriefSectionResult | undefined {
  const rows = overview.rows.filter((row) => !(isPricePair(row) || isBoard(row))).map(toQuoteRow)

  return rows.length === 0 ? undefined : readySection(overview, { kind: 'market-quotes', rows })
}

/** A dealer board's vendors are merged to one publish stamp, so the stamp belongs to the section and
 *  not to any row — repeating it per row would claim each vendor priced at the same moment. */
function boardSection(overview: MarketDataOverview): BriefSectionResult | undefined {
  const board = overview.rows.filter(isBoard)
  const [first] = board

  if (first === undefined) {
    return undefined
  }

  return readySection(overview, {
    kind: 'market-board',
    rows: board.map(toQuoteRow),
    ...(first.quote === undefined ? {} : { titleParams: { observedAt: first.quote.observedAt } }),
  })
}

/** Two sides rather than a last trade: what a shop pays and what it charges, which no pair or single
 *  quote describes. */
function isBoard(row: MarketDataOverviewRow): boolean {
  return row.quote?.board !== undefined
}

/** Anything the pair can date, whichever readings the row carries: one instrument reads the same on
 *  every surface, so a market states its close, its live price, or both under one block rather than
 *  as a bare number. A dealer board is the one shape a pair cannot hold. */
function isPricePair(row: MarketDataOverviewRow): boolean {
  return (row.quote !== undefined || row.live !== undefined) && !isBoard(row)
}

/** The pair's own fields, listed rather than spread: a field added to the overview row must be given
 *  a home here deliberately instead of vanishing into a block that cannot render it. Turnover is
 *  left out because the leaders section already ranks the same names by it. A close with no session
 *  of its own is dropped rather than borrowed from the block, which would date one session's level
 *  with another's day. */
function toPriceRow(row: MarketDataOverviewRow): BriefSectionRow {
  const changePct = moveOf(row)

  return {
    ticker: row.instrument.ticker,
    ...(row.live === undefined
      ? {}
      : { last: row.live.price, observedAt: row.live.observedAt, observedOn: row.live.observedOn }),
    ...(changePct === undefined ? {} : { changePct }),
    ...(row.quote === undefined || row.closedOn === undefined
      ? {}
      : { previousClose: row.quote.price, closedOn: row.closedOn }),
  }
}

/** The move a row reports, measured against the close it prints beside. A provider's own figure is
 *  a rolling window on a continuous market, so the same line would mean one session on a board and
 *  twenty-four hours on a coin. */
function moveOf(row: MarketDataOverviewRow): number | undefined {
  return row.live === undefined
    ? row.changePct
    : changeAgainstClose(row.live.price, row.quote?.price, row.live.changePct)
}

/** A dealer board states no last trade: its `last` is the same number as its ask, and printing both
 *  puts one price on the row twice. */
function toQuoteRow(row: MarketDataOverviewRow): BriefSectionRow {
  const settled = row.quote?.price
  const last = isBoard(row) ? undefined : (row.live?.price ?? settled)
  const changePct = moveOf(row)

  return {
    ticker: row.instrument.ticker,
    ...(last === undefined ? {} : { last }),
    ...(changePct === undefined ? {} : { changePct }),
    ...(row.live === undefined || settled === undefined ? {} : { previousClose: settled }),
    ...boardFields(row.quote?.board),
    ...(row.turnover === undefined ? {} : { turnover: row.turnover }),
  }
}

/** A board's own cells, or none at all: a market with a last trade has no bid to print beside it. */
function boardFields(board: DealerBoard | undefined): BriefSectionRow {
  if (board === undefined) {
    return {}
  }

  return {
    buyPrice: board.buyPrice,
    sellPrice: board.sellPrice,
    ...(board.spreadPct === undefined ? {} : { spreadPct: board.spreadPct }),
  }
}

function marketCapSection(overview: MarketDataOverview): BriefSectionResult | undefined {
  if (overview.marketCap === undefined) {
    return undefined
  }

  return readySection(overview, {
    kind: 'market-cap',
    rows: [
      {
        marketCap: overview.marketCap,
        ...(overview.turnover === undefined ? {} : { turnover: overview.turnover }),
        ...(overview.largestSharePct === undefined
          ? {}
          : { largestSharePct: overview.largestSharePct }),
        ...(overview.breadth === undefined
          ? {}
          : {
              advancers: overview.breadth.advancers,
              decliners: overview.breadth.decliners,
              measured: overview.breadth.measured,
            }),
      },
    ],
  })
}

function derivativesSection(overview: MarketDataOverview): BriefSectionResult | undefined {
  const derivatives = overview.derivatives

  if (derivatives === undefined) {
    return undefined
  }

  return readySection(overview, {
    kind: 'derivatives',
    titleParams: { observedAt: derivatives.observedAt },
    rows: [
      {
        funding: derivatives.fundingDailyPct / PERCENT_PER_UNIT,
        ...(derivatives.openInterestUsd === undefined
          ? {}
          : { openInterest: derivatives.openInterestUsd }),
        ...(derivatives.openInterestRatio === undefined
          ? {}
          : {
              oiRatio: derivatives.openInterestRatio.value,
              sessions: derivatives.openInterestRatio.sessions,
            }),
        ...(derivatives.longShortRatio === undefined
          ? {}
          : { longShortRatio: derivatives.longShortRatio }),
      },
    ],
  })
}

function etfFlowsSection(overview: MarketDataOverview): BriefSectionResult | undefined {
  const flows = overview.etfFlows

  if (flows === undefined) {
    return undefined
  }

  return readySection(overview, {
    kind: 'etf-flows',
    rows: [{ netFlowUsd: flows.netFlowUsd, flowWindowUsd: flows.windowNetFlowUsd }],
    titleParams: { sessions: flows.windowSessions },
  })
}

function positioningSection(overview: MarketDataOverview): BriefSectionResult | undefined {
  const positioning = overview.positioning

  if (positioning === undefined) {
    return undefined
  }

  return readySection(overview, {
    kind: 'positioning',
    rows: [
      {
        netLong: positioning.netLongContracts,
        ...(positioning.weekChangeContracts === undefined
          ? {}
          : { weekChange: positioning.weekChangeContracts }),
        ...(positioning.yearPercentile === undefined
          ? {}
          : { yearPercentile: positioning.yearPercentile }),
      },
    ],
    titleParams: { week: positioning.week },
  })
}

function premiumSection(overview: MarketDataOverview): BriefSectionResult | undefined {
  if (overview.premium === undefined) {
    return undefined
  }

  return readySection(overview, {
    kind: 'premium',
    rows: [
      {
        premium: overview.premium,
        ...(overview.premiumRank === undefined
          ? {}
          : {
              premiumPercentile: overview.premiumRank.percentile,
              sessions: overview.premiumRank.sessions,
            }),
      },
    ],
  })
}

/** Reported, never scored: it says who was crossing the spread and leaves the reading to the
 *  operator. Titled by its own session, which is the settled one behind whatever dates the block. */
function takerFlowSection(overview: MarketDataOverview): BriefSectionResult | undefined {
  const takerFlow = overview.takerFlow

  if (takerFlow === undefined) {
    return undefined
  }

  return readySection(overview, {
    kind: 'taker-flow',
    titleParams: { day: takerFlow.at },
    rows: [{ takerBuyPct: takerFlow.buyPct }],
  })
}

/** The session in one sentence, for a market that has calibrated what a narrow decline means. The
 *  three inputs are the ones the blocks below already print, so the sentence can only ever say what
 *  those rows say. Absent whenever an arm's own input is missing: a hedged sentence reads as a
 *  judgement while saying nothing. */
function readingSection(overview: MarketDataOverview): BriefSectionResult | undefined {
  const narrowBelow = overview.narrowDeclineBelowPct
  const changePct = sessionMoveOf(overview.rows, overview.asOf)

  if (narrowBelow === undefined || changePct === undefined) {
    return undefined
  }

  const reading =
    changePct < 0
      ? declineReading(overview.breadth?.aboveMa50Ratio, narrowBelow)
      : riseReading(overview.turnoverRatio)

  return reading === undefined
    ? undefined
    : readySection(overview, { kind: 'reading', rows: [{ reading }] })
}

function declineReading(
  aboveMa50Ratio: number | undefined,
  narrowBelow: number
): BriefReading | undefined {
  if (aboveMa50Ratio === undefined) {
    return undefined
  }

  return aboveMa50Ratio >= narrowBelow ? 'narrow-decline' : 'broad-decline'
}

/** What the indexes moved in `session` — the one the turnover and breadth in this sentence were
 *  measured in. Absent when they disagree in sign: which one speaks for the session is not a
 *  question row order may answer.
 *
 *  Scoped to the session rather than taken from `changePct`, because a provider settles its index
 *  series one name at a time: with VN100's own bar published and VNINDEX's still forming, the raw
 *  field compares today's move against yesterday's and disagrees on half of all sessions, which
 *  dropped this sentence from the brief every time the two days ran opposite ways. */
function sessionMoveOf(
  rows: readonly MarketDataOverviewRow[],
  session: TradingDay
): number | undefined {
  const moves = rows.flatMap((row) => {
    const move = rowMoveIn(row, session)

    return move === undefined ? [] : [move]
  })
  const [first] = moves

  if (first === undefined || first === 0) {
    return undefined
  }

  return moves.every((move) => Math.sign(move) === Math.sign(first)) ? first : undefined
}

/** This row's move in `session`, from whichever of its two readings belongs to it: the live one
 *  where the provider has not published the session's own bar yet — once the board has shut that
 *  reading is the close — and the settled close where it has. A row carrying neither reports
 *  nothing rather than lending the session before it. */
function rowMoveIn(row: MarketDataOverviewRow, session: TradingDay): number | undefined {
  if (row.live?.observedOn === session) {
    return moveOf(row)
  }

  return row.closedOn === session ? row.changePct : undefined
}

function riseReading(turnoverRatio: number | undefined): BriefReading | undefined {
  if (turnoverRatio === undefined) {
    return undefined
  }

  return turnoverRatio >= CONFIRMING_TURNOVER_RATIO ? 'rise-confirmed' : 'rise-unconfirmed'
}

function rangeSection(overview: MarketDataOverview): BriefSectionResult | undefined {
  const range = overview.range

  if (range === undefined) {
    return undefined
  }

  return readySection(overview, {
    kind: 'range',
    rows: [
      { support: range.support, supportPct: range.supportPct },
      { resistance: range.resistance, resistancePct: range.resistancePct },
    ],
    titleParams: { sessions: range.sessions },
  })
}

function leadersSection(overview: MarketDataOverview): BriefSectionResult | undefined {
  const leaders = overview.leaders
  const mostTraded = leaders?.mostTraded

  if (leaders === undefined || mostTraded === undefined || mostTraded.length === 0) {
    return undefined
  }

  return readySection(overview, {
    kind: LEADER_KIND[leaders.window],
    rows: mostTraded.slice(0, MAXIMUM_NAMES_PER_LIST).map((leader) => ({
      ticker: leader.instrument.ticker,
      turnover: leader.value,
      ...(leader.sharePct === undefined ? {} : { sharePct: leader.sharePct }),
    })),
    ...(leaders.sessions === undefined ? {} : { titleParams: { sessions: leaders.sessions } }),
  })
}

/** Gainers then losers in one section: the sign of each row's change already says which side it is,
 *  so a second section would only repeat the header. Turnover is left out because the leaders
 *  section ranks the same names by it, and the two lists overlap. */
function moversSection(overview: MarketDataOverview): BriefSectionResult | undefined {
  const movers = overview.movers

  if (movers === undefined) {
    return undefined
  }

  const ranked = [
    ...movers.gainers.slice(0, MAXIMUM_NAMES_PER_LIST),
    ...movers.losers.slice(0, MAXIMUM_NAMES_PER_LIST),
  ]

  return readySection(overview, {
    kind: MOVER_KIND[movers.window],
    rows: ranked.map((mover) => ({
      ticker: mover.instrument.ticker,
      changePct: mover.changePct,
    })),
  })
}

function sentimentSection(overview: MarketDataOverview): BriefSectionResult | undefined {
  if (overview.sentiment === undefined) {
    return undefined
  }

  return readySection(overview, {
    kind: 'sentiment',
    rows: [{ sentimentScore: overview.sentiment.score }],
  })
}
