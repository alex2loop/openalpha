import { z } from 'zod'

import type { Caveat } from '@/trading/kernel/caveat'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { MacroSeriesId } from '@/trading/kernel/market/macro-series'
import type { MacroSnapshot } from '@/trading/kernel/market/market-data'
import type { MacroMissingReason } from '@/trading/kernel/market/market-macro'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { SourceFetchOutcome } from '@/trading/sources/types'
import { ValidationError } from '@/core/errors'
import { tradingDay } from '@/trading/kernel/instrument'
import { MACRO_FORMULA_VERSION } from '@/trading/kernel/market/macro-series'
import { sourceId } from '@/trading/kernel/source/source-id'
import { createSource, parsedSource } from '@/trading/sources/define'
import { finite } from '@/trading/sources/rows/normalization'
import { COMPLEMENTARY_ATTEMPT_LIMITS } from '@/trading/sources/transport/http'

const FRED_ID = sourceId('fred')
const OBSERVATION_LIMIT = 10
const US_TEN_YEAR_SERIES = 'DGS10'
const US_BREAKEVEN_SERIES = 'T10YIE'
/** Trade-weighted broad index on a Jan-2006=100 base, not DXY. `DRIVER_BANDS['usd-index']` is
 *  calibrated to this series; swapping either without the other pegs the driver at an extreme. */
const US_DOLLAR_INDEX_SERIES = 'DTWEXBGS'
/** Unadjusted, because `bls` serves this driver first from `CUUR0000SA0` and a fallback that reads
 *  the seasonally adjusted `CPIAUCSL` would store a different definition under one series id. The
 *  adjusted series is also revised years back at each reseasonalisation, so a stored history mixing
 *  the two is not a history. */
const US_INFLATION_SERIES = 'CPIAUCNS'
/** Cboe's 30-day implied volatility on S&P 500 options. The one driver that is not a rate or a
 *  level the cycle can pin at one end of its band: it mean-reverts, so it reads risk appetite
 *  rather than the stance of policy. */
const US_VOLATILITY_SERIES = 'VIXCLS'
/** FRED's year-over-year transform, so the level series arrives on its band's scale. */
const YEAR_OVER_YEAR_UNITS = 'pc1'
const MISSING_OBSERVATION = '.'

/** A sustained optional-series outage stops being "today happened to be empty" and becomes "the
 *  pipe is sick"; the caveat flips on after this many consecutive empty reads. */
const OPTIONAL_DEGRADE_AFTER = 3

export const FRED_DEFAULT_ENDPOINT = 'https://api.stlouisfed.org'

const OBSERVATIONS = z.object({
  observations: z.array(z.object({ date: z.string().min(1), value: z.string() })),
})

type FredObservations = z.infer<typeof OBSERVATIONS>

interface OptionalSpec {
  readonly seriesId: string
  readonly units?: string
}

/** A series the source can hold on a calendar but refuse to answer today — both flavours matter for
 *  the composite's missing reason. */
const OPTIONAL_SERIES: Readonly<Partial<Record<MacroSeriesId, OptionalSpec>>> = Object.freeze({
  'usd-index': { seriesId: US_DOLLAR_INDEX_SERIES },
  'us-inflation-yoy': { seriesId: US_INFLATION_SERIES, units: YEAR_OVER_YEAR_UNITS },
  'us-volatility': { seriesId: US_VOLATILITY_SERIES },
})

interface OptionalPresent {
  readonly kind: 'present'
  readonly value: number
  readonly date: TradingDay
  readonly fetchedAt: number
}

interface OptionalEmpty {
  readonly kind: 'empty'
  readonly reason: MacroMissingReason
  /** FRED's last published date for this series when one exists, so the renderer can say
   *  "FRED last published X" rather than "no reading today". */
  readonly lastObservationAt?: TradingDay
}

type OptionalReading = OptionalPresent | OptionalEmpty

type OptionalReadings = Readonly<Partial<Record<MacroSeriesId, OptionalReading>>>

/** Per-process failure streak per optional series, so the same source can name the *kind* of
 *  absence it just produced (`no-observation` vs `fetch-error`) and the composite can decide
 *  whether to flag a sustained outage. Module-scope is right here: the streak survives every
 *  fetch, lives as long as the daemon does, and is reset by any successful read of that series. */
const optionalFailureStreaks: Map<MacroSeriesId, number> = new Map()

interface SeriesRequest {
  readonly seriesId: string
  readonly signal: AbortSignal
  readonly units?: string
}

export function createFredSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [macroSource(options)]
}

function macroSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: FRED_ID,
    kind: 'macro',
    http: options.http,
    covers: () => true,
    load: (context, signal) => fetchMacro(options, context, signal),
  })
}

/** Every series at once, and each one's absence is its own fact: a provider that cannot answer the
 *  curve today still publishes the dollar, and reading them in turn let one failure take the other
 *  three with it - silently, since the degrade caveat lives past the read that never ran. */
