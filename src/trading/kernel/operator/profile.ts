import type { Locale } from '@/core/types/locale'
import type {
  CurrencyCode,
  InstrumentKind,
  InstrumentRef,
  PortfolioSegment,
} from '@/trading/kernel/instrument'
import { ValidationError } from '@/core/errors'
import { ETF_KIND } from '@/trading/kernel/instrument'

export const RISK_LEVELS = Object.freeze(['conservative', 'balanced', 'aggressive'] as const)
export type RiskLevel = (typeof RISK_LEVELS)[number]

export const INVESTMENT_HORIZONS = Object.freeze(['short', 'long'] as const)
export type InvestmentHorizon = (typeof INVESTMENT_HORIZONS)[number]

export const INVESTMENT_GOALS = Object.freeze(['preserve', 'income', 'grow'] as const)
export type InvestmentGoal = (typeof INVESTMENT_GOALS)[number]

export interface RiskCapSet {
  readonly maximumPositionPctNav: number
  readonly maximumSegmentPctNav: number
  /** Ceiling on the ETF share of this segment, as a fraction of NAV. Absent on a segment whose market
   *  lists no ETFs; `0` closes the segment to them. Never above `maximumSegmentPctNav`. */
  readonly maximumEtfPctNav?: number
  /** Floor under the ETF share of this segment: the core the operator wants held in the index
   *  whatever the scores say. Absent on a segment with no core, which is most of them. Never above
   *  `maximumEtfPctNav` where that is declared, nor above `maximumSegmentPctNav`. */
  readonly minimumEtfPctNav?: number
}

/** A segment the operator switched off. Both ceilings at zero rather than a separate flag: every cap
 *  reader already fails closed on zero room, so nothing can disagree with the caps. */
export const DISABLED_CAPS: RiskCapSet = Object.freeze({
  maximumPositionPctNav: 0,
  maximumSegmentPctNav: 0,
})

/** A fund answers to its segment's ETF ceiling instead of the single-name cap: that cap guards
 *  against one issuer failing, which a basket does not carry. A segment with no ETF ceiling keeps
 *  the single-name cap for its funds too. */
export function isCappedAsFund(
  caps: RiskCapSet | undefined,
  instrumentKind: InstrumentKind | undefined
): boolean {
  return instrumentKind === ETF_KIND && caps?.maximumEtfPctNav !== undefined
}

/** The most one position may weigh. Fails closed at zero where the segment records no caps. */
export function positionCapOf(
  caps: RiskCapSet | undefined,
  instrumentKind: InstrumentKind | undefined
): number {
  if (caps === undefined) {
    return 0
  }

  return isCappedAsFund(caps, instrumentKind)
    ? (caps.maximumEtfPctNav ?? 0)
    : caps.maximumPositionPctNav
}

export function isSegmentDisabled(caps: RiskCapSet): boolean {
  return caps.maximumPositionPctNav === 0 && caps.maximumSegmentPctNav === 0
}

/** Every segment the operator switched off. A noun phrase, not a predicate: the caller names them
 *  rather than testing one. A patch that carries no caps can tell nothing apart and names none. */
export function disabledSegments(
  caps: Readonly<Record<PortfolioSegment, RiskCapSet>> | undefined
): ReadonlySet<string> {
  return new Set(
    Object.entries(caps ?? {})
      .filter(([, cap]) => isSegmentDisabled(cap))
      .map(([segment]) => segment)
  )
}

/** The policy numbers a risk level seeds. Separate from the rest of the profile so the store can
 *  fill an absent one from its seed: a number missing from a stored payload is always a field added
 *  after that profile was written, never an operator choice, because no surface can unset one.
 *  Declaring one here and nowhere else fails the build until `seededPolicyNumbers` covers it. */
