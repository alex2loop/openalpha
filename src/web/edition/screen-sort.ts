import type { ScreenResponse } from '@/app/server/wire/market'

export type Candidate = ScreenResponse['candidates'][number]
export type SortDirection = 'asc' | 'desc'

/** A factor some name of the board read, as the sort offers it. */
export interface BoardFactor {
  readonly id: string
  readonly label: string
}

export const SORT_BASE_KEYS = Object.freeze(['ticker', 'price', 'change'] as const)
/** A sort key that names a factor: the prefix, then the factor id. */
export const FACTOR_SORT_PREFIX = 'factor:'

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
    key === 'ticker'
      ? sign * left.instrument.ticker.localeCompare(right.instrument.ticker)
      : compareFigures(figureOf(left, key), figureOf(right, key), sign)
  )
}

function figureOf(candidate: Candidate, key: string): number | undefined {
  if (key.startsWith(FACTOR_SORT_PREFIX)) {
    const id = key.slice(FACTOR_SORT_PREFIX.length)

    return candidate.factors?.find((factor) => factor.id === id)?.value
  }

  return key === 'price' ? candidate.price : candidate.changePct
}

function compareFigures(left: number | undefined, right: number | undefined, sign: number): number {
  if (left === undefined) {
    return right === undefined ? 0 : 1
  }

  return right === undefined ? -1 : sign * (left - right)
}
