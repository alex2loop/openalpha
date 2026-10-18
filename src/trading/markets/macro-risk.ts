import type { Caveat } from '@/trading/kernel/caveat'
import type { FactorNormalization } from '@/trading/kernel/factor'
import type { PortfolioSegment, Region, TradingDay } from '@/trading/kernel/instrument'
import type { MacroSeriesId } from '@/trading/kernel/market/macro-series'
import type { MarketRegime, RegimeScale } from '@/trading/kernel/market/market-data'
import type {
  MacroMissingReason,
  MacroRiskDriver,
  MacroRiskView,
  MacroUnit,
  MissingMacroDriver,
} from '@/trading/kernel/market/market-macro'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'
import { MACRO_FORMULA_VERSION, MACRO_SERIES_IDS } from '@/trading/kernel/market/macro-series'
import { normalizeFactor, SCORE_LIMIT } from '@/trading/markets/factor-scoring'

/** A macro driver is always banded linearly: a series is read against anchors quoted in its own
 *  units, never ranked against a population the way a cross-sectional factor is — and a published
 *  driver states both anchors and nothing else, so neither may hide a third. */
type MacroDriverBand = Omit<Extract<FactorNormalization, { readonly kind: 'linear' }>, 'neutralAt'>

/** One composite formula, several driver tables: which series vote, how each is banded, and in what
 *  unit it is read. A market that publishes its own regime declares one of these rather than
 *  reimplementing the fold, so every surface renders it with the same rows and sums. */
export interface MacroDriverPolicy {
  readonly weights: Readonly<Partial<Record<MacroSeriesId, number>>>
  readonly bands: Readonly<Partial<Record<MacroSeriesId, MacroDriverBand>>>
  readonly units: Readonly<Partial<Record<MacroSeriesId, MacroUnit>>>
}

/** How each US series is read, shared by every driver table that weighs one so a US reading is
 *  banded the same wherever it votes. Each is signed through its band ordering: a rising real rate,
 *  yield, dollar, inflation print or volatility index is risk-off, so no consumer has to remember
 *  which way DXY points. */
export const US_DRIVER_BANDS = Object.freeze({
  'us-real-rate': { kind: 'linear', bearishAt: 3, bullishAt: 0 },
  'us-10y-yield': { kind: 'linear', bearishAt: 5, bullishAt: 2 },
  // Banded against DTWEXBGS (Jan-2006=100), not DXY — see `US_DOLLAR_INDEX_SERIES`.
  'usd-index': { kind: 'linear', bearishAt: 128, bullishAt: 112 },
  'us-inflation-yoy': { kind: 'linear', bearishAt: 6, bullishAt: 2 },
  // The conventional calm and stress readings of VIX, which is quoted as a level and banded here
  // as one; the series long-runs between them rather than trending through either.
  'us-volatility': { kind: 'linear', bearishAt: 30, bullishAt: 15 },
} as const satisfies Partial<Record<MacroSeriesId, MacroDriverBand>>)

// Chosen weights and thresholds; no backtest justifies these over a neighbouring set. Stated once
// so the composite does not read as better-founded than an equal-weight guess with decimals. Weights
// are relative and the fold divides by the fired total, so a driver is added without restating the
// rest.
export const US_MACRO_DRIVERS: MacroDriverPolicy = Object.freeze({
  weights: Object.freeze({
    'us-real-rate': 0.35,
    'us-10y-yield': 0.25,
    'usd-index': 0.2,
    'us-inflation-yoy': 0.2,
    // The only driver here that prices what the market expects rather than what policy has already
    // done, and the lightest for it: a spike says stress is arriving, not that the stance changed.
    'us-volatility': 0.15,
  }),
  bands: US_DRIVER_BANDS,
  units: Object.freeze({
    'us-real-rate': 'percent',
    'us-10y-yield': 'percent',
    'usd-index': 'level',
    'us-inflation-yoy': 'percent',
    'us-volatility': 'level',
  }),
})

/** The ids a policy actually weights, in the kernel tuple's order so two markets publishing the
 *  same series list them the same way. */
function driverIdsOf(policy: MacroDriverPolicy): readonly MacroSeriesId[] {
  return MACRO_SERIES_IDS.filter((id) => policy.weights[id] !== undefined)
}

function totalWeightOf(policy: MacroDriverPolicy): number {
  return driverIdsOf(policy).reduce((sum, id) => sum + (policy.weights[id] ?? 0), 0)
}

export const RISK_ON_AT = 0.25
export const RISK_OFF_AT = -0.25

