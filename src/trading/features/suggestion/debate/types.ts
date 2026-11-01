import type { SuggestionCitation } from '@/trading/features/suggestion/citation'
import type { DebateRole, LeanDebateReason } from '@/trading/kernel/config'
import type { ConvictionBand } from '@/trading/kernel/conviction'
import type { MarketRef, Ticker, TradingDay } from '@/trading/kernel/instrument'

// The debate's own vocabulary: what each role may answer, what those answers look like, and the
// slim view a stored suggestion keeps of them. `DebateInput` and `DebateOutcome` stay beside the
// suggestion, because they carry one.

export const RESEARCH_STANCES = Object.freeze(['bullish', 'bearish', 'neutral'] as const)
export type ResearchStance = (typeof RESEARCH_STANCES)[number]

export const MANAGER_VERDICTS = Object.freeze(['proceed', 'hold'] as const)
export type ManagerVerdict = (typeof MANAGER_VERDICTS)[number]

export const RISK_VERDICTS = Object.freeze(['accept', 'lower', 'block'] as const)
export type RiskVerdict = (typeof RISK_VERDICTS)[number]

export const TRADE_STANCES = Object.freeze(['enter', 'wait', 'avoid'] as const)
export type TradeStance = (typeof TRADE_STANCES)[number]

export const SIZING_INTENTS = Object.freeze([
  'none',
  'starter',
  'partial',
  'full-policy-size',
] as const)
export type SizingIntent = (typeof SIZING_INTENTS)[number]

export interface ResearchCase {
  readonly stance: ResearchStance
  readonly summary: string
  readonly claims: readonly string[]
  readonly citations: readonly SuggestionCitation[]
}

/** The lean analyst argues *and* synthesizes — in full mode those are two roles, and the portfolio
 *  manager's `acceptedClaims` names what the synthesis leaned on. Lean has no such second role, so
 *  the analyst names it here, by position in its own `claims`: it authors both in one answer, so
 *  there is no id to point at yet. Empty means every claim is load-bearing. */
export interface AnalystCase extends ResearchCase {
  readonly materialClaims: readonly number[]
  readonly invalidators: readonly string[]
  /** P(this call closes with a positive return inside the outcome window), the role's own belief.
   *  The same event the track record counts as a win, so the score and the rate read as one. */
  readonly probability: number
}

/** The manager selects by claim id rather than restating: it is shown both cases' claims, and a
 *  claim it retyped would be its own wording checked against the evidence someone else read. */
export interface PortfolioManagerDecision {
  readonly verdict: ManagerVerdict
  readonly rationale: string
  readonly acceptedClaims: readonly string[]
  readonly rejectedClaims: readonly string[]
  /** Conditions that would break the thesis this decision authored. Verified on a later run, never
   *  on this one: they describe what has not happened yet. */
  readonly invalidators: readonly string[]
}

export interface TradePlan {
  readonly stance: TradeStance
  readonly entryTiming: string
  readonly entryConditions: readonly string[]
  readonly sizingIntent: SizingIntent
  readonly notes: readonly string[]
}

export interface RiskDecision {
  readonly verdict: RiskVerdict
  readonly conviction?: ConvictionBand
  readonly notes: readonly string[]
  readonly probability: number
}

/** What a role concluded, in the family of words its role uses. */
type RoleStance = ResearchStance | ManagerVerdict | TradeStance | RiskVerdict

/** One role's answer as a surface shows it. A role whose every checked claim the evidence refuted is
 *  `unsupported` and carries no summary: its prose argued something the evidence contradicts. */
export interface RoleOutput {
  readonly ticker: Ticker
  readonly market: MarketRef
  readonly role: DebateRole
  readonly stance?: RoleStance
  readonly summary?: string
  readonly citations: number
  readonly unsupported: boolean
}

/** Called synchronously, once per role, after the debate was verified, and guarded by the caller:
 *  a listener that throws never fails the debate. What a role said can carry a size or a level the
 *  operator would not want in a chat, so it is shown on the operator's own page and nowhere else. */
export type RoleOutputListener = (output: RoleOutput) => void

/** Three outcomes, not two: `insufficient` is the evidence saying nothing on the point, which is
 *  the common case for a narrative claim and is not the same answer as a contradiction. Only
 *  `refuted` may hold a suggestion. */
export const CLAIM_VERDICTS = Object.freeze(['supported', 'refuted', 'insufficient'] as const)
type ClaimVerdict = (typeof CLAIM_VERDICTS)[number]

/** A claim as it travels the debate: minted where it was argued and referenced by id afterwards, so
 *  no later role retypes another's words and no match depends on the wording surviving. */
export interface DebateClaim {
  readonly id: string
  readonly text: string
  readonly stance: ResearchStance
}

/** A prior run's invalidator as it travels verification. It carries no stance: a stance says which
 *  action a claim argues for, and an invalidator argues for none — it can never hold a run. */
export interface Invalidator {
  readonly id: string
  readonly text: string
}

/** An earlier thesis on this name whose stated conditions have since come true. */
export interface ThesisBreak {
  readonly at: TradingDay
  readonly fired: readonly string[]
}

export interface ClaimVerification {
  readonly verified: readonly VerifiedClaim[]
}

interface VerifiedClaim {
  readonly id: string
  readonly verdict: ClaimVerdict
  readonly citation?: SuggestionCitation
}

