import type { HeadlinesRead, SuggestionCitation } from '@/trading/features/suggestion/citation'
import type { DebateContext, DebateDeps } from '@/trading/features/suggestion/debate/call'
import type { RoleRunResult } from '@/trading/features/suggestion/debate/roles'
import type {
  ClaimVerification,
  DebateClaim,
  DebateResult,
  PortfolioManagerDecision,
  RiskDecision,
  ThesisBreak,
  TradePlan,
} from '@/trading/features/suggestion/debate/types'
import type { DebateOutcome, RunDebate } from '@/trading/features/suggestion/pipeline/types'
import type { Caveat, HoldReasonCode } from '@/trading/kernel/caveat'
import type { LeanDebateReason } from '@/trading/kernel/config'
import {
  call,
  failFast,
  isAbortedFailure,
  runOpposedCases,
} from '@/trading/features/suggestion/debate/call'
import {
  canHold,
  casesClaims,
  claimAt,
  claimsOf,
  firedInvalidators,
  materialClaims,
  toInvalidators,
  unverifiedCount,
} from '@/trading/features/suggestion/debate/claims'
import {
  analystPrompt,
  managerPrompt,
  riskPrompt,
  traderPrompt,
  verifierPrompt,
} from '@/trading/features/suggestion/debate/debate-prompts'
import { unmatchedFigureCount } from '@/trading/features/suggestion/debate/figures'
import { buildHistoryBlock } from '@/trading/features/suggestion/debate/history'
import { debatePlaybook } from '@/trading/features/suggestion/debate/playbook'
import { toTradePlan } from '@/trading/features/suggestion/debate/trade-plan'
import { claimIdsWithVerdict } from '@/trading/features/suggestion/debate/types'
import { buildEvidenceBundle } from '@/trading/features/suggestion/pipeline/evidence'
import {
  ANALYST_CASE_SCHEMA,
  CLAIM_VERIFICATION_SCHEMA,
  PORTFOLIO_MANAGER_SCHEMA,
  RISK_DECISION_SCHEMA,
  TRADE_PLAN_SCHEMA,
  toAnalystCase,
  toClaimVerification,
  toRiskDecision,
} from '@/trading/features/suggestion/pipeline/schemas'
import { framedDirectionOf } from '@/trading/features/suggestion/types'

/** The debate's share of the parent budget; the rest is headroom for the parent run's own turns. */
export const AGENT_BUDGET_FRACTION = 0.8
const NOTHING_READ: HeadlinesRead = Object.freeze({ own: 0, market: 0, costUsd: 0 })

export function createRunDebate(deps: DebateDeps): RunDebate {
  return async (input, budgets, signal) => {
    const market = deps.markets.find(input.draft.instrument.market)

    if (market === null) {
      return hold('debate-unresolved', [{ code: 'market-data.no-coverage' }], NOTHING_READ)
    }

    const evidence = await buildEvidenceBundle({
      market,
      input,
      ...(deps.decisionsChain === undefined ? {} : { decisionsChain: deps.decisionsChain }),
      recordAttempt: deps.recordAttempt,
      logger: deps.logger,
    })
    const context: DebateContext = {
      deps,
      input,
      evidence,
      budgets,
      signal,
      market,
      models: new Set<string>(),
    }

    switch (input.depth.mode) {
      case 'full':
        return runFull(context)
      case 'lean':
        return runLean(context, input.depth.reason)
      default: {
        const exhaustive: never = input.depth
        return exhaustive
      }
    }
  }
}

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
interface SelectedClaims {
  readonly claims: readonly DebateClaim[]
  readonly selected: readonly string[]
}

interface DebateSubject extends SelectedClaims {
  readonly body: DebateBody
}

