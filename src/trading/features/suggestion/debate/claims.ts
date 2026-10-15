import type { OpposedCases } from '@/trading/features/suggestion/debate/debate-prompts'
import type {
  ClaimVerification,
  DebateClaim,
  Invalidator,
  ResearchCase,
} from '@/trading/features/suggestion/debate/types'
import type { PriorThesis } from '@/trading/features/suggestion/types'
import type { SuggestionAction } from '@/trading/kernel/conviction'
import { claimIdsWithVerdict } from '@/trading/features/suggestion/debate/types'

/** Keeps a prior run's conditions apart from this run's claims in one shared verdict list. */
const INVALIDATOR_PREFIX = 'invalidator'

/** Both cases' claims in one list: the manager selects across them, and the id is what it selects
 *  by, so the prefix is what keeps two roles' first claims apart. */
export function casesClaims(cases: OpposedCases): readonly DebateClaim[] {
  return [...claimsOf('bull', cases.bull), ...claimsOf('bear', cases.bear)]
}

export function claimsOf(prefix: string, source: ResearchCase): readonly DebateClaim[] {
  return mintIds(prefix, source.claims).map((claim) => ({ ...claim, stance: source.stance }))
}

/** One owner for the id shape, so a claim and a condition can never collide on `bull-1`. The shape
 *  is left inferred: a claim adds a stance to it and an invalidator does not, and naming it after
 *  either would say the wrong thing about the other. */
function mintIds(prefix: string, texts: readonly string[]) {
  return texts.map((text, index) => ({ id: `${prefix}-${index + 1}`, text }))
}

/** The analyst points at its own claims by position, having written both in one answer; a position
 *  outside the list selects nothing. */
export function claimAt(claims: readonly DebateClaim[], position: number): readonly string[] {
  const claim = claims[position - 1]

  return claim === undefined ? [] : [claim.id]
}

/** The selection is a filter over minted ids, so an id the synthesis invented selects nothing. An
 *  empty selection has not said the thesis rests on nothing — it has not answered — so every claim
 *  stays load-bearing. */
export function materialClaims(
  claims: readonly DebateClaim[],
  selected: readonly string[]
): readonly DebateClaim[] {
  const kept = claims.filter((claim) => selected.includes(claim.id))

  return kept.length === 0 ? claims : kept
}

/** A claim only holds the action it argues for. An unverifiable reason for caution is not a reason
 *  to trade, so a bearish claim cannot block a buy — it lowers conviction like any other. */
export function canHold(claim: DebateClaim, action: SuggestionAction): boolean {
  return action === 'reduce' ? claim.stance !== 'bullish' : claim.stance !== 'bearish'
}

/** Everything material the evidence did not carry: unsupported, contradicted but not load-bearing,
 *  or left unanswered — silence is the one verdict a verifier cannot mean. */
export function unverifiedCount(
  verification: ClaimVerification,
  material: readonly DebateClaim[]
): number {
  const supported = supportedIds(verification)

  return material.filter((claim) => !supported.has(claim.id)).length
}

function supportedIds(verification: ClaimVerification): ReadonlySet<string> {
  return new Set(claimIdsWithVerdict(verification, 'supported'))
}

export function toInvalidators(prior: PriorThesis): readonly Invalidator[] {
  return mintIds(INVALIDATOR_PREFIX, prior.invalidators)
}

/** The verdict reads backwards here, and this is the only place that knows it: a claim the evidence
 *  supports is the case standing up, while an invalidator the evidence supports is the condition
 *  having happened. Silence and contradiction both mean the thesis still holds. */
export function firedInvalidators(
  verification: ClaimVerification,
  invalidators: readonly Invalidator[]
): readonly string[] {
  const supported = supportedIds(verification)

  return invalidators.filter((entry) => supported.has(entry.id)).map((entry) => entry.text)
}
