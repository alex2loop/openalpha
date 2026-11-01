// Source class: free, key optional. Keyless access is capped at 25 queries per day per IP, shared by
// every process behind that address; a registration key lifts it to 500. The macro gate asks at most
// once a day and not at all between releases, and exhausting the cap costs nothing the last stored
// print cannot cover.
import { z } from 'zod'

import type { CaveatCode } from '@/trading/kernel/caveat'
import type { Region } from '@/trading/kernel/instrument'
import type { MacroSnapshot } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { MacroSourceProfile } from '@/trading/sources/macro-gate'
import type { SourceFetchOutcome } from '@/trading/sources/types'
import { ValidationError } from '@/core/errors'
import { tradingDay } from '@/trading/kernel/instrument'
import { MACRO_FORMULA_VERSION } from '@/trading/kernel/market/macro-series'
import { sourceId } from '@/trading/kernel/source/source-id'
import { createSource, mapOutcome, parsedSource } from '@/trading/sources/define'
import { PERCENT_PER_UNIT, utcDayStartEpochMs, yearOf } from '@/trading/sources/rows/normalization'
import { COMPLEMENTARY_ATTEMPT_LIMITS } from '@/trading/sources/transport/http'

const BLS_ID = sourceId('bls')

export const BLS_DEFAULT_ENDPOINT = 'https://api.bls.gov'

/** CPI for All Urban Consumers, US city average, not seasonally adjusted — the headline index the
 *  year-over-year print is quoted from. */
const CPI_SERIES = 'CUUR0000SA0'
/** Two years back, never one: the release lags far enough that January's latest print is the prior
 *  December, whose year-ago comparison sits a further year out. */
const LOOKBACK_YEARS = 2
/** M13 is the annual average, which is not a month and would compare against nothing. */
const MONTH_RE = /^M(?:0[1-9]|1[0-2])$/
const SUCCESS_STATUS = 'REQUEST_SUCCEEDED'
/** A spent cap and a bad query both answer `REQUEST_NOT_PROCESSED`, so the prose is the only thing
 *  separating them, and they want different fixes from the operator. */
const THRESHOLD_PHRASE = 'threshold'
/** The v2 API's key parameter. Optional: without one the request goes out keyless. */
const KEY_PARAM = 'registrationkey'

/** The print for a month appears in the next one, from the 10th at the earliest (the schedule runs
 *  to the 15th). */
const CPI_RELEASE_DAY = 10
const CPI_RELEASE_LAG_MONTHS = 1
/** Past the longest gap between prints, shutdown delays included, a stored print is too old to
 *  stand in for the current one. */
const CPI_STALE_AFTER_DAYS = 120

export const BLS_MACRO_PROFILE: MacroSourceProfile = {
  series: ['us-inflation-yoy'],
  cadence: { kind: 'monthly', releaseDay: CPI_RELEASE_DAY, lagMonths: CPI_RELEASE_LAG_MONTHS },
  staleAfterDays: CPI_STALE_AFTER_DAYS,
}

const RESPONSE = z.object({
  status: z.string(),
  message: z.array(z.string()).optional(),
  // `Results` is `{}` on a refusal, so `series` cannot be required: demanding it rejects the body
  // before the status below can say why the provider declined.
  Results: z
    .object({
      series: z
        .array(
          z.object({
            data: z.array(z.object({ year: z.string(), period: z.string(), value: z.string() })),
          })
        )
        .optional(),
    })
    .optional(),
})

interface Observation {
  readonly year: number
  readonly period: string
  readonly index: number
}

export function createBlsSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [macroSource(options)]
}

function macroSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: BLS_ID,
    kind: 'macro',
    http: options.http,
    covers: (context) => context.toDay !== undefined && context.region !== undefined,
    load: (context, signal) => loadMacro(options, context, signal),
    observedAt: (value) => utcDayStartEpochMs(value.asOf),
  })
}

async function loadMacro(
  options: SourceAdapterOptions,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<MacroSnapshot>>> {
  const { toDay, region } = context

  if (toDay === undefined || region === undefined) {
    return { kind: 'error', code: 'source.unavailable' }
  }

  const year = yearOf(toDay)
  const outcome = await options.http.getJson(
    {
      ...COMPLEMENTARY_ATTEMPT_LIMITS,
      sourceId: BLS_ID,
      path: `/publicAPI/v2/timeseries/data/${CPI_SERIES}`,
      query: { startyear: String(year - LOOKBACK_YEARS), endyear: String(year) },
      credential: { kind: 'query', name: KEY_PARAM, optional: true },
      signal,
    },
    (raw) => RESPONSE.parse(raw)
  )

  if (outcome.kind !== 'ok') {
    return outcome
  }

  // A refusal answers 200 with a status, so the body decides the outcome.
  if (outcome.value.status !== SUCCESS_STATUS) {
    return { kind: 'error', code: refusalCode(outcome.value) }
  }

  return mapOutcome(outcome, (payload, fetchedAt) => toMacroSnapshot(payload, region, fetchedAt))
}

function refusalCode(payload: z.infer<typeof RESPONSE>): CaveatCode {
  const threshold = payload.message?.some((line) => line.toLowerCase().includes(THRESHOLD_PHRASE))

  return threshold === true ? 'source.quota-exhausted' : 'source.unavailable'
}

function toMacroSnapshot(
  payload: z.infer<typeof RESPONSE>,
  region: Region,
  fetchedAt: number
): ParsedSource<MacroSnapshot> {
  const observations = toObservations(payload)
  const latest = observations[0]
  const yearAgo = observations.find(
    (entry) => entry.year === (latest?.year ?? 0) - 1 && entry.period === latest?.period
  )

  if (latest === undefined || yearAgo === undefined || yearAgo.index === 0) {
    throw new ValidationError('bls cpi has no year-over-year pair')
  }

  return parsedSource({
    region,
    asOf: tradingDay(`${latest.year}-${latest.period.slice(1)}-01`),
    formulaVersion: MACRO_FORMULA_VERSION,
    values: { 'us-inflation-yoy': (latest.index / yearAgo.index - 1) * PERCENT_PER_UNIT },
    observationDates: {
      'us-inflation-yoy': tradingDay(`${latest.year}-${latest.period.slice(1)}-01`),
    },
    sourceId: BLS_ID,
    fetchedAt,
  })
}

/** Newest first, as the API returns them. A period the release has not filled carries a placeholder
 *  rather than a number, and drops here. */
function toObservations(payload: z.infer<typeof RESPONSE>): readonly Observation[] {
  const rows = payload.Results?.series?.[0]?.data ?? []
  const observations: Observation[] = []

  for (const row of rows) {
    const index = Number(row.value)
    const year = Number(row.year)

    if (MONTH_RE.test(row.period) && Number.isFinite(index) && Number.isInteger(year)) {
      observations.push({ year, period: row.period, index })
    }
  }

  return observations
}
