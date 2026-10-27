import type { Logger } from '@/core/logging/logger'
import type { Region, TradingDay } from '@/trading/kernel/instrument'
import type { MacroSeriesId } from '@/trading/kernel/market/macro-series'
import type { MacroSnapshot } from '@/trading/kernel/market/market-data'
import type { SourceId } from '@/trading/kernel/source/source-id'
import type { RegisteredSource, Source, SourceResult } from '@/trading/kernel/source/source-result'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { MS_PER_DAY } from '@/core/utils/time'
import { MACRO_FORMULA_VERSION } from '@/trading/kernel/market/macro-series'
import { available } from '@/trading/kernel/source/source-result'
import { toRegisteredSource } from '@/trading/sources/define'
import { utcDayOf, utcDayStartEpochMs, yearOf } from '@/trading/sources/rows/normalization'

const MONTHS_PER_YEAR = 12
const MONTH_START = 5
const MONTH_END = 7
const DAY_START = 8

/** How often a provider can print something new. A daily source is bounded by the once-a-day gate
 *  alone; a monthly one also knows the release day, so it is not asked while no print can exist. */
type MacroCadence =
  | { readonly kind: 'daily' }
  | {
      readonly kind: 'monthly'
      /** The earliest day of the month (UTC) the previous period's print appears. */
      readonly releaseDay: number
      /** Months between the period a print describes and the month it is released in. */
      readonly lagMonths: number
    }

/** A daily series is not on the tape over a weekend plus a holiday, so a reading this old still
 *  describes the market. */
export const DAILY_STALE_AFTER_DAYS = 10

/** What a macro source declares about itself; everything else about the gate is shared. */
export interface MacroSourceProfile {
  readonly series: readonly MacroSeriesId[]
  readonly cadence: MacroCadence
  /** How old the newest observation may be before a stored reading stops standing in for a
   *  refused live one. */
  readonly staleAfterDays: number
}

interface StoredPoint {
  readonly day: TradingDay
  readonly value: number
  readonly fetchedAt: number
}

/** The slice of the market-data store the gate reads and writes, so the sources layer never imports
 *  the feature that owns the tables. */
export interface MacroReadStore {
  findLatestSeriesPoint(options: {
    readonly seriesId: string
    readonly signal: AbortSignal
  }): Promise<StoredPoint | null>
  upsertSeriesPoint(options: {
    readonly seriesId: string
    readonly day: TradingDay
    readonly value: number
    readonly replace: boolean
    readonly now: number
    readonly signal: AbortSignal
  }): Promise<boolean>
}

export interface MacroGateOptions {
  readonly profiles: Readonly<Partial<Record<SourceId, MacroSourceProfile>>>
  readonly store: MacroReadStore
  readonly logger: Logger
  readonly now: () => number
}

/** One source's profile and the gate's collaborators, bound once. */
interface Gate extends MacroGateOptions {
  readonly id: SourceId
  readonly profile: MacroSourceProfile
}

interface StoredRead {
  readonly values: Partial<Record<MacroSeriesId, number>>
  readonly observationDates: Partial<Record<MacroSeriesId, TradingDay>>
  readonly asOf: TradingDay
  /** The newest write across the source's series: one fetch writes them all. */
  readonly fetchedAt: number
}

/** Every macro read of a source with a profile goes through here: it is asked at most once a UTC
 *  day, not at all while no new print can exist, and a refused or failed read falls back to what the
 *  last good one stored. The quota behind the sources is shared by every process on the machine, so
 *  a boot or a refresh must never spend it on a figure already in hand. */
export function gateMacroSource(
  source: RegisteredSource,
  options: MacroGateOptions
): RegisteredSource {
  const profile = source.kind === 'macro' ? options.profiles[source.id] : undefined

  if (source.kind !== 'macro' || profile === undefined) {
    return source
  }

  return toRegisteredSource(gatedSource(source, { ...options, id: source.id, profile }))
}

function gatedSource(source: Source<'macro'>, gate: Gate): Source<'macro'> {
  return {
    ...source,
    async fetch(context, signal) {
      const { region } = context

      if (region === undefined) {
        return source.fetch(context, signal)
      }

      const stored = await readStored(gate, signal)
      const now = gate.now()

      if (stored !== undefined && isCurrent(stored, gate.profile.cadence, now)) {
        return cachedResult(gate.id, region, stored)
      }

      const live = await source.fetch(context, signal)

      if (live.kind === 'available') {
        await remember(gate, live.value, signal)

        return live
      }

      return stored !== undefined && canStandIn(stored, gate.profile, now)
        ? cachedResult(gate.id, region, stored)
        : live
    },
  }
}