async function runFull(context: DebateContext): Promise<DebateOutcome> {
  const opposed = await runOpposedCases(context)

  if (opposed.kind === 'failed') {
    return degraded(context, opposed.caveat)
  }

  const history = await buildHistoryBlock(context.deps, context.input, context.signal)
  const claims = casesClaims(opposed.value)
  const manager = await call(context, {
    role: 'portfolio-manager',
    schema: PORTFOLIO_MANAGER_SCHEMA,
    prompt: () => managerPrompt({ context, cases: opposed.value, claims, history }),
  })

  if (manager.kind === 'failed') {
    return degraded(context, manager.caveat)
  }

  const selection: SelectedClaims = { claims, selected: manager.value.acceptedClaims }
  const planned = await runPlanAndVerification(context, manager.value, selection)

  if (planned.kind === 'failed') {
    return degraded(context, planned.caveat)
  }

  const { plan, verified } = planned.value

  return finish(context, {
    subject: {
      ...selection,
      body: {
        mode: 'full',
        bull: opposed.value.bull,
        bear: opposed.value.bear,
        portfolioManager: manager.value,
        trader: plan.trader,
        risk: plan.risk,
      },
    },
    ...verified,
  })
}

async function runLean(context: DebateContext, reason: LeanDebateReason): Promise<DebateOutcome> {
  const history = await buildHistoryBlock(context.deps, context.input, context.signal)
  const analyst = await call(context, {
    role: 'market-analyst',
    schema: ANALYST_CASE_SCHEMA,
    prompt: () => analystPrompt(context, history),
  })

  if (analyst.kind === 'failed') {
    return degraded(context, analyst.caveat)
  }

  const analystCase = toAnalystCase(analyst.value)
  const claims = claimsOf('analyst', analystCase)
  const selection: SelectedClaims = {
    claims,
    selected: analystCase.materialClaims.flatMap((position) => claimAt(claims, position)),
  }
  const verified = await verifyClaims(context, selection)

  return verified.kind === 'failed'
    ? degraded(context, verified.caveat)
    : finish(context, {
        subject: { ...selection, body: { mode: 'lean', reason, analyst: analystCase } },
        ...verified.value,
      })
}

interface PlannedDebate {
  readonly plan: ExecutionPlan
  readonly verified: VerifiedClaims
}

/** The plan and the verification share no input, so neither waits behind the other. The controller
 *  is aborted in `finally` so the sibling settles on every path: an arm left in flight after the
 *  other failed bills against a debate already decided. */
async function runPlanAndVerification(
  context: DebateContext,
  manager: PortfolioManagerDecision,
  selection: SelectedClaims
): Promise<RoleRunResult<PlannedDebate>> {
  const controller = new AbortController()
  const signal = AbortSignal.any([context.signal, controller.signal])
  const scoped: DebateContext = { ...context, signal }

  try {
    const [plan, verified] = await Promise.all([
      runExecutionPlan(scoped, manager).then(failFast(controller)),
      verifyClaims(scoped, selection).then(failFast(controller)),
    ])

    if (plan.kind === 'failed') {
      return verified.kind === 'failed' && isAbortedFailure(plan.caveat) ? verified : plan
    }

    return verified.kind === 'failed'
      ? verified
      : { kind: 'value', value: { plan: plan.value, verified: verified.value } }
  } finally {
    controller.abort()
  }
}

interface ExecutionPlan {
  readonly trader: TradePlan
  readonly risk: RiskDecision
}

/** Trader then risk, in that order: the risk analyst judges the plan the trader wrote. */
async function runExecutionPlan(
  context: DebateContext,
  manager: PortfolioManagerDecision
): Promise<RoleRunResult<ExecutionPlan>> {
  const trader = await call(context, {
    role: 'trader',
    schema: TRADE_PLAN_SCHEMA,
    prompt: () => traderPrompt(context, manager),
  })

  if (trader.kind === 'failed') {
    return trader
  }

  const plan = toTradePlan(trader.value, context)
  const risk = await call(context, {
    role: 'risk-analyst',
    schema: RISK_DECISION_SCHEMA,
    prompt: () => riskPrompt(context, manager, plan),
  })

  return risk.kind === 'failed'
    ? risk
    : { kind: 'value', value: { trader: plan, risk: toRiskDecision(risk.value) } }
}

interface VerifiedClaims {
  readonly material: readonly DebateClaim[]
  readonly verification: ClaimVerification
  /** Present only when an earlier thesis stated conditions and some now hold. */
  readonly invalidatedPrior?: ThesisBreak
}

