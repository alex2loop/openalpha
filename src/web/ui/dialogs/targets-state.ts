import { type Signal, signal } from '@preact/signals'

import type { TradingProfileResponse } from '@/app/server/wire/trading'
import { isSegmentOn } from '@/web/state/profile'
import { toDecimal } from '@/web/text/decimal'

/** The share of the whole book that is cash, which no market owns. */
export const CASH_SEGMENT = 'cash'
const PERCENT = 100
// The input steps by a tenth of a percent, so a share is held, summed and sent in whole tenths:
// the total the dialog accepts is the one the daemon checks, with no rounding between.
const TENTHS = 10
const WHOLE_TENTHS = PERCENT * TENTHS

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

/** The shares of the rows that are on, in whole tenths of a percent; absent while one is not a
 *  number. */
export function sumTargets(rows: readonly TargetRow[]): number | undefined {
  let total = 0

  for (const row of rows) {
    const tenths = row.on.value ? tenthsOf(row) : 0

    if (tenths === undefined) {
      return undefined
    }

    total += tenths
  }

  return total
}

/** The total is exactly the whole book. */
export function isWhole(totalTenths: number | undefined): boolean {
  return totalTenths === WHOLE_TENTHS
}

/** A total in tenths as the percent the dialog prints. */
export function toPercent(totalTenths: number): number {
  return totalTenths / TENTHS
}

/** The targets as fractions, and the caps when a segment was switched off here. */
export function buildTargetsPatch(
  profile: TradingProfileResponse,
  rows: readonly TargetRow[]
): ProfilePatch {
  const segmentTargets = Object.fromEntries(
    rows.map((row) => [row.segment, row.on.value ? (tenthsOf(row) ?? 0) / WHOLE_TENTHS : 0])
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

function tenthsOf(row: TargetRow): number | undefined {
  const share = toDecimal(row.pct.value)

  return share === undefined ? undefined : Math.round(share * TENTHS)
}

function toPercentText(fraction: number): string {
  return String(Math.round(fraction * PERCENT * TENTHS) / TENTHS)
}
