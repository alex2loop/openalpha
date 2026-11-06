import type { Locale } from '@/core/types/locale'
import type {
  ScreenedCandidate,
  ScreenRowText,
  ScreenView,
} from '@/trading/features/market-data/types'
import type { FactorId } from '@/trading/kernel/factor'
import type { CurrencyCode, PriceDisplay, TradingDay } from '@/trading/kernel/instrument'
import type { ScreenCandidate, ScreenResult } from '@/trading/kernel/market/market-capability'
import type { RenderContext } from '@/trading/render/format'
import { t } from '@/i18n'
import {
  boardFacts,
  missingFactorLabels,
  renderBoardFactLines,
} from '@/trading/features/market-data/render/screen-facts'
import { boardMedians, byDistinctiveness } from '@/trading/markets/factor-scoring'
import { screenRating } from '@/trading/markets/screen-rating'
import { toFoldLines } from '@/trading/render/fold'
import {
  formatCount,
  formatScoreValue,
  formatSignedFixedPercent,
  NOTICE_SURFACE,
  renderDeclaredValue,
  renderProvidedValue,
  renderTopFactorFacts,
  resolveRenderContext,
  SEVERITY_MARKS,
} from '@/trading/render/format'
import { renderQuoteFreshness } from '@/trading/render/freshness'
import { INDENT, INLINE_SEPARATOR, toRowLines } from '@/trading/render/layout'
import { formatFixedPrice, formatPrice } from '@/trading/render/money'
import { quoteBoardMoveOf } from '@/trading/render/price-pair'

/** Which parts of a name's row a reader gets. The installed screen keeps every part; a list for a
 *  reader who holds no book drops the verdict and the operator's marks (`rated`) and the factor
 *  readings and cautions (`factors`). */
export interface ScreenRowForm {
  readonly rated: boolean
  readonly factors: boolean
}

export const FULL_ROW_FORM: ScreenRowForm = Object.freeze({ rated: true, factors: true })

interface CandidateRow {
  readonly candidate: ScreenedCandidate
  readonly index: number
  readonly gated: boolean
  readonly form: ScreenRowForm
}

const LIST_SEPARATOR = ', '

/** What every row on one board shares: how it quotes, the clock its times are read on, and what
 *  each factor reads as across the whole board. */
interface ScreenBoard {
  readonly currency: CurrencyCode | undefined
  readonly display: PriceDisplay | undefined
  readonly context: RenderContext
  readonly medians: ReadonlyMap<FactorId, number>
  /** The session the board's evidence ends at: a price from any other session says so. */
  readonly day: TradingDay
}

export function boardOf(
  request: { readonly context: RenderContext; readonly display?: PriceDisplay },
  result: ScreenResult
): ScreenBoard {
  return {
    currency: result.currency,
    display: request.display,
    context: request.context,
    medians: boardMedians(result.candidates.map((candidate) => candidate.factors)),
    day: result.dataThroughDay ?? result.asOf,
  }
}

/** A ranked board as a list of names, one line each, for a reader who sees nothing else of the
 *  screen. The caller names the clock a live price's time reads on. Prices read in the market's
 *  currency, in full: no board scale, so no unit line is owed. */
export function renderScreenRows(
  locale: Locale,
  view: ScreenView & { readonly timezone: string },
  form: ScreenRowForm
): readonly ScreenRowText[] {
  const board = boardOf({ context: resolveRenderContext(view.timezone, NOTICE_SURFACE) }, view)

  return view.candidates.map((candidate, index) => ({
    ticker: candidate.instrument.ticker,
    line: candidateFacts(
      locale,
      { candidate, index, gated: view.board === 'gate', form },
      board
    ).join(INLINE_SEPARATOR),
  }))
}

/** One name as one row: its rank and verdict, the price it stands at, then the factors that most
 *  explain it. Facts wrap whole, so a narrow chat never splits a number from its label. A caution
 *  sits under the row because it changes how the row reads. */
export function renderCandidateBlock(
  locale: Locale,
  row: CandidateRow,
  board: ScreenBoard
): readonly string[] {
  return [
    ...toRowLines(candidateFacts(locale, row, board), board.context, 1),
    ...(row.form.factors ? renderCautionLine(locale, row.candidate) : []),
  ]
}