/** A material claim as a stored call keeps it: the id a fact check cites, and its words. The stance
 *  stays internal to the debate. */
interface StoredClaim {
  readonly id: string
  readonly text: string
}

export type DebateResult =
  | {
      readonly mode: 'full'
      readonly bull: ResearchCase
      readonly bear: ResearchCase
      readonly portfolioManager: PortfolioManagerDecision
      readonly trader: TradePlan
      readonly risk: RiskDecision
      readonly verification: ClaimVerification
      /** The material claims the verifier checked. */
      readonly claims: readonly StoredClaim[]
      readonly playbook: readonly string[]
      readonly models: readonly string[]
    }
  | {
      readonly mode: 'lean'
      readonly reason: LeanDebateReason
      readonly analyst: AnalystCase
      readonly verification: ClaimVerification
      readonly claims: readonly StoredClaim[]
      readonly playbook: readonly string[]
      readonly models: readonly string[]
    }

/** The slim debate view a stored suggestion carries: the decision points a reader needs. The full
 *  claim lists stay in the citations. */
export interface StoredDebateFull {
  readonly mode: 'full'
  readonly bullSummary: string
  readonly bearSummary: string
  readonly managerVerdict: ManagerVerdict
  readonly managerRationale: string
  readonly riskVerdict: RiskVerdict
  readonly riskConviction?: ConvictionBand
  /** The risk role's leading note: a block verdict decides the run, so it must say why. Absent when
   *  the role returned no notes. */
  readonly riskNote?: string
  readonly traderStance: TradeStance
  readonly traderTiming: string
  /** What the trader is waiting for, in its own words. Empty when it named nothing. */
  readonly traderConditions: readonly string[]
  readonly traderSizingIntent: SizingIntent
  /** The material claims the call rests on, which a fact check cites by id. */
  readonly claims: readonly StoredClaim[]
  /** The claim ids the verifier refuted. Absent on a call stored before they were kept. */
  readonly refutedIds?: readonly string[]
  readonly playbook?: readonly string[]
  readonly models: readonly string[]
}

interface StoredDebateLean {
  readonly mode: 'lean'
  readonly reason: LeanDebateReason
  readonly analystStance: ResearchStance
  readonly analystSummary: string
  readonly claims: readonly StoredClaim[]
  readonly refutedIds?: readonly string[]
  readonly playbook?: readonly string[]
  readonly models: readonly string[]
}

export type StoredDebate = StoredDebateFull | StoredDebateLean

/** An avoid, or an entry asking for no size. A wait asks for no size by nature, so its intent says
 *  nothing about refusal: it holds on its conditions. */
export function isTraderRefusal(stance: TradeStance, sizingIntent: SizingIntent): boolean {
  return stance === 'avoid' || (stance === 'enter' && sizingIntent === 'none')
}

/** The chance of closing positive the reviewing role stated: the risk analyst in a full debate,
 *  the analyst in a lean one. */
export function probabilityOf(result: DebateResult): number {
  return result.mode === 'full' ? result.risk.probability : result.analyst.probability
}

/** Whichever arm authored the synthesis also authored its invalidators. */
export function invalidatorsOf(result: DebateResult): readonly string[] {
  return result.mode === 'full' ? result.portfolioManager.invalidators : result.analyst.invalidators
}

/** The ids the verifier gave this verdict, in the order it reported them. */
export function claimIdsWithVerdict(
  verification: ClaimVerification,
  verdict: ClaimVerdict
): readonly string[] {
  return verification.verified.filter((entry) => entry.verdict === verdict).map((entry) => entry.id)
}

/** Dropped rather than carried empty: a debate whose roles read nothing has no line to render, and
 *  `exactOptionalPropertyTypes` rejects an explicit undefined. Shared with the row parser so the
 *  stored shape and the read-back shape cannot disagree. */
export function playbookField(skills: readonly string[] | undefined): {
  readonly playbook?: readonly string[]
} {
  return skills === undefined || skills.length === 0 ? {} : { playbook: skills }
}

function toStoredClaims(claims: readonly StoredClaim[]): readonly StoredClaim[] {
  return claims.map(({ id, text }) => ({ id, text }))
}

export function toStoredDebate(result: DebateResult): StoredDebate {
  if (result.mode === 'lean') {
    return {
      mode: 'lean',
      reason: result.reason,
      analystStance: result.analyst.stance,
      analystSummary: result.analyst.summary,
      claims: toStoredClaims(result.claims),
      refutedIds: claimIdsWithVerdict(result.verification, 'refuted'),
      ...playbookField(result.playbook),
      models: result.models,
    }
  }

  return {
    mode: 'full',
    bullSummary: result.bull.summary,
    bearSummary: result.bear.summary,
    managerVerdict: result.portfolioManager.verdict,
    managerRationale: result.portfolioManager.rationale,
    riskVerdict: result.risk.verdict,
    traderStance: result.trader.stance,
    traderTiming: result.trader.entryTiming,
    traderSizingIntent: result.trader.sizingIntent,
    traderConditions: result.trader.entryConditions,
    claims: toStoredClaims(result.claims),
    refutedIds: claimIdsWithVerdict(result.verification, 'refuted'),
    ...(result.risk.conviction === undefined ? {} : { riskConviction: result.risk.conviction }),
    ...(result.risk.notes[0] === undefined ? {} : { riskNote: result.risk.notes[0] }),
    ...playbookField(result.playbook),
    models: result.models,
  }
}
