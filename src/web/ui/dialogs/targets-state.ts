import { type Signal, signal } from '@preact/signals'

import type { TradingProfileResponse } from '@/app/server/wire/trading'
import { isSegmentOn } from '@/web/state/profile'
import { toDecimal } from '@/web/text/decimal'

/** The share of the whole book that is cash, which no market owns. */
export const CASH_SEGMENT = 'cash'
const PERCENT = 100
const TENTHS = 10
// A total off by less than this is a rounding of the typed tenths, not a missing share.
const TOTAL_TOLERANCE = 0.05

/** One segment as the dialog edits it. A segment switched off at open stays off here: turning one
 *  on re-seeds every cap, which only the daemon's own command does. */
export interface TargetRow {
  readonly segment: string
  readonly wasOn: boolean
  /** No exchange holds the segment's market: it cannot be turned on at all. */
  readonly isLocked: boolean
  readonly on: Signal<boolean>
  readonly pct: Signal<string>
}

interface CapSet {
  readonly maximumPositionPctNav: number
  readonly maximumSegmentPctNav: number
}

interface ProfilePatch {
  readonly segmentTargets: Readonly<Record<string, number>>
  readonly caps?: Readonly<Record<string, CapSet>>
}

const SWITCHED_OFF: CapSet = { maximumPositionPctNav: 0, maximumSegmentPctNav: 0 }

/** The rows of a profile: its segments, then the cash that is left over. None is locked until the
 *  venues say which segments an exchange can hold. */
export function createTargetRows(profile: TradingProfileResponse): readonly TargetRow[] {
  const segments = Object.keys(profile.caps)

  return [...segments, CASH_SEGMENT].map((segment) => {
    const wasOn = isSegmentOn(profile, segment)

    return {
      segment,
      wasOn,
      isLocked: false,
      on: signal(wasOn),
      pct: signal(toPercentText(profile.segmentTargets[segment] ?? 0)),
    }
  })
}

/** The rows with the ones no exchange can hold locked; what was typed is kept. */
export function lockUnheld(
  rows: readonly TargetRow[],
  heldSegments: ReadonlySet<string>
): readonly TargetRow[] {
  return rows.map((row) => ({ ...row, isLocked: !(row.wasOn || heldSegments.has(row.segment)) }))
}

/** The shares of the rows that are on, in percent; absent while one is not a number. */
export function sumTargets(rows: readonly TargetRow[]): number | undefined {
  let total = 0

  for (const row of rows) {
    const share = row.on.value ? toDecimal(row.pct.value) : 0

    if (share === undefined) {
      return undefined
    }

    total += share
  }

  return Math.round(total * TENTHS) / TENTHS
}

export function isWhole(total: number | undefined): boolean {
  return total !== undefined && Math.abs(total - PERCENT) < TOTAL_TOLERANCE
}

/** The targets as fractions, and the caps when a segment was switched off here. */
export function buildTargetsPatch(
  profile: TradingProfileResponse,
  rows: readonly TargetRow[]
): ProfilePatch {
  const segmentTargets = Object.fromEntries(
    rows.map((row) => [row.segment, row.on.value ? shareOf(row) / PERCENT : 0])
  )
  const switchedOff = rows.filter((row) => row.wasOn && !row.on.value)

  if (switchedOff.length === 0) {
    return { segmentTargets }
  }

  const off = new Set(switchedOff.map((row) => row.segment))
  const caps = Object.fromEntries(
    Object.entries(profile.caps).map(([segment, cap]) => [
      segment,
      off.has(segment) ? SWITCHED_OFF : cap,
    ])
  )

  return { segmentTargets, caps }
}

/** The text the rows hold, to tell an edited dialog from an untouched one. */
export function snapshotTargets(rows: readonly TargetRow[]): string {
  return JSON.stringify(rows.map((row) => [row.on.value, row.pct.value]))
}

function shareOf(row: TargetRow): number {
  return toDecimal(row.pct.value) ?? 0
}

function toPercentText(fraction: number): string {
  return String(Math.round(fraction * PERCENT * TENTHS) / TENTHS)
}