/** Invalidators stay out of `material`: that list is what may hold the run and what
 *  `unverifiedCount` measures, and a prior run's condition belongs to neither. */
async function verifyClaims(
  context: DebateContext,
  selection: SelectedClaims
): Promise<RoleRunResult<VerifiedClaims>> {
  const material = materialClaims(selection.claims, selection.selected)
  const prior = await context.deps.store.findPreviousThesis({
    market: context.input.draft.instrument.market,
    ticker: context.input.draft.instrument.ticker,
    focusKey: context.input.request.focus.key,
    beforeDay: context.input.draft.at,
    signal: context.signal,
  })
  const invalidators = prior === null ? [] : toInvalidators(prior)
  const verification = await call(context, {
    role: 'claim-verifier',
    schema: CLAIM_VERIFICATION_SCHEMA,
    prompt: () => verifierPrompt(context, material, invalidators),
  })

  if (verification.kind === 'failed') {
    return verification
  }

  const verified = toClaimVerification(verification.value)
  const fired = firedInvalidators(verified, invalidators)

  return {
    kind: 'value',
    value: {
      material,
      verification: verified,
      ...(prior === null || fired.length === 0
        ? {}
        : { invalidatedPrior: { at: prior.at, fired } }),
    },
  }
}

interface VerifiedDebate extends VerifiedClaims {
  readonly subject: DebateSubject
}

/** Only a refuted claim that argues *for* the proposed action holds the run: there the evidence
 *  says the case is wrong. A claim the evidence merely does not carry lowers conviction and is
 *  caveated, because "not stated" is not "contradicted" — and neither is a refuted reason to wait. */
function finish(context: DebateContext, verified: VerifiedDebate): DebateOutcome {
  const { material, verification } = verified
  const refuted = new Set(claimIdsWithVerdict(verification, 'refuted'))
  const blocking = material.filter(
    // The framed direction, not the action: a hold draft debates the side its levels price, and on
    // an exit-framed hold a refuted bullish claim argues *for* the sale rather than against it.
    (claim) => refuted.has(claim.id) && canHold(claim, framedDirectionOf(context.input.draft))
  )
  const result: DebateResult = {
    ...verified.subject.body,
    verification,
    claims: material,
    playbook: debatePlaybook(context.input, context.market.manifest),
    models: [...context.models].sort(),
  }

  if (blocking.length > 0) {
    const held = hold('claim-unverified', context.evidence.caveats, context.evidence.headlinesRead)

    return { ...held, result, unsupportedClaims: blocking.map((claim) => claim.text) }
  }

  const unverified = unverifiedCount(verification, material)
  // Split for the operator, not for the pipeline: "the evidence says otherwise" and "the evidence
  // is silent" are different facts about a thesis, and conviction still falls on either.
  const contradicted = material.filter((claim) => refuted.has(claim.id)).length
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

  const unmatched = unmatchedFigureCount(material, context.evidence.text)

  if (unmatched > 0) {
    caveats.push({ code: 'suggestion.figure-unmatched', detail: { count: unmatched } })
  }

  const broken = verified.invalidatedPrior

  if (broken !== undefined) {
    caveats.push({ code: 'suggestion.thesis-invalidated', detail: { count: broken.fired.length } })
  }

  return {
    kind: 'resolved',
    result,
    thesis: thesisOf(result),
    citations: citationsOf(context, result, verification),
    headlinesRead: context.evidence.headlinesRead,
    caveats: [...context.evidence.caveats, ...caveats],
    unverifiedClaims: unverified,
    ...(broken === undefined ? {} : { invalidatedPrior: broken }),
  }
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

function degraded(context: DebateContext, caveat: Caveat): DebateOutcome {
  return hold(
    'debate-unresolved',
    [...context.evidence.caveats, caveat],
    context.evidence.headlinesRead
  )
}

function hold(
  reasonCode: HoldReasonCode,
  caveats: readonly Caveat[],
  headlinesRead: HeadlinesRead
): Extract<DebateOutcome, { readonly kind: 'hold' }> {
  return { kind: 'hold', reasonCode, caveats, headlinesRead }
}
