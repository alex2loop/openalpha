import { type Signal, signal } from '@preact/signals'

import type { TradingProfileResponse } from '@/app/server/wire/trading'
import { isSegmentOn } from '@/web/state/market'
import { toDecimal } from '@/web/text/decimal'

/** The share of the whole book that is cash, which no market owns. */
export const CASH_SEGMENT = 'cash'
const PERCENT = 100
// The input steps by a tenth of a percent, so a share is held, summed and sent in whole tenths:
// the total the dialog accepts is the one the daemon checks, with no rounding between.
const TENTHS = 10
const WHOLE_TENTHS = PERCENT * TENTHS

/** One segment as the dialog edits it. A segment switched on here is switched on by the daemon
 *  first, which re-seeds every cap as `/profile enable` does, and the typed targets are saved after. */
export interface TargetRow {
  readonly segment: string
  readonly wasOn: boolean
  /** No exchange holds the segment's market: it cannot be turned on at all. */
  readonly isLocked: boolean
  readonly on: Signal<boolean>
  readonly pct: Signal<string>
}

export interface CapSet {
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

/** The targets as fractions, and the caps when a segment was switched here: one switched off has
 *  none, one switched on takes the cap its enable seeded (`enabledCaps`), and the rest keep the caps
 *  they had at open, which the enable re-seeded. */
export function buildTargetsPatch(
  profile: TradingProfileResponse,
  rows: readonly TargetRow[],
  enabledCaps: Readonly<Record<string, CapSet>>
): ProfilePatch {
  const segmentTargets = Object.fromEntries(
    rows.map((row) => [row.segment, row.on.value ? (tenthsOf(row) ?? 0) / WHOLE_TENTHS : 0])
  )
  const off = new Set(rows.filter((row) => row.wasOn && !row.on.value).map((row) => row.segment))

  if (off.size === 0 && Object.keys(enabledCaps).length === 0) {
    return { segmentTargets }
  }

  const caps = Object.fromEntries(
    Object.entries(profile.caps).map(([segment, cap]) => [
      segment,
      off.has(segment) ? SWITCHED_OFF : (enabledCaps[segment] ?? cap),
    ])
  )

  return { segmentTargets, caps }
}

/** Puts `targets` (fractions) in the rows that are on, the cash included. */
export function fillTargets(
  rows: readonly TargetRow[],
  targets: Readonly<Record<string, number>>
): void {
  for (const row of rows) {
    if (row.on.value) {
      row.pct.value = toPercentText(targets[row.segment] ?? 0)
    }
  }
}

/** The segments off at open that the rows now switch on. */
export function switchedOnSegments(rows: readonly TargetRow[]): readonly string[] {
  return rows
    .filter((row) => !row.wasOn && row.on.value && row.segment !== CASH_SEGMENT)
    .map((row) => row.segment)
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
