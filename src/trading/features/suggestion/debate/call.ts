import type { ProviderChain } from '@/core/llm'
import type { Budget } from '@/core/types/budget'
import type { AttemptRecorder } from '@/engine/api'
import type { OpposedCases } from '@/trading/features/suggestion/debate/debate-prompts'
import type { PlaybookLibrary } from '@/trading/features/suggestion/debate/playbook'
import type {
  RolePrompt,
  RoleRunDeps,
  RoleRunResult,
  RoleSchema,
} from '@/trading/features/suggestion/debate/roles'
import type { RoleOutputListener } from '@/trading/features/suggestion/debate/types'
import type { EvidenceBundle } from '@/trading/features/suggestion/pipeline/evidence'
import type { DebateInput, SuggestionSink } from '@/trading/features/suggestion/pipeline/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { DebateMode, DebateRole } from '@/trading/kernel/config'
import type { Market, MarketRegistry } from '@/trading/markets/types'
import { casePrompt } from '@/trading/features/suggestion/debate/debate-prompts'
import { renderPlaybook, rolePlaybook } from '@/trading/features/suggestion/debate/playbook'
import { runRole } from '@/trading/features/suggestion/debate/roles'
import {
  BEAR_CASE_SCHEMA,
  BULL_CASE_SCHEMA,
  toResearchCase,
} from '@/trading/features/suggestion/pipeline/schemas'
import { DEBATE_MODE_ROLES, DEBATE_MODE_WAVES } from '@/trading/kernel/config'

export interface DebateDeps extends RoleRunDeps {
  readonly markets: MarketRegistry
  readonly store: SuggestionSink
  /** Every skill body, so a role's methods are prepended to its prompt rather than fetched. */
  readonly playbooks: PlaybookLibrary
  /** The `decisions` model tier, when the operator configured one. Absent turns the headline read
   *  off, which is a feed-order split rather than a failure. */
  readonly decisionsChain: ProviderChain | undefined
  /** Bills the headline read's model calls to the same ledger and caps as the debate's. */
  readonly recordAttempt: AttemptRecorder
  /** Told what each role said once the debate is verified. */
  readonly onRoleOutput: RoleOutputListener
}

export interface DebateContext {
  readonly deps: DebateDeps
  readonly input: DebateInput
  readonly evidence: EvidenceBundle
  readonly budgets: readonly Budget[]
  readonly signal: AbortSignal
  /** Resolved once, because every role's playbook and the stored record both read its manifest. */
  readonly market: Market
  /** Every chat model that answered a role in this run. One collector per run, filled by `call`
   *  because every role passes through it, so no intermediate result type has to carry the name. */
  readonly models: Set<string>
}

interface RoleCall<T> {
  readonly role: DebateRole
  readonly schema: RoleSchema<T>
  prompt(): RolePrompt
}

/** A role's budget is the slice at its position in the mode's role list, which is the same order
 *  the caller sliced them in. */
export function call<T>(context: DebateContext, spec: RoleCall<T>): Promise<RoleRunResult<T>> {
  const { role, schema } = spec
  const mode = context.input.depth.mode
  const roles: readonly DebateRole[] = DEBATE_MODE_ROLES[mode]
  const budget = context.budgets[roles.indexOf(role)]

  if (budget === undefined) {
    return Promise.resolve({
      kind: 'failed',
      caveat: { code: 'suggestion.debate-degraded', detail: { role, cause: 'no-budget-slice' } },
    })
  }

  reportWave(context, mode, role)
  const prompt = spec.prompt()

  return runRole(context.deps, {
    role,
    schema,
    budget,
    prompt: {
      instructions: renderPlaybook(
        rolePlaybook(role, context.market.manifest, context.input.draft.instrumentKind),
        context.deps.playbooks,
        prompt.instructions
      ),
      message: prompt.message,
    },
    routingKey: `${role}:${context.market.manifest.id}`,
    request: context.input.request,
    signal: context.signal,
  }).then((result) => recordModel(context, result))
}

/** The one funnel every role passes through is the one place that names the model that answered. */
function recordModel<T>(context: DebateContext, result: RoleRunResult<T>): RoleRunResult<T> {
  if (result.kind === 'value' && result.modelName !== undefined) {
    context.models.add(result.modelName)
  }

  return result
}

/** A role paints its wave, not itself: the roles in a wave start together and finish apart, so a
 *  line naming the one that started last goes stale while a sibling is still working, and a number
 *  counting roles runs backwards. The wave is neither, and the surface shows one transient line. */
function reportWave(context: DebateContext, mode: DebateMode, role: DebateRole): void {
  const waves = DEBATE_MODE_WAVES[mode]
  const step = waves.findIndex((plan) => plan.roles.some((name) => name === role))
  const current = waves[step]

  if (current === undefined) {
    return
  }

  context.input.request.progress?.(`trading.progress.debate.${current.wave}`, {
    ticker: context.input.request.ticker,
    step: step + 1,
    total: waves.length,
  })
}

/** Bull and bear run concurrently under one locally owned controller combined with the parent
 *  signal. Aborting in `finally` settles the sibling on every path — success, failure, and caller
 *  abort — because rejecting without it leaves an in-flight LLM call billing against a dead run. */
export async function runOpposedCases(
  context: DebateContext
): Promise<RoleRunResult<OpposedCases>> {
  const controller = new AbortController()
  const signal = AbortSignal.any([context.signal, controller.signal])
  const scoped: DebateContext = { ...context, signal }

  try {
    const [bull, bear] = await Promise.all([
      call(scoped, {
        role: 'bull-researcher',
        schema: BULL_CASE_SCHEMA,
        prompt: () => casePrompt(context, 'bull-researcher'),
      }).then(failFast(controller)),
      call(scoped, {
        role: 'bear-researcher',
        schema: BEAR_CASE_SCHEMA,
        prompt: () => casePrompt(context, 'bear-researcher'),
      }).then(failFast(controller)),
    ])

    if (bull.kind === 'failed') {
      // `failFast` cancels the sibling, so an aborted arm is the victim: when both failed, the one
      // that was not aborted is what explains the run.
      return bear.kind === 'failed' && isAbortedFailure(bull.caveat) ? bear : bull
    }

    return bear.kind === 'failed'
      ? bear
      : {
          kind: 'value',
          value: { bull: toResearchCase(bull.value), bear: toResearchCase(bear.value) },
        }
  } finally {
    controller.abort()
  }
}

/** Aborts the sibling as soon as one branch fails, so the other stops burning its slice. */
export function failFast<T>(
  controller: AbortController
): (result: RoleRunResult<T>) => RoleRunResult<T> {
  return (result) => {
    if (result.kind === 'failed') {
      controller.abort()
    }

    return result
  }
}

export function isAbortedFailure(caveat: Caveat): boolean {
  return caveat.detail?.cause === 'aborted'
}
