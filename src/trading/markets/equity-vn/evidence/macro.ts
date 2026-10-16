import type { Caveat, CaveatCode } from '@/trading/kernel/caveat'
import type { MacroSeriesId } from '@/trading/kernel/market/macro-series'
import type { MarketRegime, NewsItem } from '@/trading/kernel/market/market-data'
import type { MacroRiskView } from '@/trading/kernel/market/market-macro'
import { MARKET_REGIMES } from '@/trading/kernel/market/market-data'
import {
  DOWNSIDE_BAND_PROXIMITY_FRACTION,
  FOREIGN_FLOW_STRESS_RATIO,
  FX_STRESS_DEPRECIATION_FRACTION,
  LONG_TREND_SESSIONS,
  LONG_TREND_SLOPE_SESSIONS,
  MARGIN_CASCADE_UNIVERSE_FRACTION,
  MINIMUM_POLICY_NEWS_STORIES,
  VN_MACRO_DRIVERS,
  VN_MACRO_FORMULA_VERSION,
} from '@/trading/markets/equity-vn/policy'
import { deriveMacroRisk } from '@/trading/markets/macro-risk'
import { groupStories } from '@/trading/markets/news'
import { trendWithSlope } from '@/trading/markets/timeseries'
import { CAVEAT_SUBJECT_SEPARATOR } from '@/trading/render/format'
import { PERCENT_PER_UNIT } from '@/trading/sources/rows/normalization'

const POLICY_DIRECTIONS = Object.freeze(['hike', 'cut'] as const)
type PolicyDirection = (typeof POLICY_DIRECTIONS)[number]
type PolicyBias = PolicyDirection | 'neutral'

/** Deliberately narrow and language-pinned. A headline classifier that guesses is worse than one
 *  that abstains: an abstention is reported as a gap, a wrong guess moves the regime. */
const HIKE_PATTERNS: readonly RegExp[] = Object.freeze([
  /\brate hike\b/i,
  /\braises? (?:the )?(?:policy |benchmark )?rate/i,
  /\btightening\b/i,
  /\btăng lãi suất\b/i,
])
const CUT_PATTERNS: readonly RegExp[] = Object.freeze([
  /\brate cut\b/i,
  /\b(?:cuts?|lowers?) (?:the )?(?:policy |benchmark )?rate/i,
  /\beasing\b/i,
  /\bgiảm lãi suất\b/i,
])

const STRESS_IDS = Object.freeze(['margin', 'foreign-flow', 'fx'] as const)
type StressId = (typeof STRESS_IDS)[number]

/** A stress confirmer fires, is clear, or says nothing — and a confirmer reading a stored window
 *  says nothing for two different reasons. `abstain` is today's data missing; `no-history` is the
 *  window not yet filled, which resolves on its own and is reported as a note rather than a
 *  degradation. Neither counts as clear. The id travels with the verdict because every line about
 *  a confirmer has to name which one. */
interface StressSignal {
  readonly id: StressId
  readonly kind: 'fired' | 'clear' | 'abstain' | 'no-history'
}

function signal(id: StressId, kind: StressSignal['kind']): StressSignal {
  return { id, kind }
}

interface BandInput {
  readonly last: number
  readonly reference: number
  readonly floor: number
}

/** The one piece of genuinely VN-specific market structure, and the one easiest to compute against
 *  the wrong denominator. */
export function marginStress(universe: readonly BandInput[], smallestTick: number): StressSignal {
  // Names with a current reference price *and* an exchange band — not the whole universe.
  // Including unpriced or unbanded names dilutes the ratio and hides real stress.
  const valid = universe.filter(
    (name) => name.reference > 0 && name.floor > 0 && Number.isFinite(name.last)
  )

  if (valid.length === 0) {
    return signal('margin', 'abstain')
  }

  // `Math.max(..., smallestTick)` guards a name whose reference equals its floor — division by
  // zero on exactly the names in most distress.
  const nearBand = valid.filter(
    (name) =>
      (name.last - name.floor) / Math.max(name.reference - name.floor, smallestTick) <=
      DOWNSIDE_BAND_PROXIMITY_FRACTION
  )

  return signal(
    'margin',
    nearBand.length / valid.length >= MARGIN_CASCADE_UNIVERSE_FRACTION ? 'fired' : 'clear'
  )
}

export function foreignFlowStress(ratio: number | undefined): StressSignal {
  if (ratio === undefined || !Number.isFinite(ratio)) {
    return signal('foreign-flow', 'abstain')
  }

  return signal('foreign-flow', ratio <= FOREIGN_FLOW_STRESS_RATIO ? 'fired' : 'clear')
}

interface TapeInput {
  readonly indexCloses: readonly number[]
  readonly participationAboveTrend: number | undefined
}

/** The tape's two regime drivers, in the percent units their bands are quoted in. A half that
 *  cannot be read is absent, so the composite reports it missing rather than reading it as flat. */
export function tapeDriverValues(
  input: TapeInput
): Readonly<Partial<Record<MacroSeriesId, number>>> {
  const trend = trendWithSlope(input.indexCloses, LONG_TREND_SESSIONS, LONG_TREND_SLOPE_SESSIONS)
  const breadth = input.participationAboveTrend

  return {
    ...(trend === undefined ? {} : { 'vn-index-trend': trend * PERCENT_PER_UNIT }),
    ...(breadth === undefined ? {} : { 'vn-breadth': breadth * PERCENT_PER_UNIT }),
  }
}