/** The composite's scale and the two cuts that name its regimes, for a surface that draws the lean. */
export const MACRO_SCORE_RANGE = Object.freeze({
  min: -SCORE_LIMIT,
  max: SCORE_LIMIT,
  riskOffAt: RISK_OFF_AT,
  riskOnAt: RISK_ON_AT,
})
const MINIMUM_DRIVER_COVERAGE_FRACTION = 0.6
/** A regime is entered at its threshold and left only this far back inside it, so a score hovering
 *  on the line does not move deployment every day. */
const REGIME_EXIT_MARGIN = 0.1

/** Absent macro is not neutral. A missing read is an unknown regime, and the conservative reading
 *  of an unknown regime is the defensive one — otherwise a source outage licenses full deployment. */
export const ABSENT_REGIME: MarketRegime = 'risk-off'

/** The scale only ever reduces: `risk-on` is 1, not 1.2. A bullish macro read returns the operator
 *  to their own policy ceiling, never above it. Consumers apply
 *  `min(REGIME_SCALE[regime], profile.regimeScale, 1)`. */
export const REGIME_SCALE: Readonly<Record<MarketRegime, number>> = Object.freeze({
  'risk-on': 1,
  neutral: 0.85,
  'risk-off': 0.6,
})

/** The scale at which macro caps nothing. Read off the table rather than written again, because the
 *  table is what makes it the ceiling. */
export const FULL_DEPLOYMENT_SCALE = REGIME_SCALE['risk-on']

/** A segment whose own market published no regime is read defensively, for the reason `ABSENT_REGIME`
 *  states: an unresolved read must not license deployment. */
export function regimeFor(
  regimes: ReadonlyMap<PortfolioSegment, RegimeScale>,
  segment: PortfolioSegment
): RegimeScale {
  return (
    regimes.get(segment) ?? {
      regime: ABSENT_REGIME,
      rated: false,
      scale: REGIME_SCALE[ABSENT_REGIME],
      caveats: [],
    }
  )
}

interface MacroRiskInput {
  readonly values: Readonly<Partial<Record<MacroSeriesId, number>>>
  /** The day each series was observed on, parallel to `values`. Absent where the provider did not
   *  stamp a date; the driver then falls back to the composite's `asOf`. */
  readonly observationDates: Readonly<Partial<Record<MacroSeriesId, TradingDay>>>
  /** Per-series missing reason when the source could not be asked or refused to answer; absent
   *  entries default to `'no-observation'`. Only the series in `values` are read. */
  readonly missingReasons?: Readonly<Partial<Record<MacroSeriesId, MacroMissingReason>>>
  /** FRED's last published date for each series that returned nothing today; the renderer uses it
   *  to say "FRED last published X" rather than "no reading today". */
  readonly lastObservationAt?: Readonly<Partial<Record<MacroSeriesId, TradingDay>>>
  readonly region: Region
  readonly asOf: TradingDay
  readonly provenance: readonly SourceProvenance[]
  /** The score's band on the market's last rated read. Absent for a market that stores none. */
  readonly previousScoreRegime?: MarketRegime
}

export function deriveMacroRisk(input: MacroRiskInput, policy: MacroDriverPolicy): MacroRiskView {
  const { drivers, missing } = driversFrom(input, policy)
  const shared = {
    region: input.region,
    asOf: input.asOf,
    formulaVersion: MACRO_FORMULA_VERSION,
    missing,
    provenance: input.provenance,
  }

  if (drivers.length === 0) {
    return {
      ...shared,
      regime: ABSENT_REGIME,
      scoreRegime: ABSENT_REGIME,
      score: 0,
      coverage: 0,
      drivers: [],
      caveats: [{ code: 'macro.inputs-missing' }],
    }
  }

  // Renormalized over fired weight, the same rule `scoreFactors` uses: partial coverage is reported
  // through the missing list rather than dragging the score toward neutral. The internal fold keeps
  // the declared weights, because coverage and its caveat are measured against the whole model.
  const firedWeight = drivers.reduce((sum, driver) => sum + driver.weight, 0)
  const score = drivers.reduce((sum, driver) => sum + driver.contribution, 0) / firedWeight
  const coverage = firedWeight / totalWeightOf(policy)
  const scoreRegime = resolveRegime(score, input.previousScoreRegime)
  const rated = isRegimeRated({ coverage })
  // Under the floor the published regime is the default, not the held one, so saying it was held
  // would contradict the coverage caveat beside it.
  const held = rated && scoreRegime !== resolveRegime(score, undefined)

  return {
    ...shared,
    // Under the floor the composite may not license deployment, for the reason `ABSENT_REGIME`
    // states. The score keeps what it read, so a reader sees both.
    regime: rated ? scoreRegime : ABSENT_REGIME,
    scoreRegime,
    score,
    coverage,
    drivers: publishedDrivers(drivers, firedWeight),
    caveats: [
      ...coverageCaveats(drivers, firedWeight, policy),
      ...(held ? [{ code: 'macro.regime-held' as const }] : []),
    ],
  }
}

