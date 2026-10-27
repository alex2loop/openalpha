import type { TerminalInput } from '@/cli/terminal'
import type { PromptFn } from '@/cli/ui/prompt'
import type { Locale } from '@/core/types/locale'
import type { ResearchPlan, ResearchPlanDecision, ResearchPlanReview } from '@/engine/api'
import { currentTerminal } from '@/cli/terminal'
import { formatUsd } from '@/core/utils/cost'
import { formatDuration } from '@/core/utils/duration'
import { RESEARCH_FRESHNESS_FIELD_KEYS } from '@/engine/api'
import { t } from '@/i18n'

import { selectPlanAction } from './plan-select'

const COMPLEXITY_KEYS = {
  simple: 'cli.researchPlanComplexitySimple',
  standard: 'cli.researchPlanComplexityStandard',
  complex: 'cli.researchPlanComplexityComplex',
} as const satisfies Record<
  ResearchPlanReview['effort']['complexity'],
  | 'cli.researchPlanComplexitySimple'
  | 'cli.researchPlanComplexityStandard'
  | 'cli.researchPlanComplexityComplex'
>

interface CliPlanReviewerDeps {
  readonly prompt: PromptFn
  readonly locale: Locale
  readonly write: (line: string) => void
  readonly pause: () => void
  readonly resume: () => void
}

/** Builds a `ReviewResearchPlan` callback that drives the interactive plan prompt. */
export function createCliPlanReviewer(
  deps: CliPlanReviewerDeps
): (input: ResearchPlanReview) => Promise<ResearchPlanDecision> {
  const { stdin } = currentTerminal()

  return async (input) => runPlanReview(deps, stdin, input)
}

async function runPlanReview(
  deps: CliPlanReviewerDeps,
  stdin: TerminalInput,
  input: ResearchPlanReview
): Promise<ResearchPlanDecision> {
  deps.pause()
  printPlan(deps, input)

  try {
    const outcome = await selectPlanAction({
      locale: deps.locale,
      input: stdin,
      signal: input.signal,
      write: deps.write,
      canEdit: input.canEdit,
      prompt: deps.prompt,
    })

    if (outcome.kind === 'start') {
      return { kind: 'start' }
    }
    if (outcome.kind === 'cancel' || input.signal.aborted) {
      return { kind: 'cancel' }
    }

    return { kind: 'edit', instruction: outcome.instruction }
  } finally {
    deps.resume()
  }
}

function printPlan(deps: CliPlanReviewerDeps, input: ResearchPlanReview): void {
  deps.write(t(deps.locale, 'cli.researchPlanReview', { total: input.plan.questions.length }))
  printObjective(deps, input)
  printQuestions(deps, input.plan)
}

function printObjective(deps: CliPlanReviewerDeps, input: ResearchPlanReview): void {
  const assumptions = input.objective.assumptions.join(' · ')
  const { effort, limits } = input

  deps.write(
    t(deps.locale, 'cli.researchPlanOriginalObjective', { value: input.objective.original })
  )
  deps.write(
    t(deps.locale, 'cli.researchPlanNormalizedObjective', { value: input.objective.normalized })
  )
  deps.write(
    t(deps.locale, 'cli.researchPlanDimensions', {
      value: input.objective.dimensions.join(' · '),
    })
  )
  deps.write(
    t(deps.locale, 'cli.researchPlanAssumptions', {
      value: assumptions === '' ? t(deps.locale, 'cli.researchPlanNone') : assumptions,
    })
  )
  deps.write(
    t(deps.locale, 'cli.researchPlanFreshness', {
      value: freshnessText(deps.locale, input.objective.freshness),
    })
  )
  deps.write(
    t(deps.locale, 'cli.researchPlanComplexity', {
      value: complexityText(deps.locale, effort.complexity),
    })
  )
  deps.write(
    t(deps.locale, 'cli.researchPlanMaxDuration', {
      value: formatDuration(deps.locale, limits.maxDurationMs),
    })
  )
  deps.write(t(deps.locale, 'cli.researchPlanQuestionLimit', { value: limits.maxQuestions }))
  deps.write(t(deps.locale, 'cli.researchPlanReviewRounds', { value: limits.maxReviewRounds }))
  deps.write(
    t(deps.locale, 'cli.researchPlanRemainingCost', {
      value: remainingCostText(deps.locale, limits.remainingCostUsd),
    })
  )
  deps.write(
    t(deps.locale, 'cli.researchPlanBranchBudgetWeight', {
      value: `${Math.round(effort.branchBudgetWeight * 100)}%`,
    })
  )
}

function remainingCostText(locale: Locale, remainingCostUsd: number): string {
  return Number.isFinite(remainingCostUsd)
    ? formatUsd(remainingCostUsd)
    : t(locale, 'cli.researchPlanUncappedCost')
}

function printQuestions(deps: CliPlanReviewerDeps, plan: ResearchPlan): void {
  for (const [index, question] of plan.questions.entries()) {
    deps.write(
      t(deps.locale, 'cli.researchPlanItem', {
        index: index + 1,
        question: question.question,
      })
    )
  }
}

function freshnessText(
  locale: Locale,
  freshness: ResearchPlanReview['objective']['freshness']
): string {
  if (freshness === undefined) {
    return t(locale, 'cli.researchPlanNone')
  }

  const field = t(locale, RESEARCH_FRESHNESS_FIELD_KEYS[freshness.field])
  const from =
    freshness.fromOn === undefined
      ? []
      : [t(locale, 'cli.researchPlanFreshnessFrom', { value: freshness.fromOn })]
  const to =
    freshness.toOn === undefined
      ? []
      : [t(locale, 'cli.researchPlanFreshnessTo', { value: freshness.toOn })]

  return [field, ...from, ...to].join(' · ')
}

function complexityText(
  locale: Locale,
  complexity: ResearchPlanReview['effort']['complexity']
): string {
  return t(locale, COMPLEXITY_KEYS[complexity])
}
