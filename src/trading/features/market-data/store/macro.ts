import { z } from 'zod'

import type { Region, TradingDay } from '@/trading/kernel/instrument'
import type { MacroSeriesId } from '@/trading/kernel/market/macro-series'
import type { MacroRiskSnapshot } from '@/trading/kernel/market/market-capability'
import type { MarketRegime } from '@/trading/kernel/market/market-data'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'
import { region as brandRegion, tradingDay } from '@/trading/kernel/instrument'
import { MACRO_SERIES_IDS } from '@/trading/kernel/market/macro-series'
import { MARKET_REGIMES } from '@/trading/kernel/market/market-data'
import {
  caveatsSchema,
  provenanceSchema,
  toMember,
  toProvenance,
} from '@/trading/kernel/store/store-payload'
import { parseJson } from '@/trading/kernel/store/store-row'

const MACRO_KEYS = ['region', 'day', 'formula_version']
const MACRO_COLS = ['created_at', 'regime', 'score_regime', 'payload']
/** How far back an observation lookup scans for a day that actually carries the series. Rows are
 *  per (day, version), so this is sessions only when one version is in play. */

// Partial by construction: a region covers a different subset of the series set, and a series with
// no reading carries no date either. Provenance and caveats travel with the values — the derived
// regime is only as good as the reads behind it.
const payloadSchema = z.strictObject({
  values: z.partialRecord(z.enum(MACRO_SERIES_IDS), z.number().finite()),
  observationDates: z.partialRecord(z.enum(MACRO_SERIES_IDS), z.string()),
  provenance: z.array(provenanceSchema),
  caveats: caveatsSchema,
})

interface MacroRow {
  readonly region: string
  readonly day: string
  readonly formula_version: string
  readonly created_at: number
  readonly regime: string
  readonly score_regime: string | null
  readonly payload: string
}

export interface MacroVersionOptions {
  readonly region: Region
  readonly formulaVersion: string
  readonly signal: AbortSignal
}

export interface ListMacroOptions extends MacroVersionOptions {
  readonly limit: number
}

export interface DeleteMacroOptions {
  readonly region: Region
  readonly beforeDay: TradingDay
  readonly limit: number
  readonly signal: AbortSignal
}

/** Re-running the same formula for a day already snapshotted refreshes that row; a new
 *  `formulaVersion` inserts a new one rather than rewriting the history a suggestion cited. */
export async function upsertMacroRisk(
  deps: StoreDeps,
  snapshot: MacroRiskSnapshot,
  signal: AbortSignal
): Promise<void> {
  assertNotAborted(signal)

  await deps.db.execute(
    deps.dialect.upsert('macro_snapshots', {
      keys: MACRO_KEYS,
      cols: MACRO_COLS,
      rowCount: 1,
    }),
    [
      snapshot.region,
      snapshot.asOf,
      snapshot.formulaVersion,
      snapshot.createdAt,
      snapshot.regime,
      snapshot.scoreRegime ?? null,
      JSON.stringify({
        values: snapshot.values,
        observationDates: snapshot.observationDates,
        provenance: snapshot.provenance,
        caveats: snapshot.caveats,
      }),
    ]
  )
}

/** Scoped to one formula version: a caller wants the current formula's most recent read, never a
 *  mix of versions. */
export async function findLatestMacroRisk(
  deps: StoreDeps,
  options: MacroVersionOptions
): Promise<MacroRiskSnapshot | null> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<MacroRow>(
    `SELECT * FROM macro_snapshots WHERE region = ${p(1)} AND formula_version = ${p(2)} ` +
      'ORDER BY day DESC LIMIT 1',
    [options.region, options.formulaVersion]
  )
  const row = rows[0]

  return row ? toMacroRiskSnapshot(row) : null
}

export interface MacroBeforeOptions extends MacroVersionOptions {
  readonly beforeDay: TradingDay
}

/** The newest rated read before a day. An unrated day stores no band, and skipping it keeps one
 *  outage from wiping the regime the day before it held. */
export async function findMacroRiskBefore(
  deps: StoreDeps,
  options: MacroBeforeOptions
): Promise<MacroRiskSnapshot | null> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<MacroRow>(
    `SELECT * FROM macro_snapshots WHERE region = ${p(1)} AND formula_version = ${p(2)} ` +
      `AND day < ${p(3)} AND score_regime IS NOT NULL ORDER BY day DESC LIMIT 1`,
    [options.region, options.formulaVersion, options.beforeDay]
  )
  const row = rows[0]

  return row ? toMacroRiskSnapshot(row) : null
}

export async function listRecentMacroRisk(
  deps: StoreDeps,
  options: ListMacroOptions
): Promise<readonly MacroRiskSnapshot[]> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<MacroRow>(
    `SELECT * FROM macro_snapshots WHERE region = ${p(1)} AND formula_version = ${p(2)} ` +
      `ORDER BY day DESC LIMIT ${p(3)}`,
    [options.region, options.formulaVersion, options.limit]
  )

  return rows.map(toMacroRiskSnapshot)
}

export async function deleteMacroRiskBefore(
  deps: StoreDeps,
  options: DeleteMacroOptions
): Promise<number> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const result = await deps.db.execute(
    'DELETE FROM macro_snapshots WHERE (region, day, formula_version) IN (' +
      'SELECT region, day, formula_version FROM macro_snapshots ' +
      `WHERE region = ${p(1)} AND day < ${p(2)} LIMIT ${p(3)})`,
    [options.region, options.beforeDay, options.limit]
  )

  return result.changes
}

function toMacroRiskSnapshot(row: MacroRow): MacroRiskSnapshot {
  const payload = parseJson(row.payload, 'macro risk snapshot', (value) =>
    payloadSchema.parse(value)
  )

  const observationDates: Partial<Record<MacroSeriesId, TradingDay>> = {}

  // why-safe: the payload schema keys this record by `MacroSeriesId`, so parsing has ruled out
  // every other key already.
  for (const [id, value] of Object.entries(payload.observationDates)) {
    observationDates[id as MacroSeriesId] = tradingDay(value)
  }

  return {
    region: brandRegion(row.region),
    asOf: tradingDay(row.day),
    createdAt: row.created_at,
    formulaVersion: row.formula_version,
    values: payload.values,
    observationDates,
    regime: toMember<MarketRegime>(row.regime, MARKET_REGIMES, 'market regime'),
    ...(row.score_regime === null
      ? {}
      : { scoreRegime: toMember<MarketRegime>(row.score_regime, MARKET_REGIMES, 'market regime') }),
    provenance: payload.provenance.map(toProvenance),
    caveats: payload.caveats,
  }
}
