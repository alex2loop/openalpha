import type { Locale } from '@/core/types/locale'
import type { ScreenedCandidate } from '@/trading/features/market-data/types'
import type { FactorResult } from '@/trading/kernel/factor'
import type { FactorMetric, FactorMetricId } from '@/trading/kernel/factor-metric'
import type { PriceDisplay } from '@/trading/kernel/instrument'
import type { ScreenCandidate } from '@/trading/kernel/market/market-capability'
import type { RenderContext } from '@/trading/render/format'
import { t } from '@/i18n'
import { formatSignedPercent, renderDeclaredValue } from '@/trading/render/format'
import { INDENT, toFactLines } from '@/trading/render/layout'
import { type MetricReading, metricReadings } from '@/trading/render/metric'
import { formatPercentRank } from '@/trading/render/rank'

const MONTH_CHANGE_ID = 'month-change'

/** The groups a name's facts sit under, in the order they print. */
const BOARD_GROUPS = Object.freeze(['price', 'valuation', 'flow', 'derivatives'] as const)

type BoardGroup = (typeof BOARD_GROUPS)[number]

/** Where each reading is listed on a board. One with no group is no fact of the name: the count of
 *  peers a rank was taken among is a ranking word, not a reading. */
const BOARD_GROUP_OF = Object.freeze({
  pe: 'valuation',
  'average-profit-pe': 'valuation',
  pb: 'valuation',
  'earnings-growth': 'valuation',
  'revenue-growth': 'valuation',
  'value-percentile': 'valuation',
  'return-on-equity': 'valuation',
  'return-on-assets': 'valuation',
  'debt-to-equity': 'valuation',
  'gross-margin': 'valuation',
  'quality-percentile': 'valuation',
  'accounts-score': 'valuation',
  'return-on-invested-capital': 'valuation',
  'interest-cover': 'valuation',
  'net-debt-to-ebitda': 'valuation',
  'bad-debt-ratio': 'valuation',
  'watch-list-ratio': 'valuation',
  'provision-cover': 'valuation',
  'casa-share': 'valuation',
  'cost-to-income': 'valuation',
  'capital-adequacy': 'valuation',
  'net-interest-to-assets': 'valuation',
  'sector-pe': 'valuation',
  'trend-average': 'price',
  'year-high': 'price',
  'distance-from-high': 'price',
  'distance-from-low': 'price',
  'average-range': 'price',
  'relative-return': 'price',
  'breakout-trigger': 'price',
  'trailing-low': 'price',
  'price-change': 'price',
  'daily-volatility': 'price',
  'median-turnover': 'price',
  'relative-volume': 'price',
  'market-cap': 'price',
  'volume-24h': 'price',
  'volume-to-market-cap': 'price',
  'world-gold-premium': 'price',
  'foreign-net-flow': 'flow',
  'foreign-room-left': 'flow',
  'proprietary-net-flow': 'flow',
  'funding-daily': 'derivatives',
  'open-interest-change': 'derivatives',
  'long-short-ratio': 'derivatives',
  'ranked-peers': undefined,
} as const satisfies Readonly<Record<FactorMetricId, BoardGroup | undefined>>)

/** The readings a page keeps behind its "more" control: they back a factor's score but are rarely
 *  what a reader screens on. */
const SECONDARY_READINGS: ReadonlySet<FactorMetricId> = new Set([
  'average-profit-pe',
  'value-percentile',
  'quality-percentile',
  'return-on-assets',
  'debt-to-equity',
  'gross-margin',
  'return-on-invested-capital',
  'interest-cover',
  'net-debt-to-ebitda',
  'watch-list-ratio',
  'provision-cover',
  'casa-share',
  'cost-to-income',
  'capital-adequacy',
  'net-interest-to-assets',
  'trend-average',
  'year-high',
  'distance-from-low',
  'breakout-trigger',
  'trailing-low',
  'relative-volume',
  'volume-to-market-cap',
  'daily-volatility',
])

/** A factor with a place on the board but no reading of its own is listed under price. */
const UNMEASURED_GROUP: BoardGroup = 'price'

/** One fact of a name on a board: a reading with its label and value apart, for a page to lay out
 *  as it likes and for the text below to join. A factor's place among the board's names is a fact of
 *  its own, valued as that place: the score it is taken on is no one of the readings listed. */
export interface BoardFact {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly group: BoardGroup
  /** A reading a page may keep behind a "more" control. */
  readonly secondary?: true
}

/** What a name reads on a board, each reading once, grouped and in a fixed order so two names line
 *  up: the plain values its market states, then what each factor that fired for it read, and where
 *  the name sits among the board's names on each of those factors. */
