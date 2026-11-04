import type { ScreenResponse } from '@/app/server/wire/market'
import type { MessageKey } from '@/i18n'

/** The sorts the board offers beside its factors, each reading one field of a name. */
export const BASE_SORTS = Object.freeze({
  ticker: undefined,
  price: 'price',
  change: 'changePct',
  month: 'monthChangePct',
  turnover: 'turnover',
  marketCap: 'marketCap',
  foreignNet: 'foreignNet',
} as const)

export type BaseSortKey = keyof typeof BASE_SORTS

/** A sort key that names a factor: the prefix, then the factor id. */
export const FACTOR_SORT_PREFIX = 'factor:'
/** A sort key that names a measured quantity: the prefix, then the column's key. */
export const METRIC_SORT_PREFIX = 'metric:'
const TICKER_SORT: BaseSortKey = 'ticker'
const BASE_KEYS = Object.freeze(Object.keys(BASE_SORTS) as BaseSortKey[])

export type Candidate = ScreenResponse['candidates'][number]
export type SortDirection = 'asc' | 'desc'

/** A quantity a market states for a name beyond the base figures: found by its id (and its window,
 *  where one market publishes several) among the name's readings and its factors' metrics. */
export interface MetricColumn {
  readonly key: string
  readonly id: string
  readonly sessions?: number
  readonly label: MessageKey
}

/** The quantities a board can order by where some name carries them, in the order they are offered. */
const METRIC_COLUMNS: readonly MetricColumn[] = Object.freeze([
  { key: 'pe', id: 'pe', label: 'ui.office.edition.screen.sort.pe' },
  {
    key: 'distanceFromHigh',
    id: 'distance-from-high',
    label: 'ui.office.edition.screen.sort.distanceFromHigh',
  },
  {
    key: 'relativeReturn',
    id: 'relative-return',
    label: 'ui.office.edition.screen.sort.relativeReturn',
  },
  { key: 'averageRange', id: 'average-range', label: 'ui.office.edition.screen.sort.averageRange' },
  {
    key: 'foreignRoom',
    id: 'foreign-room-left',
    label: 'ui.office.edition.screen.sort.foreignRoom',
  },
  {
    key: 'proprietaryNet',
    id: 'proprietary-net-flow',
    label: 'ui.office.edition.screen.sort.proprietaryNet',
  },
  { key: 'coinCap', id: 'market-cap', label: 'ui.office.edition.screen.sort.marketCap' },
  { key: 'volume24h', id: 'volume-24h', label: 'ui.office.edition.screen.sort.volume24h' },
  {
    key: 'week',
    id: 'price-change',
    sessions: 7,
    label: 'ui.office.edition.screen.sort.week',
  },
  {
    key: 'month30',
    id: 'price-change',
    sessions: 30,
    label: 'ui.office.edition.screen.sort.month30',
  },
])

/** A factor some name of the board read, as the sort offers it. */
export interface BoardFactor {
  readonly id: string
  readonly label: string
}

/** The base sorts this board can offer: the ticker always, the rest where some name carries the
 *  figure (a market that publishes no foreign flow has nothing to order by it). */
export function boardBaseKeys(candidates: readonly Candidate[]): readonly BaseSortKey[] {
  return BASE_KEYS.filter(
    (key) =>
      key === TICKER_SORT ||
      candidates.some((candidate) => baseFigureOf(candidate, key) !== undefined)
  )
}

/** The measured quantities this board can offer, where some name carries one. */
export function boardMetrics(candidates: readonly Candidate[]): readonly MetricColumn[] {
  return METRIC_COLUMNS.filter((column) =>
    candidates.some((candidate) => metricOf(candidate, column) !== undefined)
  )
}

/** What the name carries for a base sort: absent for the ticker, which is no figure, and for a
 *  figure its market does not publish. */
export function baseFigureOf(candidate: Candidate, key: BaseSortKey): number | undefined {
  const field = BASE_SORTS[key]

  return field === undefined ? undefined : candidate[field]
}

/** The value of a quantity for a name, read from its market's readings first and then from what its
 *  factors measured; absent where the market states none. */
export function metricOf(
  candidate: Candidate,
  { id, sessions }: Pick<MetricColumn, 'id' | 'sessions'>
): number | undefined {
  const measured = [
    ...(candidate.readings ?? []),
    ...(candidate.factors ?? []).flatMap((factor) => factor.metrics ?? []),
  ]

  return measured.find(
    (metric) => metric.id === id && (sessions === undefined || metric.sessions === sessions)
  )?.value
}

/** The factors the board's names read, in the order they first appear. */
export function boardFactors(candidates: readonly Candidate[]): readonly BoardFactor[] {
  const found = new Map<string, BoardFactor>()

  for (const candidate of candidates) {
    for (const { id, label } of candidate.factors ?? []) {
      if (!found.has(id)) {
        found.set(id, { id, label })
      }
    }
  }

  return [...found.values()]
}

/** What a board can order by. */
export interface SortChoices {
  readonly baseKeys: readonly BaseSortKey[]
  readonly metrics: readonly MetricColumn[]
  readonly factors: readonly BoardFactor[]
}

/** The key to sort by: the visitor's choice, or the ticker when this board has no such sort (the
 *  choice outlives the market it was made on and the figures a board carries). */
export function resolveSortKey(key: string, { baseKeys, metrics, factors }: SortChoices): string {
  const isBase = baseKeys.some((base) => base === key)
  const isMetric = metrics.some((column) => key === `${METRIC_SORT_PREFIX}${column.key}`)
  const isFactor = factors.some(({ id }) => key === `${FACTOR_SORT_PREFIX}${id}`)

  return isBase || isMetric || isFactor ? key : TICKER_SORT
}

/** The names in the order the visitor chose. A name with no figure for the key goes last in either
 *  direction, so a gap is never read as the smallest or the largest. A factor sorts on its
 *  percentile on the board. */
export function sortCandidates(
  candidates: readonly Candidate[],
  key: string,
  direction: SortDirection
): readonly Candidate[] {
  const sign = direction === 'asc' ? 1 : -1

  return [...candidates].sort((left, right) =>
    key === TICKER_SORT
      ? sign * left.instrument.ticker.localeCompare(right.instrument.ticker)
      : compareFigures(figureOf(left, key), figureOf(right, key), sign)
  )
}

function figureOf(candidate: Candidate, key: string): number | undefined {
  if (key.startsWith(FACTOR_SORT_PREFIX)) {
    const id = key.slice(FACTOR_SORT_PREFIX.length)

    return candidate.factors?.find((factor) => factor.id === id)?.percentile
  }

  if (key.startsWith(METRIC_SORT_PREFIX)) {
    const column = METRIC_COLUMNS.find((known) => `${METRIC_SORT_PREFIX}${known.key}` === key)

    return column === undefined ? undefined : metricOf(candidate, column)
  }

  const base = BASE_KEYS.find((known) => known === key)

  return base === undefined ? undefined : baseFigureOf(candidate, base)
}

function compareFigures(left: number | undefined, right: number | undefined, sign: number): number {
  if (left === undefined) {
    return right === undefined ? 0 : 1
  }

  return right === undefined ? -1 : sign * (left - right)
}
