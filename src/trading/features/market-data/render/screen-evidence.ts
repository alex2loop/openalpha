import type { Locale } from '@/core/types/locale'
import type { ScreenedCandidate } from '@/trading/features/market-data/types'
import type { FactorId, FactorResult } from '@/trading/kernel/factor'
import type { CurrencyCode, PriceDisplay, TradingDay } from '@/trading/kernel/instrument'
import type { ScreenCandidate } from '@/trading/kernel/market/market-capability'
import type { RenderContext } from '@/trading/render/format'
import { t } from '@/i18n'
import { byDistinctiveness } from '@/trading/markets/factor-scoring'
import { screenRating } from '@/trading/markets/screen-rating'
import { toFoldLines } from '@/trading/render/fold'
import {
  formatCount,
  formatPercentRank,
  formatScoreValue,
  formatSignedFixedPercent,
  formatWholeFraction,
  renderDeclaredValue,
  renderTopFactorFacts,
  SEVERITY_MARKS,
} from '@/trading/render/format'
import { renderQuoteFreshness } from '@/trading/render/freshness'
import { INDENT, toFactLines, toRowLines } from '@/trading/render/layout'
import { metricFacts, renderMetricLine } from '@/trading/render/metric'
import { formatFixedPrice, formatPrice } from '@/trading/render/money'
import { quoteBoardMoveOf } from '@/trading/render/price-pair'

/** Coverage at or above this says the whole model spoke, which is the ordinary case and therefore
 *  not worth a clause on every row. */
const FULL_COVERAGE = 1

interface CandidateRow {
  readonly candidate: ScreenedCandidate
  readonly index: number
  readonly gated: boolean
}

/** What every row on one board shares: how it quotes, the clock its times are read on, and what
 *  each factor reads as across the whole board. */
export interface ScreenBoard {
  readonly currency: CurrencyCode | undefined
  readonly display: PriceDisplay | undefined
  readonly context: RenderContext
  readonly medians: ReadonlyMap<FactorId, number>
  /** The session the board's evidence ends at: a price from any other session says so. */
  readonly day: TradingDay
}

/** One name as one row: its rank and verdict, the price it stands at, then the factors that most
 *  explain it. Facts wrap whole, so a narrow chat never splits a number from its label. A caution
 *  sits under the row because it changes how the row reads. */
export function renderCandidateBlock(
  locale: Locale,
  row: CandidateRow,
  board: ScreenBoard
): readonly string[] {
  const { candidate } = row
  const distinctive = byDistinctiveness(candidate.factors, board.medians)

  return [
    ...toRowLines(
      [
        ...rowFacts(locale, row),
        ...renderPriceFacts(locale, candidate, board),
        ...renderTopFactorFacts(locale, distinctive),
        ...renderReadingFacts(locale, candidate, board),
      ],
      board.context,
      1
    ),
    ...renderCautionLine(locale, candidate),
  ]
}

/** One name of a board listing as one row: its ticker, its price, then what each factor read and
 *  where that sits among the board's names. No rating, composite or rank, and no bar: those would
 *  order the list by merit, which the reader's own sort is there to do. Factors in a fixed order,
 *  so two names line up. */
export function renderBoardRow(
  locale: Locale,
  candidate: ScreenedCandidate,
  board: ScreenBoard
): readonly string[] {
  return toRowLines(
    [
      candidate.instrument.ticker,
      ...renderPriceFacts(locale, candidate, board),
      ...candidate.factors
        .filter((factor) => factor.weight !== undefined)
        .toSorted((left, right) => left.id.localeCompare(right.id))
        .map((factor) => renderBoardFactor(locale, { candidate, factor }, board))
        .filter((fact) => fact !== ''),
      ...renderReadingFacts(locale, candidate, board),
    ],
    board.context,
    1
  )
}

/** The plain values the market states beside the factors, short-labelled like a factor's own. */
function renderReadingFacts(
  locale: Locale,
  candidate: ScreenCandidate,
  board: ScreenBoard
): readonly string[] {
  return metricFacts(locale, candidate.readings, {
    labels: BOARD_READING.labels,
    canonical: BOARD_READING.canonical,
    ...(board.display === undefined ? {} : { quote: { display: board.display } }),
  })
}

/** What the factor read in the quantities it was scored on, and where that sits on the board. The
 *  score itself is left off: it is the composite's ingredient, and the board ranks nothing. A factor
 *  with no stated reading is named instead, and one with neither reading nor place says nothing. */
function renderBoardFactor(
  locale: Locale,
  row: { readonly candidate: ScreenedCandidate; readonly factor: FactorResult },
  board: ScreenBoard
): string {
  const { candidate, factor } = row
  const percentile = candidate.percentiles?.[factor.id]
  const reading =
    renderMetricLine(locale, factor.metrics, {
      ...BOARD_READING,
      ...(board.display === undefined ? {} : { quote: { display: board.display } }),
    }) ?? ''

  if (percentile === undefined) {
    return reading
  }

  return t(locale, 'trading.render.screen.boardFactor', {
    reading: reading === '' ? renderDeclaredValue(locale, `trading.factor.${factor.id}`) : reading,
    rank: formatPercentRank(locale, percentile),
  })
}