// "Today" is the UTC day: providers publish on one clock and the quota meters on it, whatever
// timezone this machine keeps.
function isCurrent(stored: StoredRead, cadence: MacroCadence, now: number): boolean {
  const today = utcDayOf(now)

  return utcDayOf(stored.fetchedAt) === today || !newPrintPossible(stored.asOf, cadence, today)
}

/** Whether the period after the stored one can have been released by `today`. */
function newPrintPossible(observed: TradingDay, cadence: MacroCadence, today: TradingDay): boolean {
  if (cadence.kind === 'daily') {
    return true
  }

  const awaitingRelease = Number(today.slice(DAY_START)) < cadence.releaseDay ? 1 : 0
  const newestPeriod = monthIndex(today) - cadence.lagMonths - awaitingRelease

  return monthIndex(observed) < newestPeriod
}

function monthIndex(day: TradingDay): number {
  return yearOf(day) * MONTHS_PER_YEAR + Number(day.slice(MONTH_START, MONTH_END))
}

function canStandIn(stored: StoredRead, profile: MacroSourceProfile, now: number): boolean {
  return now - utcDayStartEpochMs(stored.asOf) <= profile.staleAfterDays * MS_PER_DAY
}

function cachedResult(
  id: SourceId,
  region: Region,
  stored: StoredRead
): SourceResult<MacroSnapshot> {
  return available(
    {
      region,
      asOf: stored.asOf,
      formulaVersion: MACRO_FORMULA_VERSION,
      values: stored.values,
      observationDates: stored.observationDates,
      sourceId: id,
      fetchedAt: stored.fetchedAt,
    },
    [
      {
        sourceId: id,
        fetchedAt: stored.fetchedAt,
        freshness: 'cached',
        observedAt: utcDayStartEpochMs(stored.asOf),
      },
    ]
  )
}

// One row per source and series: two providers publish the same series, and sharing a row would let
// one's fetch stand in for the other's.
function storedSeriesId(id: SourceId, series: MacroSeriesId): string {
  return `${id}:${series}`
}

async function readStored(gate: Gate, signal: AbortSignal): Promise<StoredRead | undefined> {
  try {
    const points = await Promise.all(
      gate.profile.series.map(
        async (series) =>
          [
            series,
            await gate.store.findLatestSeriesPoint({
              seriesId: storedSeriesId(gate.id, series),
              signal,
            }),
          ] as const
      )
    )

    return toStoredRead(points)
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    gate.logger.warn('trading.macro_read_unreadable', {
      sourceId: gate.id,
      err: formatErrForLog(err),
    })

    return undefined
  }
}

function toStoredRead(
  points: readonly (readonly [MacroSeriesId, StoredPoint | null])[]
): StoredRead | undefined {
  const values: Partial<Record<MacroSeriesId, number>> = {}
  const observationDates: Partial<Record<MacroSeriesId, TradingDay>> = {}
  let fetchedAt = 0

  for (const [series, point] of points) {
    if (point !== null) {
      values[series] = point.value
      observationDates[series] = point.day
      fetchedAt = Math.max(fetchedAt, point.fetchedAt)
    }
  }

  const days = Object.values(observationDates).sort()
  const asOf = days.at(-1)

  return asOf === undefined ? undefined : { values, observationDates, asOf, fetchedAt }
}

/** A failed write costs the next read its shortcut and nothing else, so it is logged and the live
 *  answer still goes out. */
async function remember(gate: Gate, snapshot: MacroSnapshot, signal: AbortSignal): Promise<void> {
  try {
    for (const series of gate.profile.series) {
      const value = snapshot.values[series]

      if (value !== undefined) {
        await gate.store.upsertSeriesPoint({
          seriesId: storedSeriesId(gate.id, series),
          day: snapshot.observationDates[series] ?? snapshot.asOf,
          value,
          replace: true,
          now: snapshot.fetchedAt,
          signal,
        })
      }
    }
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    gate.logger.warn('trading.macro_read_unsaved', { sourceId: gate.id, err: formatErrForLog(err) })
  }
}
