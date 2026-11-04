import type { ScreenResponse } from '@/app/server/wire/market'
import type { MessageKey } from '@/i18n'
import { PERCENT } from '@/web/text/figures'

/** The size limits are typed in billions: a VN market value in whole units runs to fifteen digits. */
const BILLION = 1_000_000_000
/** A share the wire states as a fraction (`0.12`) is typed as a percent (`12`). */
const PERCENT_TO_FRACTION = 1 / PERCENT

/** A market value is limited the same way whichever field the market states it in. */
const MARKET_CAP_LIMIT: Limit = Object.freeze({
  min: 'ui.office.edition.screen.filter.minMarketCap',
  max: 'ui.office.edition.screen.filter.maxMarketCap',
  scale: BILLION,
})

/** The limits the base figures take. */
export const BASE_LIMITS: Readonly<Partial<Record<BaseSortKey, Limit>>> = Object.freeze({
  turnover: { min: 'ui.office.edition.screen.filter.minTurnover', scale: BILLION },
  marketCap: MARKET_CAP_LIMIT,
})

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
const SESSIONS_SEPARATOR = ':'
const BASE_KEYS = Object.freeze(Object.keys(BASE_SORTS) as BaseSortKey[])

export type Candidate = ScreenResponse['candidates'][number]
export type SortDirection = 'asc' | 'desc'

/** What a typed limit on a figure means: the labels that ask for its two sides (a side without one
 *  is not offered), and the scale between what is typed and what the name carries. */
export interface Limit {
  readonly min?: MessageKey
  readonly max?: MessageKey
  readonly scale: number
  /** The wire states the figure as a negative distance below a reference; the limit is typed as the
   *  distance, so a name 8% under its high passes a limit of 10. */
  readonly isBelow?: true
}

/** A quantity a market states for a name beyond the base figures: found by its wire id among the
 *  name's readings and its factors' metrics, over the span the wire states for it. Its label says
 *  that span as `{sessions}`. */
interface Quantity {
  readonly id: string
  readonly label: MessageKey
  readonly limit?: Limit
}

/** A quantity as one board carries it: the span (where the wire states one) is part of what it is,
 *  so a board holding a week's and a month's change offers both. */
export interface MetricColumn extends Quantity {
  readonly sessions?: number
}

/** The quantities a board can order and filter by where some name carries them, in the order they
 *  are offered. The one table the sort, the limits and the CSV read. */
const QUANTITIES: readonly Quantity[] = Object.freeze([
  {
    id: 'pe',
    label: 'ui.office.edition.screen.sort.pe',
    limit: { max: 'ui.office.edition.screen.filter.maxPe', scale: 1 },
  },
  {
    id: 'distance-from-high',
    label: 'ui.office.edition.screen.sort.distanceFromHigh',
    limit: {
      max: 'ui.office.edition.screen.filter.maxDistanceFromHigh',
      scale: 1,
      isBelow: true,
    },
  },
  {
    id: 'relative-return',
    label: 'ui.office.edition.screen.sort.relativeReturn',
    limit: { min: 'ui.office.edition.screen.filter.minRelativeReturn', scale: 1 },
  },
  {
    id: 'average-range',
    label: 'ui.office.edition.screen.sort.averageRange',
    limit: { max: 'ui.office.edition.screen.filter.maxAverageRange', scale: 1 },
  },
  {
    id: 'foreign-room-left',
    label: 'ui.office.edition.screen.sort.foreignRoom',
    limit: { min: 'ui.office.edition.screen.filter.minForeignRoom', scale: PERCENT_TO_FRACTION },
  },
  { id: 'proprietary-net-flow', label: 'ui.office.edition.screen.sort.proprietaryNet' },
  {
    id: 'market-cap',
    label: 'ui.office.edition.screen.sort.marketCap',
    limit: MARKET_CAP_LIMIT,
  },
  {
    id: 'volume-24h',
    label: 'ui.office.edition.screen.sort.volume24h',
    limit: { min: 'ui.office.edition.screen.filter.minVolume24h', scale: BILLION },
  },
  {
    id: 'price-change',
    label: 'ui.office.edition.screen.sort.priceChange',
    limit: { min: 'ui.office.edition.screen.filter.minPriceChange', scale: 1 },
  },
])

const QUANTITY_IDS: ReadonlySet<string> = new Set(QUANTITIES.map(({ id }) => id))

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

/** The measured quantities this board can offer, one per span the wire states for it, where some
 *  name carries one. */
export function boardMetrics(candidates: readonly Candidate[]): readonly MetricColumn[] {
  const spans = new Map<string, Set<number | undefined>>()

  for (const candidate of candidates) {
    for (const { id, sessions } of measuresOf(candidate)) {
      if (QUANTITY_IDS.has(id)) {
        spans.set(id, (spans.get(id) ?? new Set()).add(sessions))
      }
    }
  }

  return QUANTITIES.flatMap((quantity) =>
    [...(spans.get(quantity.id) ?? [])]
      .toSorted((left, right) => (left ?? 0) - (right ?? 0))
      .map((sessions) => (sessions === undefined ? quantity : { ...quantity, sessions }))
  )
}

/** What names a column in a sort key or a limit: its wire id, and its span where it has one. */
export function metricKey({ id, sessions }: Pick<MetricColumn, 'id' | 'sessions'>): string {
  return sessions === undefined ? id : `${id}${SESSIONS_SEPARATOR}${sessions}`
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
  return measuresOf(candidate).find((metric) => metric.id === id && metric.sessions === sessions)
    ?.value
}

function measuresOf(candidate: Candidate) {
  return [
    ...(candidate.readings ?? []),
    ...(candidate.factors ?? []).flatMap((factor) => factor.metrics ?? []),
  ]
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
  const isMetric = metrics.some((column) => key === `${METRIC_SORT_PREFIX}${metricKey(column)}`)
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
    const column = columnOf(key.slice(METRIC_SORT_PREFIX.length))

    return metricOf(candidate, column)
  }

  const base = BASE_KEYS.find((known) => known === key)

  return base === undefined ? undefined : baseFigureOf(candidate, base)
}

function columnOf(text: string): Pick<MetricColumn, 'id' | 'sessions'> {
  const [id = text, sessions] = text.split(SESSIONS_SEPARATOR)

  return sessions === undefined ? { id } : { id, sessions: Number(sessions) }
}

function compareFigures(left: number | undefined, right: number | undefined, sign: number): number {
  if (left === undefined) {
    return right === undefined ? 0 : 1
  }

  return right === undefined ? -1 : sign * (left - right)
}
