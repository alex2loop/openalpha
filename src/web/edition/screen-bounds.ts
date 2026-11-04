import type { MessageKey } from '@/i18n'
import { type Candidate, metricOf } from '@/web/edition/screen-sort'
import { toDecimal } from '@/web/text/decimal'

/** The size inputs are typed in billions: a VN market value in whole units runs to fifteen digits. */
const BILLION = 1_000_000_000
/** A share the wire states as a fraction (`0.12`) is typed as a percent (`12`). */
const PERCENT_TO_FRACTION = 0.01
const NEGATIVE_MARK = '-'
const WEEK_SESSIONS = 7
const MONTH_SESSIONS = 30

/** One value limit the visitor can set: which figure of a name it bounds, from which side, and the
 *  scale between what is typed and what the name carries. */
export interface Bound {
  readonly id: string
  readonly label: MessageKey
  readonly side: 'min' | 'max'
  readonly scale: number
  readonly read: (candidate: Candidate) => number | undefined
}

/** A bound the visitor has filled in, as the number it limits to. */
interface ActiveBound {
  readonly bound: Bound
  readonly limit: number
}

/** Every limit the page can offer, in the order it offers them. A bound is shown only where the
 *  board carries its figure, so a market without it has no dead field. */
const BOUNDS: readonly Bound[] = Object.freeze([
  {
    id: 'minTurnover',
    label: 'ui.office.edition.screen.filter.minTurnover',
    side: 'min',
    scale: BILLION,
    read: (candidate) => candidate.turnover,
  },
  {
    id: 'minMarketCap',
    label: 'ui.office.edition.screen.filter.minMarketCap',
    side: 'min',
    scale: BILLION,
    read: (candidate) => marketCapOf(candidate),
  },
  {
    id: 'maxMarketCap',
    label: 'ui.office.edition.screen.filter.maxMarketCap',
    side: 'max',
    scale: BILLION,
    read: (candidate) => marketCapOf(candidate),
  },
  {
    id: 'minVolume24h',
    label: 'ui.office.edition.screen.filter.minVolume24h',
    side: 'min',
    scale: BILLION,
    read: (candidate) => metricOf(candidate, { id: 'volume-24h' }),
  },
  {
    id: 'maxPe',
    label: 'ui.office.edition.screen.filter.maxPe',
    side: 'max',
    scale: 1,
    read: (candidate) => metricOf(candidate, { id: 'pe' }),
  },
  {
    id: 'maxDistanceFromHigh',
    label: 'ui.office.edition.screen.filter.maxDistanceFromHigh',
    side: 'max',
    scale: 1,
    read: (candidate) => distanceBelowHigh(candidate),
  },
  {
    id: 'minRelativeReturn',
    label: 'ui.office.edition.screen.filter.minRelativeReturn',
    side: 'min',
    scale: 1,
    read: (candidate) => metricOf(candidate, { id: 'relative-return' }),
  },
  {
    id: 'maxAverageRange',
    label: 'ui.office.edition.screen.filter.maxAverageRange',
    side: 'max',
    scale: 1,
    read: (candidate) => metricOf(candidate, { id: 'average-range' }),
  },
  {
    id: 'minForeignRoom',
    label: 'ui.office.edition.screen.filter.minForeignRoom',
    side: 'min',
    scale: PERCENT_TO_FRACTION,
    read: (candidate) => metricOf(candidate, { id: 'foreign-room-left' }),
  },
  {
    id: 'minWeekChange',
    label: 'ui.office.edition.screen.filter.minWeekChange',
    side: 'min',
    scale: 1,
    read: (candidate) => metricOf(candidate, { id: 'price-change', sessions: WEEK_SESSIONS }),
  },
  {
    id: 'minMonthChange',
    label: 'ui.office.edition.screen.filter.minMonthChange',
    side: 'min',
    scale: 1,
    read: (candidate) => metricOf(candidate, { id: 'price-change', sessions: MONTH_SESSIONS }),
  },
])

/** The bounds this board can honour: those whose figure some name carries. */
export function boardBounds(candidates: readonly Candidate[]): readonly Bound[] {
  return BOUNDS.filter((bound) =>
    candidates.some((candidate) => bound.read(candidate) !== undefined)
  )
}

/** Whether the visitor has set any limit the board offers. */
export function hasLimits(
  bounds: readonly Bound[],
  typed: Readonly<Record<string, string>>
): boolean {
  return activeLimits(bounds, typed).length > 0
}

/** The names within every limit the visitor typed. A name with no figure for a limit does not pass
 *  it: the page cannot say it clears a bar nobody measured. A field that is empty or unreadable
 *  limits nothing, and neither does a limit the board does not offer (a view outlives its data). */
export function withinLimits(
  candidates: readonly Candidate[],
  bounds: readonly Bound[],
  typed: Readonly<Record<string, string>>
): readonly Candidate[] {
  const active = activeLimits(bounds, typed)

  return candidates.filter((candidate) => active.every((limit) => isWithin(candidate, limit)))
}

function activeLimits(
  bounds: readonly Bound[],
  typed: Readonly<Record<string, string>>
): readonly ActiveBound[] {
  return bounds.flatMap((bound): readonly ActiveBound[] => {
    const limit = limitOf(typed[bound.id] ?? '', bound.scale)

    return limit === undefined ? [] : [{ bound, limit }]
  })
}

function isWithin(candidate: Candidate, { bound, limit }: ActiveBound): boolean {
  const value = bound.read(candidate)

  if (value === undefined) {
    return false
  }

  return bound.side === 'min' ? value >= limit : value <= limit
}

function marketCapOf(candidate: Candidate): number | undefined {
  return candidate.marketCap ?? metricOf(candidate, { id: 'market-cap' })
}

// The wire states how far below the high a name stands as a negative percent; the limit is typed as
// the distance, so a name 8% under its high passes a limit of 10.
function distanceBelowHigh(candidate: Candidate): number | undefined {
  const distance = metricOf(candidate, { id: 'distance-from-high' })

  return distance === undefined ? undefined : -distance
}

/** The typed limit in the figure's own unit; a leading minus is kept, since a move can limit below
 *  zero. */
function limitOf(text: string, scale: number): number | undefined {
  const trimmed = text.trim()
  const isNegative = trimmed.startsWith(NEGATIVE_MARK)
  const magnitude = toDecimal(isNegative ? trimmed.slice(NEGATIVE_MARK.length) : trimmed)

  if (magnitude === undefined) {
    return undefined
  }

  return (isNegative ? -magnitude : magnitude) * scale
}