/** Whether the drivers that voted are enough to rate the regime. Under the floor the published
 *  regime is `ABSENT_REGIME`, a default rather than a reading. */
export function isRegimeRated(view: Pick<MacroRiskView, 'coverage'>): boolean {
  return view.coverage >= MINIMUM_DRIVER_COVERAGE_FRACTION
}

/** What a reader can add up: a weight that is this driver's share of the vote cast, and a
 *  contribution that is its share of the composite. Anything else prints three numbers that do not
 *  sum to the fourth beside them. */
function publishedDrivers(
  drivers: readonly MacroRiskDriver[],
  firedWeight: number
): readonly MacroRiskDriver[] {
  return drivers.map((driver) => ({
    ...driver,
    weight: driver.weight / firedWeight,
    contribution: driver.contribution / firedWeight,
  }))
}

interface ScoredDrivers {
  readonly drivers: readonly MacroRiskDriver[]
  readonly missing: readonly MissingMacroDriver[]
}

function driversFrom(input: MacroRiskInput, policy: MacroDriverPolicy): ScoredDrivers {
  const drivers: MacroRiskDriver[] = []
  const missing: MissingMacroDriver[] = []
  const observationDates = input.observationDates
  const missingReasons = input.missingReasons ?? {}
  const lastObservationAt = input.lastObservationAt ?? {}

  for (const id of driverIdsOf(policy)) {
    const value = input.values[id]
    const weight = policy.weights[id]
    const band = policy.bands[id]
    const unit = policy.units[id]

    // A policy naming a weight without a band or a unit is a table mistake, not a missing reading.
    // Reported as a driver that did not vote so the composite still renders rather than throwing.
    if (
      value === undefined ||
      !Number.isFinite(value) ||
      weight === undefined ||
      band === undefined ||
      unit === undefined
    ) {
      const lastObserved = lastObservationAt[id]
      const reason = missingReasons[id] ?? 'no-observation'

      missing.push({
        id,
        reason,
        ...(lastObserved === undefined ? {} : { lastObservationAt: lastObserved }),
      })

      continue
    }

    drivers.push({
      id,
      unit,
      value,
      weight,
      bearishAt: band.bearishAt,
      bullishAt: band.bullishAt,
      contribution: weight * normalizeFactor(value, band),
      asOf: observationDates[id] ?? input.asOf,
    })
  }

  return { drivers, missing }
}

function resolveRegime(score: number, previous: MarketRegime | undefined): MarketRegime {
  if (previous === 'risk-on' && score > RISK_ON_AT - REGIME_EXIT_MARGIN) {
    return 'risk-on'
  }

  if (previous === 'risk-off' && score < RISK_OFF_AT + REGIME_EXIT_MARGIN) {
    return 'risk-off'
  }

  if (score >= RISK_ON_AT) {
    return 'risk-on'
  }

  return score <= RISK_OFF_AT ? 'risk-off' : 'neutral'
}

/** A view's drivers carry the observation date each was scored against; collapsing them into a
 *  per-id map is what a durable snapshot stores so the brief re-derives without losing the stamp. */
export function driverObservationDates(
  drivers: readonly { readonly id: MacroSeriesId; readonly asOf: TradingDay }[]
): Readonly<Partial<Record<MacroSeriesId, TradingDay>>> {
  const dates: Partial<Record<MacroSeriesId, TradingDay>> = {}

  for (const driver of drivers) {
    dates[driver.id] = driver.asOf
  }

  return dates
}

/** Under the floor the regime is the defensive default rather than what the score read, which the
 *  missing list alone does not say. Over it, only the read one outage away is worth a caveat: its
 *  next lost driver turns the regime defensive, and nothing else says so. The smallest fired weight
 *  is the binding case, since losing a heavier one drops further. */
function coverageCaveats(
  drivers: readonly MacroRiskDriver[],
  firedWeight: number,
  policy: MacroDriverPolicy
): readonly Caveat[] {
  const total = totalWeightOf(policy)
  const coverage = firedWeight / total

  if (!isRegimeRated({ coverage })) {
    return [{ code: 'macro.coverage-below-floor', detail: { coverage } }]
  }

  const smallest = Math.min(...drivers.map((driver) => driver.weight))

  return (firedWeight - smallest) / total < MINIMUM_DRIVER_COVERAGE_FRACTION
    ? [{ code: 'macro.coverage-at-floor', detail: { coverage } }]
    : []
}
