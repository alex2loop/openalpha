import type { ScreenResponse } from '@/app/server/wire/market'

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

export type Candidate = ScreenResponse['candidates'][number]
export type SortDirection = 'asc' | 'desc'

/** A factor some name of the board read, as the sort offers it. */
export interface BoardFactor {
  readonly id: string
  readonly label: string
}

const TICKER_SORT: BaseSortKey = 'ticker'
const BASE_KEYS = Object.freeze(Object.keys(BASE_SORTS) as BaseSortKey[])

/** The base sorts this board can offer: the ticker always, the rest where some name carries the
 *  figure (a market that publishes no foreign flow has nothing to order by it). */
export function boardBaseKeys(candidates: readonly Candidate[]): readonly BaseSortKey[] {
  return BASE_KEYS.filter((key) => {
    const field = BASE_SORTS[key]

    return field === undefined || candidates.some((candidate) => candidate[field] !== undefined)
  })
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

/** The key to sort by: the visitor's choice, or the ticker when this board has no such sort (the
 *  choice outlives the market it was made on and the figures a board carries). */
export function resolveSortKey(
  key: string,
  baseKeys: readonly BaseSortKey[],
  factors: readonly BoardFactor[]
): string {
  const isBase = baseKeys.some((base) => base === key)
  const isFactor = factors.some(({ id }) => key === `${FACTOR_SORT_PREFIX}${id}`)

  return isBase || isFactor ? key : TICKER_SORT
}

/** The names in the order the visitor chose. A name with no figure for the key goes last in either
 *  direction, so a gap is never read as the smallest or the largest. A factor sorts on its score,
 *  which orders names exactly as its percentile does. */
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

    return candidate.factors?.find((factor) => factor.id === id)?.value
  }

  const base = BASE_KEYS.find((known) => known === key)
  const field = base === undefined ? undefined : BASE_SORTS[base]

  return field === undefined ? undefined : candidate[field]
}

function compareFigures(left: number | undefined, right: number | undefined, sign: number): number {
  if (left === undefined) {
    return right === undefined ? 0 : 1
  }

  return right === undefined ? -1 : sign * (left - right)
}
