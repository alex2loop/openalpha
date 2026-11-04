import type { MessageKey } from '@/i18n'
import {
  BASE_LIMITS,
  type BaseSortKey,
  baseFigureOf,
  type Candidate,
  type Limit,
  type MetricColumn,
  metricKey,
  metricOf,
} from '@/web/edition/screen-sort'
import { toDecimal } from '@/web/text/decimal'

const NEGATIVE_MARK = '-'
const SIDES = Object.freeze(['min', 'max'] as const)

/** One value limit the visitor can set: which figure of a name it bounds, from which side, and the
 *  scale between what is typed and what the name carries. */
export interface Bound {
  readonly id: string
  readonly label: MessageKey
  /** The span the label names, where the figure has one. */
  readonly sessions?: number
  readonly side: 'min' | 'max'
  readonly scale: number
  readonly read: (candidate: Candidate) => number | undefined
}

/** A bound the visitor has filled in, as the number it limits to. */
interface ActiveBound {
  readonly bound: Bound
  readonly limit: number
}

/** The limits this board can honour: those of the base figures and the measured quantities it
 *  offers, so a market without a figure has no dead field. A limit is named by its figure and its
 *  side (`turnover:min`). */
export function boardBounds(
  baseKeys: readonly BaseSortKey[],
  metrics: readonly MetricColumn[]
): readonly Bound[] {
  return [
    ...baseKeys.flatMap((key) =>
      boundsOf({
        figure: key,
        limit: BASE_LIMITS[key],
        read: (candidate) => baseFigureOf(candidate, key),
      })
    ),
    ...metrics.flatMap((column) =>
      boundsOf({
        figure: metricKey(column),
        limit: column.limit,
        sessions: column.sessions,
        read: (candidate) => metricOf(candidate, column),
      })
    ),
  ]
}

interface Figure {
  /** What names it in a limit's id. */
  readonly figure: string
  readonly limit: Limit | undefined
  readonly sessions?: number | undefined
  readonly read: Bound['read']
}

function boundsOf({ figure, limit, sessions, read }: Figure): readonly Bound[] {
  if (limit === undefined) {
    return []
  }

  return SIDES.flatMap((side): readonly Bound[] => {
    const label = limit[side]

    return label === undefined
      ? []
      : [
          {
            id: `${figure}:${side}`,
            label,
            ...(sessions === undefined ? {} : { sessions }),
            side,
            scale: limit.scale,
            read: limit.isBelow === true ? (candidate) => negated(read(candidate)) : read,
          },
        ]
  })
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

function negated(value: number | undefined): number | undefined {
  return value === undefined ? undefined : -value
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