/** What one row says about its name, as facts the caller lays out: the rank (with the verdict where
 *  the form keeps it), the score, the price and what it moved, then the factors that most explain
 *  the rank. */
function candidateFacts(locale: Locale, row: CandidateRow, board: ScreenBoard): readonly string[] {
  const { candidate, form } = row

  return [
    ...rowFacts(locale, row),
    ...renderPriceFacts(locale, candidate, board),
    ...(form.factors
      ? renderTopFactorFacts(locale, byDistinctiveness(candidate.factors, board.medians))
      : []),
  ]
}

/** One name of a board listing as one row: its ticker and its price, then its facts by group. No
 *  rating, composite or rank, and no bar: those would order the list by merit, which the reader's
 *  own sort is there to do. Facts in a fixed order, so two names line up. */
export function renderBoardRow(
  locale: Locale,
  candidate: ScreenedCandidate,
  board: ScreenBoard
): readonly string[] {
  return [
    ...toRowLines(
      [
        renderNameHead(locale, candidate),
        ...renderPriceFacts(locale, candidate, board),
        ...missingSegment(locale, candidate),
      ],
      board.context,
      1
    ),
    ...renderBoardFactLines(locale, boardFacts(locale, candidate, board), board.context),
  ]
}

/** How a board writes a factor's quantities: short labels, each reading once, joined by commas. A
 *  board row and an app's factor cell write them alike. */
export const BOARD_READING = Object.freeze({
  labels: 'short',
  canonical: true,
  separator: ', ',
  withoutRanks: true,
} as const)

/** Rank, verdict, and the composite the rank was taken on: the band alone cannot say whether the
 *  name above is a length clear or a hair ahead. Coverage joins them only when it is short of the
 *  whole model, where it changes how the rank should be read.
 *
 *  A gate board's rows carry no ordinal. Each name stands against its own absolute bands, so a
 *  numbered list would read as the selection between them the composite cannot make - the same
 *  reason its heading is not "top N of M". */
function rowFacts(locale: Locale, row: CandidateRow): readonly string[] {
  const { candidate, form } = row

  return [
    headFact(locale, row),
    t(locale, 'trading.render.screen.score', {
      score: formatScoreValue(locale, candidate.composite.score),
    }),
    ...(form.factors ? missingSegment(locale, candidate) : []),
    ...(form.rated && candidate.excluded === true
      ? [t(locale, 'trading.render.screen.excluded')]
      : []),
    ...(form.rated && candidate.marginIneligible === true
      ? [t(locale, 'trading.render.screen.margin-ineligible')]
      : []),
  ]
}

function headFact(locale: Locale, row: CandidateRow): string {
  const { candidate } = row
  const shared = {
    rank: formatCount(locale, row.index + 1),
    ticker: renderNameHead(locale, candidate),
  }

  if (!row.form.rated) {
    return t(locale, 'trading.render.screen.rowUnrated', shared)
  }

  return t(locale, row.gated ? 'trading.render.screen.gateRow' : 'trading.render.screen.row', {
    ...shared,
    rating: renderDeclaredValue(locale, `trading.rating.${screenRating(candidate)}`),
  })
}

/** The ticker, then the sector the market files it under where it files one: a ticker alone does
 *  not say what the company does. Names itself, so it takes no label. */
function renderNameHead(locale: Locale, candidate: ScreenCandidate): string {
  const { sector } = candidate

  return sector === undefined
    ? candidate.instrument.ticker
    : [
        candidate.instrument.ticker,
        renderProvidedValue(locale, `trading.sector.${sector}`, sector),
      ].join(INLINE_SEPARATOR)
}

function missingSegment(locale: Locale, candidate: ScreenCandidate): readonly string[] {
  const missing = missingFactorLabels(locale, candidate)

  return missing.length === 0
    ? []
    : [t(locale, 'trading.render.screen.missing', { factors: missing.join(LIST_SEPARATOR) })]
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
  const facts = renderBoardFactLines(locale, boardFacts(locale, candidate, board), board.context)

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