async function fetchMacro(
  options: SourceAdapterOptions,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<MacroSnapshot>>> {
  const [nominal, breakeven, optionalReadings] = await Promise.all([
    fetchSeries(options, { seriesId: US_TEN_YEAR_SERIES, signal }),
    fetchSeries(options, { seriesId: US_BREAKEVEN_SERIES, signal }),
    readOptionals(options, signal),
  ])
  const snapshot = toMacroSnapshot({ nominal, breakeven, optionalReadings, context })

  if (snapshot === null) {
    return nominal.kind === 'error' ? nominal : { kind: 'error', code: 'source.empty-window' }
  }

  return {
    kind: 'ok',
    value: parsedSource(snapshot.value, snapshot.caveats),
    fetchedAt: snapshot.value.fetchedAt,
  }
}

/** Together, not in turn: these series share no data and one slow print used to hold up the next. */
async function readOptionals(
  options: SourceAdapterOptions,
  signal: AbortSignal
): Promise<OptionalReadings> {
  const entries = await Promise.all(
    Object.entries(OPTIONAL_SERIES).map(
      async ([id, spec]) => [id, await readOptional(options, spec, signal)] as const
    )
  )

  return Object.fromEntries(entries)
}

async function readOptional(
  options: SourceAdapterOptions,
  spec: OptionalSpec,
  signal: AbortSignal
): Promise<OptionalReading> {
  const macroSeriesId = seriesIdOf(spec.seriesId)
  const outcome = await fetchSeries(options, {
    seriesId: spec.seriesId,
    signal,
    ...(spec.units === undefined ? {} : { units: spec.units }),
  })

  if (outcome.kind === 'error') {
    bumpStreak(macroSeriesId)

    return { kind: 'empty', reason: 'fetch-error' }
  }

  const observation = firstUsableObservation(outcome.value)
  const lastObservationAt = latestKnownObservation(outcome.value)

  if (observation === undefined) {
    bumpStreak(macroSeriesId)

    return lastObservationAt === undefined
      ? { kind: 'empty', reason: 'no-observation' }
      : { kind: 'empty', reason: 'observation-only', lastObservationAt }
  }

  resetStreak(macroSeriesId)

  return {
    kind: 'present',
    value: observation.value,
    date: tradingDay(observation.date),
    fetchedAt: outcome.fetchedAt,
  }
}

function firstUsableObservation(
  payload: FredObservations
): { readonly date: string; readonly value: number } | undefined {
  for (const observation of payload.observations) {
    const value = Number(observation.value)

    if (observation.value !== MISSING_OBSERVATION && Number.isFinite(value)) {
      return { date: observation.date, value }
    }
  }

  return undefined
}

function latestKnownObservation(payload: FredObservations): TradingDay | undefined {
  for (const observation of payload.observations) {
    if (observation.value === MISSING_OBSERVATION) {
      continue
    }

    const value = Number(observation.value)

    if (Number.isFinite(value)) {
      return tradingDay(observation.date)
    }
  }

  return undefined
}

function seriesIdOf(seriesId: string): MacroSeriesId {
  for (const [id, spec] of Object.entries(OPTIONAL_SERIES)) {
    if (spec.seriesId === seriesId) {
      // why-safe: the keys of `OPTIONAL_SERIES` are `MacroSeriesId` by its own declared type.
      return id as MacroSeriesId
    }
  }

  throw new ValidationError(`fred adapter does not recognise optional series ${seriesId}`)
}

function bumpStreak(id: MacroSeriesId): void {
  optionalFailureStreaks.set(id, (optionalFailureStreaks.get(id) ?? 0) + 1)
}

function resetStreak(id: MacroSeriesId): void {
  optionalFailureStreaks.delete(id)
}

function streak(id: MacroSeriesId): number {
  return optionalFailureStreaks.get(id) ?? 0
}

function fetchSeries(
  options: SourceAdapterOptions,
  request: SeriesRequest
): Promise<SourceFetchOutcome<FredObservations>> {
  return options.http.getJson(seriesRequest(request), (raw) => OBSERVATIONS.parse(raw))
}

function seriesRequest(request: SeriesRequest) {
  return {
    ...COMPLEMENTARY_ATTEMPT_LIMITS,
    sourceId: FRED_ID,
    path: '/fred/series/observations',
    query: {
      series_id: request.seriesId,
      file_type: 'json',
      sort_order: 'desc',
      limit: String(OBSERVATION_LIMIT),
      ...(request.units === undefined ? {} : { units: request.units }),
    },
    credential: { kind: 'query' as const, name: 'api_key' },
    signal: request.signal,
  }
}

interface MacroSnapshotInput {
  readonly nominal: SourceFetchOutcome<FredObservations>
  readonly breakeven: SourceFetchOutcome<FredObservations>
  readonly optionalReadings: OptionalReadings
  readonly context: SourceContext
}

interface BuiltSnapshot {
  readonly value: MacroSnapshot
  readonly caveats: readonly Caveat[]
}

/** `null` when no series answered: there is nothing to publish, and an empty snapshot would read as
 *  a provider that looked and found the whole US tape absent. */
function toMacroSnapshot(input: MacroSnapshotInput): BuiltSnapshot | null {
  if (input.context.region === undefined) {
    throw new ValidationError('fred macro request has no region')
  }

  const values: Partial<Record<MacroSeriesId, number>> = {}
  const observationDates: Partial<Record<MacroSeriesId, TradingDay>> = {}
  const yieldToday = latestObservation(input.nominal)

  if (yieldToday !== undefined) {
    values['us-10y-yield'] = yieldToday.value
    observationDates['us-10y-yield'] = tradingDay(yieldToday.date)
  }

  // The real rate is the one reading built from two series, so it needs them on the same session;
  // the nominal yield stands on its own and is published even when the breakeven did not print.
  const aligned = alignedObservation(input.nominal, input.breakeven)

  if (aligned !== undefined) {
    values['us-real-rate'] = aligned.nominal - aligned.breakeven
    observationDates['us-real-rate'] = tradingDay(aligned.date)
  }

  // why-safe: `optionalReadings` is built from `OPTIONAL_SERIES`, so its keys are that same set.
  for (const [id, reading] of Object.entries(input.optionalReadings)) {
    if (reading === undefined || reading.kind !== 'present') {
      continue
    }

    values[id as MacroSeriesId] = reading.value
    observationDates[id as MacroSeriesId] = reading.date
  }

  const asOf = newestDay(observationDates)

  if (asOf === undefined) {
    return null
  }

  return {
    value: {
      region: input.context.region,
      asOf,
      formulaVersion: MACRO_FORMULA_VERSION,
      values,
      observationDates,
      sourceId: FRED_ID,
      fetchedAt: newestFetch(input),
    },
    caveats: degradedCaveats(),
  }
}

function degradedCaveats(): readonly Caveat[] {
  return (Object.keys(OPTIONAL_SERIES) as MacroSeriesId[])
    .filter((id) => streak(id) >= OPTIONAL_DEGRADE_AFTER)
    .map((id) => ({ code: 'macro.optional-source-degraded', detail: { series: id } }))
}

/** The snapshot is stamped by the freshest read behind it, optional series included; a failed leg
 *  contributes no instant. */
function newestFetch(input: MacroSnapshotInput): number {
  const stamps = [input.nominal, input.breakeven].flatMap((outcome) =>
    outcome.kind === 'ok' ? [outcome.fetchedAt] : []
  )

  for (const reading of Object.values(input.optionalReadings)) {
    if (reading?.kind === 'present') {
      stamps.push(reading.fetchedAt)
    }
  }

  return stamps.length === 0 ? 0 : Math.max(...stamps)
}

function newestDay(
  dates: Readonly<Partial<Record<MacroSeriesId, TradingDay>>>
): TradingDay | undefined {
  const days = Object.values(dates).filter((day) => day !== undefined)

  return days.length === 0 ? undefined : days.reduce((newest, day) => (day > newest ? day : newest))
}

function latestObservation(
  outcome: SourceFetchOutcome<FredObservations>
): { readonly date: string; readonly value: number } | undefined {
  return outcome.kind === 'ok' ? firstUsableObservation(outcome.value) : undefined
}

interface AlignedObservation {
  readonly date: string
  readonly nominal: number
  readonly breakeven: number
}

/** The newest session both series printed. `undefined` is a window with no overlap, which is a
 *  reading neither series took - not a payload this adapter failed to understand. */
function alignedObservation(
  nominal: SourceFetchOutcome<FredObservations>,
  breakeven: SourceFetchOutcome<FredObservations>
): AlignedObservation | undefined {
  if (nominal.kind === 'error' || breakeven.kind === 'error') {
    return undefined
  }

  const breakevenByDate = observationValues(breakeven.value, US_BREAKEVEN_SERIES)

  for (const observation of nominal.value.observations) {
    const breakevenValue =
      observation.value === MISSING_OBSERVATION ? undefined : breakevenByDate.get(observation.date)

    if (breakevenValue !== undefined) {
      return {
        date: observation.date,
        nominal: finite(Number(observation.value), US_TEN_YEAR_SERIES),
        breakeven: breakevenValue,
      }
    }
  }

  return undefined
}

function observationValues(payload: FredObservations, label: string): ReadonlyMap<string, number> {
  const values = new Map<string, number>()

  for (const observation of payload.observations) {
    if (observation.value !== MISSING_OBSERVATION) {
      values.set(observation.date, finite(Number(observation.value), label))
    }
  }

  return values
}