/** How a board writes a factor's quantities: short labels, each reading once, joined by commas. A
 *  board row and an app's factor cell write them alike. */
export const BOARD_READING = Object.freeze({
  labels: 'short',
  canonical: true,
  separator: ', ',
} as const)

/** Rank, verdict, and the composite the rank was taken on: the band alone cannot say whether the
 *  name above is a length clear or a hair ahead. Coverage joins them only when it is short of the
 *  whole model, where it changes how the rank should be read.
 *
 *  A gate board's rows carry no ordinal. Each name stands against its own absolute bands, so a
 *  numbered list would read as the selection between them the composite cannot make - the same
 *  reason its heading is not "top N of M". */
function rowFacts(locale: Locale, row: CandidateRow): readonly string[] {
  const { candidate } = row

  return [
    t(locale, row.gated ? 'trading.render.screen.gateRow' : 'trading.render.screen.row', {
      rank: formatCount(locale, row.index + 1),
      ticker: candidate.instrument.ticker,
      rating: renderDeclaredValue(locale, `trading.rating.${screenRating(candidate)}`),
    }),
    t(locale, 'trading.render.screen.score', {
      score: formatScoreValue(locale, candidate.composite.score),
    }),
    ...coverageSegment(locale, candidate.composite.coverage),
    ...(candidate.excluded === true ? [t(locale, 'trading.render.screen.excluded')] : []),
    ...(candidate.marginIneligible === true
      ? [t(locale, 'trading.render.screen.margin-ineligible')]
      : []),
  ]
}

function coverageSegment(locale: Locale, coverage: number): readonly string[] {
  if (coverage >= FULL_COVERAGE) {
    return []
  }

  return [
    t(locale, 'trading.render.screen.coverage', {
      coverage: formatWholeFraction(locale, coverage),
    }),
  ]
}

/** One block for the whole table rather than three lines under every name: the readings are what a
 *  reader checks a score against, and a board of twelve names is thirty-six lines of them. */
export function metricsFold(
  locale: Locale,
  candidates: readonly ScreenedCandidate[],
  board: ScreenBoard
): readonly string[] {
  const body = candidates.flatMap((candidate) => candidateMetricBlock(locale, candidate, board))

  return toFoldLines(t(locale, 'trading.render.screen.metricsFold'), body)
}

/** The ticker depends on the readings rather than travelling with them: an ETF board scores factors
 *  that publish no metric, and printed a heading over nothing but names. */
function candidateMetricBlock(
  locale: Locale,
  candidate: ScreenedCandidate,
  board: ScreenBoard
): readonly string[] {
  const facts = toFactLines(candidateMetricFacts(locale, candidate, board), board.context, 1)

  return facts.length === 0 ? [] : [candidate.instrument.ticker, ...facts]
}

/** Why this row reads weaker than its rank. Sits above the prices it was derived from, because the
 *  operator reading a lowered verdict asks what changed before asking what it costs. */
function renderCautionLine(locale: Locale, candidate: ScreenCandidate): readonly string[] {
  const { caution } = candidate

  if (caution === undefined) {
    return []
  }

  return [`${INDENT[2]}${SEVERITY_MARKS.warn} ${t(locale, `trading.screen.caution.${caution}`)}`]
}

/** One row per name, in a fixed order, so two names are only comparable when their numbers line up. */
function candidateMetricFacts(
  locale: Locale,
  candidate: ScreenCandidate,
  board: ScreenBoard
): readonly string[] {
  // The board scale travels because it decides what the number means; the currency does not, since
  // the two price rows above each name already carry it.
  return metricFacts(
    locale,
    candidate.factors.flatMap((factor) => factor.metrics ?? []),
    {
      labels: 'short',
      canonical: true,
      ...(board.display === undefined ? {} : { quote: { display: board.display } }),
    }
  )
}

/** The reading a row stands on and what it moved, as one fact; the unit is stated once above the
 *  rows. A close is dated only when it is not the board's own session, and a live price names its
 *  clock, so a row never passes a stale price off as today's. */
function renderPriceFacts(
  locale: Locale,
  candidate: ScreenCandidate,
  board: ScreenBoard
): readonly string[] {
  const { previousClose, price } = candidate

  if (price === undefined) {
    return []
  }

  const { currency, display } = board
  const move = quoteBoardMoveOf({
    last: price.quote.price,
    observed: price.observed,
    ...(price.quote.changePct === undefined ? {} : { changePct: price.quote.changePct }),
    ...(previousClose === undefined ? {} : { previousClose }),
  })
  const amount =
    display !== undefined || currency === undefined
      ? formatPrice(locale, price.quote.price, display)
      : formatFixedPrice(locale, price.quote.price, currency)
  const isOwnClose = price.observed.kind === 'close' && price.observed.day === board.day

  return [
    move === undefined ? amount : `${amount} ${formatSignedFixedPercent(locale, move)}`,
    ...(isOwnClose
      ? []
      : [renderQuoteFreshness(locale, price.observed, { timezone: board.context.timezone })]),
  ]
}
