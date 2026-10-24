import type { HeadlinesRead } from '@/trading/features/suggestion/citation'
import type { DebateContext, DebateDeps } from '@/trading/features/suggestion/debate/call'
import type { SelectedClaims, VerifiedClaims } from '@/trading/features/suggestion/debate/outcome'
import type { RoleRunResult } from '@/trading/features/suggestion/debate/roles'
import type {
  PortfolioManagerDecision,
  RiskDecision,
  TradePlan,
} from '@/trading/features/suggestion/debate/types'
import type { DebateOutcome, RunDebate } from '@/trading/features/suggestion/pipeline/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { LeanDebateReason } from '@/trading/kernel/config'
import {
  call,
  failFast,
  isAbortedFailure,
  runOpposedCases,
} from '@/trading/features/suggestion/debate/call'
import {
  casesClaims,
  claimAt,
  claimsOf,
  firedInvalidators,
  materialClaims,
  toInvalidators,
} from '@/trading/features/suggestion/debate/claims'
import {
  analystPrompt,
  managerPrompt,
  riskPrompt,
  traderPrompt,
  verifierPrompt,
} from '@/trading/features/suggestion/debate/debate-prompts'
import { buildHistoryBlock } from '@/trading/features/suggestion/debate/history'
import { finish, hold } from '@/trading/features/suggestion/debate/outcome'
import { toTradePlan } from '@/trading/features/suggestion/debate/trade-plan'
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
  const claims = claimsOf('market-analyst', analystCase)
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

function degraded(context: DebateContext, caveat: Caveat): DebateOutcome {
  return hold(
    'debate-unresolved',
    [...context.evidence.caveats, caveat],
    context.evidence.headlinesRead
  )
}