interface FxInput {
  /** Đồng per dollar today. */
  readonly current: number | undefined
  /** The same rate as it stood `FX_STRESS_SESSIONS` refreshed sessions ago. */
  readonly trailing: number | undefined
}

/** Depreciation is the rate rising - more đồng per dollar. A missing rate today is a failed read;
 *  a missing one a window back is a history still filling, and a stored rate at or below zero is
 *  no more readable than an absent one. */
export function fxStress(input: FxInput): StressSignal {
  const { current, trailing } = input

  if (current === undefined) {
    return signal('fx', 'abstain')
  }

  if (trailing === undefined || trailing <= 0) {
    return signal('fx', 'no-history')
  }

  return signal('fx', current / trailing - 1 >= FX_STRESS_DEPRECIATION_FRACTION ? 'fired' : 'clear')
}

/** Counted per story, not per outlet: one wire report carried by five publishers is one report, and
 *  a domain count reads it as five. Two distinct reports and a strict majority are what separate a
 *  policy signal from a syndicated headline. */
export function policyBias(items: readonly NewsItem[]): PolicyBias {
  const directions = groupStories(items).flatMap((group) => classifyDirection(group.item) ?? [])
  const hikes = directions.filter((direction) => direction === 'hike').length
  const cuts = directions.filter((direction) => direction === 'cut').length

  if (hikes >= MINIMUM_POLICY_NEWS_STORIES && hikes > cuts) {
    return 'hike'
  }

  return cuts >= MINIMUM_POLICY_NEWS_STORIES && cuts > hikes ? 'cut' : 'neutral'
}

interface VnMacroInput {
  readonly base: Parameters<typeof deriveMacroRisk>[0]
  readonly confirmers: readonly StressSignal[]
  readonly bias: PolicyBias
}

/** The base composite is the shared formula over VN's own driver table; VN stress only ever lowers
 *  the band it produced. Nothing here can raise a regime, so a benign VN read returns the operator
 *  to their own policy ceiling and never past it. */
export function deriveVnMacroRisk(input: VnMacroInput): MacroRiskView {
  const base = deriveMacroRisk(input.base, VN_MACRO_DRIVERS)
  const fired = withKind(input.confirmers, 'fired')
  const steps = fired.length + (input.bias === 'hike' ? 1 : 0)
  const regime = lowerRegime(base.regime, steps)

  return {
    ...base,
    formulaVersion: VN_MACRO_FORMULA_VERSION,
    regime,
    caveats: [
      ...base.caveats,
      ...loweredCaveats({ regime, baseRegime: base.regime }, fired, input.bias),
      ...confirmerCaveats('macro.confirmers-abstained', withKind(input.confirmers, 'abstain')),
      ...confirmerCaveats('macro.confirmers-warming-up', withKind(input.confirmers, 'no-history')),
    ],
  }
}

function withKind(
  confirmers: readonly StressSignal[],
  kind: StressSignal['kind']
): readonly StressSignal[] {
  return confirmers.filter((entry) => entry.kind === kind)
}

/** A lowered regime that never says what lowered it reads as the formula disagreeing with itself.
 *  Compared with the base read: thin coverage already names itself in the base's caveats. */
function loweredCaveats(
  banded: { readonly regime: MarketRegime; readonly baseRegime: MarketRegime },
  fired: readonly StressSignal[],
  bias: PolicyBias
): readonly Caveat[] {
  if (banded.regime === banded.baseRegime) {
    return []
  }

  const reasons = [...fired.map((entry) => entry.id), ...(bias === 'hike' ? ['policy-bias'] : [])]

  return [
    { code: 'macro.regime-lowered', detail: { reasons: reasons.join(CAVEAT_SUBJECT_SEPARATOR) } },
  ]
}

/** Regime bands are ordered risk-on -> neutral -> risk-off, so lowering is an index walk that
 *  saturates at the defensive end. */
function lowerRegime(regime: MarketRegime, steps: number): MarketRegime {
  const index = MARKET_REGIMES.indexOf(regime)
  const lowered = MARKET_REGIMES[Math.min(index + Math.max(steps, 0), MARKET_REGIMES.length - 1)]

  return lowered ?? regime
}

type ConfirmerCaveatCode = Extract<
  CaveatCode,
  'macro.confirmers-abstained' | 'macro.confirmers-warming-up'
>

/** Named rather than counted: one confirmer short of data and four of them read as the same line
 *  otherwise, and only the names say whether today's regime rested on anything. */
function confirmerCaveats(
  code: ConfirmerCaveatCode,
  silent: readonly StressSignal[]
): readonly Caveat[] {
  if (silent.length === 0) {
    return []
  }

  const confirmers = silent.map((entry) => entry.id).join(CAVEAT_SUBJECT_SEPARATOR)

  return [{ code, detail: { confirmers } }]
}

function classifyDirection(item: NewsItem): PolicyDirection | undefined {
  const text = `${item.title} ${item.summary ?? ''}`

  if (HIKE_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'hike'
  }

  return CUT_PATTERNS.some((pattern) => pattern.test(text)) ? 'cut' : undefined
}
