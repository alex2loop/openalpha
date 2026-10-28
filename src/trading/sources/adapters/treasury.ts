// Source class: free, no key. The Treasury's own published curve — the authoritative print the
// keyed aggregators redistribute, and the only one that states the real yield directly.

import type { TradingDay } from '@/trading/kernel/instrument'
import type { MacroSnapshot } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { MacroSourceProfile } from '@/trading/sources/macro-gate'
import type { SourceFetchOutcome } from '@/trading/sources/types'
import { tradingDay } from '@/trading/kernel/instrument'
import { MACRO_FORMULA_VERSION } from '@/trading/kernel/market/macro-series'
import { sourceId } from '@/trading/kernel/source/source-id'
import { createSource, parsedSource } from '@/trading/sources/define'
import { DAILY_STALE_AFTER_DAYS } from '@/trading/sources/macro-gate'
import { utcDayStartEpochMs, yearOf } from '@/trading/sources/rows/normalization'
import { COMPLEMENTARY_ATTEMPT_LIMITS } from '@/trading/sources/transport/http'

const TREASURY_ID = sourceId('treasury')

export const TREASURY_DEFAULT_ENDPOINT = 'https://home.treasury.gov'

export const TREASURY_MACRO_PROFILE: MacroSourceProfile = {
  series: ['us-10y-yield', 'us-real-rate'],
  cadence: { kind: 'daily' },
  staleAfterDays: DAILY_STALE_AFTER_DAYS,
}

const CURVE_PATH = '/resource-center/data-chart-center/interest-rates/pages/xml'
const NOMINAL_CURVE = 'daily_treasury_yield_curve'
/** TIPS-derived, so the real rate is read rather than reconstructed from a nominal and a breakeven. */
const REAL_CURVE = 'daily_treasury_real_yield_curve'

const ENTRY_RE = /<m:properties>([\s\S]*?)<\/m:properties>/g
const DATE_RE = /<d:NEW_DATE[^>]*>(\d{4}-\d{2}-\d{2})/
const NOMINAL_10Y_RE = /<d:BC_10YEAR[^>]*>([^<]+)</
const REAL_10Y_RE = /<d:TC_10YEAR[^>]*>([^<]+)</

interface DatedRate {
  readonly at: TradingDay
  readonly rate: number
}

export function createTreasurySources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [macroSource(options)]
}

function macroSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: TREASURY_ID,
    kind: 'macro',
    http: options.http,
    covers: (context) => context.toDay !== undefined && context.region !== undefined,
    load: (context, signal) => fetchMacro(options, context, signal),
    observedAt: (value) => utcDayStartEpochMs(value.asOf),
  })
}

/** The nominal curve carries the required yield; a lost real curve costs its own driver, so it is
 *  read second and never fails the snapshot. */
async function fetchMacro(
  options: SourceAdapterOptions,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<MacroSnapshot>>> {
  const { toDay, region } = context

  if (toDay === undefined || region === undefined) {
    return { kind: 'error', code: 'source.unavailable' }
  }

  const year = yearOf(toDay)
  const nominal = await options.http.getText(curveRequest(NOMINAL_CURVE, year, signal))

  if (nominal.kind === 'error') {
    return nominal
  }

  const real = await options.http.getText(curveRequest(REAL_CURVE, year, signal))
  const realRate = real.kind === 'error' ? undefined : latestRate(real.value, REAL_10Y_RE)
  const yield10y = latestRate(nominal.value, NOMINAL_10Y_RE)

  if (yield10y === undefined) {
    return { kind: 'error', code: 'source.payload-rejected' }
  }

  return {
    ...nominal,
    value: parsedSource({
      region,
      asOf: yield10y.at,
      formulaVersion: MACRO_FORMULA_VERSION,
      values: {
        'us-10y-yield': yield10y.rate,
        ...(realRate === undefined ? {} : { 'us-real-rate': realRate.rate }),
      },
      observationDates: {
        'us-10y-yield': yield10y.at,
        ...(realRate === undefined ? {} : { 'us-real-rate': realRate.at }),
      },
      sourceId: TREASURY_ID,
      fetchedAt: nominal.fetchedAt,
    }),
  }
}

// The feed answers empty without a date scope. A year holds every session, so only the opening
// sessions of January have nothing to read; a month scope would repeat that gap twelve times.
function curveRequest(curve: string, year: number, signal: AbortSignal) {
  return {
    ...COMPLEMENTARY_ATTEMPT_LIMITS,
    sourceId: TREASURY_ID,
    path: CURVE_PATH,
    query: { data: curve, field_tdr_date_value: String(year) },
    signal,
  }
}

/** Entries run oldest first, so the last one carrying the field is the current print. A session
 *  that published no value for this maturity is skipped rather than read as a zero. */
function latestRate(xml: string, field: RegExp): DatedRate | undefined {
  const entries = xml.match(ENTRY_RE) ?? []

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] ?? ''
    const at = DATE_RE.exec(entry)?.[1]
    const raw = field.exec(entry)?.[1]

    if (at === undefined || raw === undefined) {
      continue
    }

    const rate = Number(raw)

    if (Number.isFinite(rate)) {
      return { at: tradingDay(at), rate }
    }
  }

  return undefined
}
