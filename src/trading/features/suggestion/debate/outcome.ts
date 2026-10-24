import type { HeadlinesRead, SuggestionCitation } from '@/trading/features/suggestion/citation'
import type { DebateContext } from '@/trading/features/suggestion/debate/call'
import type {
  ClaimVerification,
  DebateClaim,
  DebateResult,
  ThesisBreak,
} from '@/trading/features/suggestion/debate/types'
import type { DebateOutcome } from '@/trading/features/suggestion/pipeline/types'
import type { Suggestion } from '@/trading/features/suggestion/types'
import type { Caveat, HoldReasonCode } from '@/trading/kernel/caveat'
import { canHold, unverifiedCount } from '@/trading/features/suggestion/debate/claims'
import { unmatchedFigureCount } from '@/trading/features/suggestion/debate/figures'
import { debatePlaybook } from '@/trading/features/suggestion/debate/playbook'
import { reportRoleOutputs } from '@/trading/features/suggestion/debate/role-output'
import { claimIdsWithVerdict } from '@/trading/features/suggestion/debate/types'
import { framedDirectionOf } from '@/trading/features/suggestion/types'
import { isEvidenceReduceReason } from '@/trading/kernel/caveat'

/** The debate minus its verification: the verifier reads the assembled body, so the body has to
 *  exist before the field that quotes it. */
type DebateBody =
  | Omit<
      Extract<DebateResult, { readonly mode: 'full' }>,
      'verification' | 'claims' | 'playbook' | 'models'
    >
  | Omit<
      Extract<DebateResult, { readonly mode: 'lean' }>,
      'verification' | 'claims' | 'playbook' | 'models'
    >

/** What a verification acts on: every claim the debate minted, and the ids the synthesis said it
 *  leaned on. Both are known as soon as the synthesis answers, which is what lets the check start
 *  before the execution plan is written. */
export interface SelectedClaims {
  readonly claims: readonly DebateClaim[]
  readonly selected: readonly string[]
}

interface DebateSubject extends SelectedClaims {
  readonly body: DebateBody
}

export interface VerifiedClaims {
  readonly material: readonly DebateClaim[]
  readonly verification: ClaimVerification
  /** Present only when an earlier thesis stated conditions and some now hold. */
  readonly invalidatedPrior?: ThesisBreak
}

interface VerifiedDebate extends VerifiedClaims {
  readonly subject: DebateSubject
}

/** Only a refuted claim that argues *for* the proposed action holds the run: there the evidence
 *  says the case is wrong. A claim the evidence merely does not carry lowers conviction and is
 *  caveated, because "not stated" is not "contradicted" — and neither is a refuted reason to wait.
 *  A sale under one of the plan's own reasons never rested on the debate's case, so a refuted claim
 *  beside it is caveated rather than holding it. */
export function finish(context: DebateContext, verified: VerifiedDebate): DebateOutcome {
  const { material, verification } = verified
  const refuted = new Set(claimIdsWithVerdict(verification, 'refuted'))
  const blocking = blockingClaims(context.input.draft, material, refuted)
  const result: DebateResult = {
    ...verified.subject.body,
    verification,
    claims: material,
    playbook: debatePlaybook(context.input, context.market.manifest),
    models: [...context.models].sort(),
  }

  reportRoleOutputs(context, result, refuted)

  if (blocking.length > 0) {
    const held = hold('claim-unverified', context.evidence.caveats, context.evidence.headlinesRead)

    return { ...held, result, unsupportedClaims: blocking.map((claim) => claim.text) }
  }

  const unverified = unverifiedCount(verification, material)
  const broken = verified.invalidatedPrior
  const counts: DebateCaveatCounts = {
    contradicted: material.filter((claim) => refuted.has(claim.id)).length,
    unverified,
    unmatched: unmatchedFigureCount(material, context.evidence.text),
    broken,
  }

  return {
    kind: 'resolved',
    result,
    thesis: thesisOf(result),
    citations: citationsOf(context, result, verification),
    headlinesRead: context.evidence.headlinesRead,
    caveats: [...context.evidence.caveats, ...debateCaveats(counts)],
    unverifiedClaims: unverified,
    ...(broken === undefined ? {} : { invalidatedPrior: broken }),
  }
}

interface DebateCaveatCounts {
  readonly contradicted: number
  readonly unverified: number
  readonly unmatched: number
  readonly broken: ThesisBreak | undefined
}

// Split for the operator, not for the pipeline: "the evidence says otherwise" and "the evidence
// is silent" are different facts about a thesis, and conviction still falls on either.
function debateCaveats(counts: DebateCaveatCounts): readonly Caveat[] {
  const { contradicted, unverified, unmatched, broken } = counts
  const caveats: Caveat[] = []

  if (contradicted > 0) {
    caveats.push({ code: 'suggestion.claim-contradicted', detail: { count: contradicted } })
  }

  if (unverified > contradicted) {
    caveats.push({
      code: 'suggestion.citation-unverified',
      detail: { count: unverified - contradicted },
    })
  }

  if (unmatched > 0) {
    caveats.push({ code: 'suggestion.figure-unmatched', detail: { count: unmatched } })
  }

  if (broken !== undefined) {
    caveats.push({ code: 'suggestion.thesis-invalidated', detail: { count: broken.fired.length } })
  }

  return caveats
}

function blockingClaims(
  draft: Suggestion,
  material: readonly DebateClaim[],
  refuted: ReadonlySet<string>
): readonly DebateClaim[] {
  if (!restsOnTheCase(draft)) {
    return []
  }

  // The framed direction, not the action: a hold draft debates the side its levels price, and on
  // an exit-framed hold a refuted bullish claim argues *for* the sale rather than against it.
  return material.filter(
    (claim) => refuted.has(claim.id) && canHold(claim, framedDirectionOf(draft))
  )
}

function restsOnTheCase(draft: Suggestion): boolean {
  return (
    draft.action !== 'reduce' ||
    draft.reduceReasonCode === undefined ||
    isEvidenceReduceReason(draft.reduceReasonCode)
  )
}

function thesisOf(result: DebateResult): string {
  return result.mode === 'full' ? result.portfolioManager.rationale : result.analyst.summary
}

/** Resolved against the evidence the personas were handed: they retrieve nothing, so a URL outside
 *  the bundle is invented and is dropped. */
function citationsOf(
  context: DebateContext,
  result: DebateResult,
  verification: ClaimVerification
): readonly SuggestionCitation[] {
  const fromCases =
    result.mode === 'full'
      ? [...result.bull.citations, ...result.bear.citations]
      : result.analyst.citations
  const fromVerification = verification.verified.flatMap((entry) =>
    entry.citation === undefined ? [] : [entry.citation]
  )
  const cited = new Set([...fromCases, ...fromVerification].map((citation) => citation.url))

  return [...cited].flatMap((url) => {
    const item = context.evidence.sources.get(url)

    return item === undefined ? [] : [{ url, title: item.title, publishedAt: item.publishedAt }]
  })
}

export function hold(
  reasonCode: HoldReasonCode,
  caveats: readonly Caveat[],
  headlinesRead: HeadlinesRead
): Extract<DebateOutcome, { readonly kind: 'hold' }> {
  return { kind: 'hold', reasonCode, caveats, headlinesRead }
}
