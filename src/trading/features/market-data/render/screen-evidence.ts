import type { Locale } from '@/core/types/locale'
import type { ScreenedCandidate } from '@/trading/features/market-data/types'
import type { FactorId } from '@/trading/kernel/factor'
import type { FactorMetric } from '@/trading/kernel/factor-metric'
import type { CurrencyCode, PriceDisplay } from '@/trading/kernel/instrument'
import type { ScreenCandidate } from '@/trading/kernel/market/market-capability'
import type { RenderContext } from '@/trading/render/format'
import { t } from '@/i18n'
import { FACTOR_METRIC_IDS } from '@/trading/kernel/factor-metric'
import { byDistinctiveness } from '@/trading/markets/factor-scoring'
import { screenRating } from '@/trading/markets/screen-rating'
import { toFoldLines } from '@/trading/render/fold'
import {
  formatCount,
  formatScoreValue,
  formatWholeFraction,
  renderDeclaredValue,
  renderTopFactorLines,
  SEVERITY_MARKS,
} from '@/trading/render/format'
import { INDENT, INLINE_SEPARATOR, toFactLines } from '@/trading/render/layout'
import { metricFacts } from '@/trading/render/metric'
import { renderPricePair } from '@/trading/render/price-pair'

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
}

/** One name's whole block: the ranked row, then what that rank was taken on. */
export function renderCandidateBlock(
  locale: Locale,
  row: CandidateRow,
  board: ScreenBoard
): readonly string[] {
  return [renderRow(locale, row), ...candidateEvidenceLines(locale, row.candidate, board)]
}

/** Rank, verdict, and the composite the rank was taken on: the band alone cannot say whether the
 *  name above is a length clear or a hair ahead. Coverage joins them only when it is short of the
 *  whole model, where it changes how the rank should be read.
 *
 *  A gate board's rows carry no ordinal. Each name stands against its own absolute bands, so a
 *  numbered list would read as the selection between them the composite cannot make - the same
 *  reason its heading is not "top N of M". */
function renderRow(locale: Locale, row: CandidateRow): string {
  const { candidate } = row
  const segments = [
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

  return `${INDENT[1]}${segments.join(INLINE_SEPARATOR)}`
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

/** Why this name ranks where it does, then the quantities those scores were computed from — a
 *  normalized score cannot be checked against a filing and these can. */
function candidateEvidenceLines(
  locale: Locale,
  candidate: ScreenedCandidate,
  board: ScreenBoard
): readonly string[] {
  const distinctive = byDistinctiveness(candidate.factors, board.medians)

  return [
    ...renderCautionLine(locale, candidate),
    ...renderCandidatePrices(locale, candidate, board),
    ...renderTopFactorLines(locale, distinctive).map((line) => `${INDENT[2]}${line}`),
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

/** One row per name, in a fixed order: the same metric can back two factors, and two names are only
 *  comparable when their numbers line up. A reading is identified by its window as well as its id —
 *  the trailing high over 20 sessions is the breakout trigger and the one over 200 is how far the
 *  name sits off its year, and keying on the id alone let whichever factor came last silently
 *  replace the other. Ordered by id, then by window, so two names line up on both. */
function candidateMetricFacts(
  locale: Locale,
  candidate: ScreenCandidate,
  board: ScreenBoard
): readonly string[] {
  const byReading = new Map<string, FactorMetric>()

  for (const factor of candidate.factors) {
    for (const metric of factor.metrics ?? []) {
      byReading.set(`${metric.id}:${metric.sessions ?? ''}`, metric)
    }
  }

  const readings = [...byReading.values()]
  const ordered = FACTOR_METRIC_IDS.flatMap((id) =>
    readings
      .filter((metric) => metric.id === id)
      .toSorted((left, right) => (left.sessions ?? 0) - (right.sessions ?? 0))
  )
  // The board scale travels because it decides what the number means; the currency does not, since
  // the two price rows above each name already carry it.
  return metricFacts(locale, ordered, {
    labels: 'short',
    ...(board.display === undefined ? {} : { quote: { display: board.display } }),
  })
}

/** The same two dated rows `/price` and `/portfolio` print, so a board row and a lookup of one name
 *  read alike. A market publishing no ranked series answers with its own close-marked quote. */
function renderCandidatePrices(
  locale: Locale,
  candidate: ScreenCandidate,
  board: ScreenBoard
): readonly string[] {
  const { previousClose, price } = candidate
  const close =
    previousClose ??
    (price === undefined || price.observed.kind === 'live'
      ? undefined
      : { price: price.quote.price, at: price.observed.day })

  return renderPricePair(
    locale,
    {
      timezone: board.context.timezone,
      ...(close === undefined ? {} : { previousClose: close }),
      ...(price === undefined
        ? {}
        : {
            live: {
              price: price.quote.price,
              ...(price.quote.changePct === undefined ? {} : { changePct: price.quote.changePct }),
              observed: price.observed,
            },
          }),
      ...(board.currency === undefined ? {} : { currency: board.currency }),
      ...(board.display === undefined ? {} : { display: board.display }),
    },
    { context: board.context, depth: 2 }
  )
}