export interface ProfilePolicyNumbers {
  readonly maximumSectorPctNav: number
  readonly reservePctNav: number
  readonly regimeScale: number
  readonly riskPerTradePctNav: number
  /** What the whole book may stand to lose at its planned stops, as a fraction of NAV. A new buy
   *  gets only the room under it. */
  readonly maximumOpenRiskPctNav: number
  /** Share of a sized position entered on the first order; the rest waits for the retest. */
  readonly entryTranchePct: number
  /** Share of a position closed at the first target. */
  readonly takeProfitTranchePct: number
}

export interface UserProfile extends ProfilePolicyNumbers {
  readonly preferredLocale: Locale
  readonly baseCurrency: CurrencyCode
  readonly riskLevel: RiskLevel
  readonly riskCapacity: RiskLevel
  readonly riskWillingness: RiskLevel
  /** One per registered segment, seeded from each market's own horizon. A crypto segment is held
   *  for weeks and an equity segment for quarters by the same operator. */
  readonly horizons: Readonly<Record<PortfolioSegment, InvestmentHorizon>>
  /** Advisory only: read by the debate personas, never by sizing or seeding. `riskLevel` already
   *  seeds allocation the way preservation and growth would. */
  readonly goal: InvestmentGoal
  readonly watchlist: readonly InstrumentRef[]
  readonly exclusions: readonly InstrumentRef[]
  readonly segmentTargets: Readonly<Record<PortfolioSegment, number>>
  /** The segments whose target the operator set by hand. Every re-seed honours them and moves the
   *  rest around them, so a risk-level change cannot quietly overwrite a number they chose. Empty
   *  for a profile that has never pinned one, which is most of them. */
  readonly pinnedTargets: Readonly<Partial<Record<PortfolioSegment, number>>>
  /** The ETF core the operator asked for, per segment. `caps` holds it clamped to the current
   *  ceilings, and drops it while the segment is off. */
  readonly etfCores: Readonly<Partial<Record<PortfolioSegment, number>>>
  readonly caps: Readonly<Record<PortfolioSegment, RiskCapSet>>
}

/** What produced a number, not what bounded it: the three answers the operator gave, and whether
 *  they gave them. Every limit is stated where it binds, so none travels here. */
export interface ProfileStamp {
  readonly riskLevel: RiskLevel
  readonly goal: InvestmentGoal
  /** False when nothing was saved and all three are seeds. */
  readonly saved: boolean
}

export interface ProfilePatch {
  readonly preferredLocale?: Locale
  readonly riskLevel?: RiskLevel
  readonly riskCapacity?: RiskLevel
  readonly riskWillingness?: RiskLevel
  readonly horizons?: Readonly<Partial<Record<PortfolioSegment, InvestmentHorizon>>>
  readonly goal?: InvestmentGoal
  readonly watchlist?: readonly InstrumentRef[]
  readonly exclusions?: readonly InstrumentRef[]
  readonly segmentTargets?: Readonly<Record<PortfolioSegment, number>>
  readonly pinnedTargets?: Readonly<Partial<Record<PortfolioSegment, number>>>
  readonly etfCores?: Readonly<Partial<Record<PortfolioSegment, number>>>
  readonly caps?: Readonly<Record<PortfolioSegment, RiskCapSet>>
  readonly maximumSectorPctNav?: number
  readonly reservePctNav?: number
  readonly regimeScale?: number
  readonly riskPerTradePctNav?: number
  readonly maximumOpenRiskPctNav?: number
  readonly entryTranchePct?: number
  readonly takeProfitTranchePct?: number
}

export function toProfileStamp(input: {
  readonly profile: UserProfile
  readonly saved: boolean
}): ProfileStamp {
  const { profile, saved } = input

  return {
    riskLevel: profile.riskLevel,
    goal: profile.goal,
    saved,
  }
}

/** A stored profile names every registered segment exactly once, so an absent horizon is the
 *  registry and the row disagreeing, not a value to default. */
export function horizonFor(profile: UserProfile, segment: PortfolioSegment): InvestmentHorizon {
  const horizon = profile.horizons[segment]

  if (horizon === undefined) {
    throw new ValidationError(`profile has no horizon for segment ${segment}`)
  }

  return horizon
}