export function boardFacts(
  locale: Locale,
  candidate: ScreenedCandidate,
  board: { readonly display: PriceDisplay | undefined }
): readonly BoardFact[] {
  const options = {
    labels: 'short',
    canonical: true,
    row: true,
    ...(candidate.percentiles === undefined ? {} : { withoutRanks: true as const }),
    ...(board.display === undefined ? {} : { quote: { display: board.display } }),
  } as const
  const read = (metrics: readonly FactorMetric[] | undefined) =>
    metricReadings(locale, metrics, options)
  const found = new Map<string, BoardFact>()

  for (const reading of read(candidate.readings)) {
    addFact(found, `${reading.metric.id}:${reading.metric.sessions ?? ''}`, toFact(reading))
  }

  for (const factor of firedFactors(candidate)) {
    const percentile = candidate.percentiles?.[factor.id]
    const readings = read(factor.metrics?.filter(({ id }) => BOARD_GROUP_OF[id] !== undefined))

    for (const reading of readings) {
      addFact(found, `${reading.metric.id}:${reading.metric.sessions ?? ''}`, toFact(reading))
    }

    if (percentile !== undefined) {
      addFact(found, factor.id, {
        id: factor.id,
        label: renderDeclaredValue(locale, `trading.factor.${factor.id}`),
        value: formatPercentRank(locale, percentile, 'plain'),
        group: readings[0] === undefined ? UNMEASURED_GROUP : toFact(readings[0]).group,
      })
    }
  }

  addOwnFacts(locale, { candidate, found, read })

  return [...found.values()].toSorted(
    (left, right) => BOARD_GROUPS.indexOf(left.group) - BOARD_GROUPS.indexOf(right.group)
  )
}

/** The size, the traded value and the month's move a market states as fields of the name rather
 *  than as readings, listed through the same formatters unless a reading already states them. */
function addOwnFacts(locale: Locale, own: OwnFacts): void {
  const { candidate, found, read } = own
  const stated = new Set([...found.values()].map(({ id }) => id))
  const measures: readonly FactorMetric[] = [
    ...(candidate.marketCap === undefined
      ? []
      : [{ id: 'market-cap' as const, value: candidate.marketCap }]),
    ...(candidate.turnover === undefined
      ? []
      : [{ id: 'median-turnover' as const, value: candidate.turnover }]),
  ]

  for (const reading of read(measures)) {
    if (!stated.has(reading.metric.id)) {
      addFact(found, reading.metric.id, toFact(reading))
    }
  }

  if (candidate.monthChangePct !== undefined) {
    addFact(found, MONTH_CHANGE_ID, {
      id: MONTH_CHANGE_ID,
      label: t(locale, 'trading.render.screen.monthChange'),
      value: formatSignedPercent(locale, candidate.monthChangePct),
      group: 'price',
    })
  }
}

interface OwnFacts {
  readonly candidate: ScreenedCandidate
  readonly found: Map<string, BoardFact>
  readonly read: (metrics: readonly FactorMetric[]) => readonly MetricReading[]
}

function toFact({ metric, label, value }: MetricReading): BoardFact {
  const group = BOARD_GROUP_OF[metric.id]

  return {
    id: metric.id,
    label,
    value,
    group: group ?? UNMEASURED_GROUP,
    ...(SECONDARY_READINGS.has(metric.id) ? { secondary: true as const } : {}),
  }
}

/** A reading two sources state keeps its first form. */
function addFact(found: Map<string, BoardFact>, key: string, fact: BoardFact): void {
  if (!found.has(key)) {
    found.set(key, fact)
  }
}

/** In a fixed order, which is what lets two names be read against each other. */
function firedFactors(candidate: ScreenCandidate): readonly FactorResult[] {
  return candidate.factors
    .filter((factor) => factor.weight !== undefined)
    .toSorted((left, right) => left.id.localeCompare(right.id))
}

/** The factors that had nothing to read for the name, in the operator's language: what is missing
 *  rather than how much of a model. */
export function missingFactorLabels(locale: Locale, candidate: ScreenCandidate): readonly string[] {
  return candidate.factors
    .filter((factor) => factor.weight === undefined)
    .map((factor) => renderDeclaredValue(locale, `trading.factor.${factor.id}`))
}

/** The facts as lines of text, a heading over each group: `Label: value`. A fact never splits across
 *  lines. */
export function renderBoardFactLines(
  locale: Locale,
  facts: readonly BoardFact[],
  context: RenderContext
): readonly string[] {
  return BOARD_GROUPS.flatMap((group) => {
    const texts = facts
      .filter((fact) => fact.group === group)
      .map((fact) => renderBoardFact(locale, fact))

    return texts.length === 0
      ? []
      : [
          `${INDENT[1]}${t(locale, `trading.render.screen.group.${group}`)}`,
          ...toFactLines(texts, context, 2),
        ]
  })
}

function renderBoardFact(locale: Locale, fact: BoardFact): string {
  return t(locale, 'trading.render.metric.row', { label: fact.label, value: fact.value })
}
