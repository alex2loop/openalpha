import type { Locale } from '@/core/types/locale'
import type {
  ResearchIssueGroup,
  ResearchPhase,
  ResearchProgress,
  ResearchTotalsProgress,
} from '@/engine/api'
import { isInteractiveStdout, isVerbose } from '@/cli/env'
import { formatLongDuration } from '@/core/utils/duration'
import { sanitizeDisplayText } from '@/core/utils/text'
import {
  toResearchIssueGroups,
  toResearchQuestionProgressDisplay,
  toResearchStageDisplay,
  toResearchStartDisplay,
  toResearchTotalsDisplays,
  toResearchWarningDisplay,
} from '@/engine/api'
import { t, translateDisplayText } from '@/i18n'

import {
  type ActivityDisplay,
  createActivityDisplay,
  questionKey,
  type ResearchProgressOutput,
  STATUS_KEY,
} from './progress-display'

type ResearchVerbosity = 'off' | 'on' | 'full'

type StartParams = Extract<ResearchProgress, { readonly key: 'progress.researchStart' }>['params']
type PlanParams = Extract<ResearchProgress, { readonly key: 'progress.researchPlan' }>['params']
type StageParams = Extract<ResearchProgress, { readonly key: 'progress.researchStage' }>['params']
type QuestionParams = Extract<
  ResearchProgress,
  { readonly key: 'progress.researchQuestion' }
>['params']

// Resolved once at the consumer: JSON suppresses all progress; `on` renders the plan card, stages
// (+ detail), per-question stats, totals, warnings, and running search/fetch activity; `full`
// additionally surfaces activity completions and retrieval detail. No other verbosity owner exists.
export function resolveResearchVerbosity(format: 'text' | 'json'): ResearchVerbosity {
  if (format === 'json') {
    return 'off'
  }
  return isVerbose() ? 'full' : 'on'
}

export interface ResearchProgressRenderer {
  report(message: ResearchProgress): void
  pause(): void
  resume(): void
  close(): void
}

interface ResearchProgressStats {
  questionTotal: number
  terminalQuestionCount: number
  currentStage: ResearchPhase | undefined
  readonly activityCounts: { search: number; fetch: number }
}

interface QuestionState {
  readonly index: number
  readonly total: number
  readonly state: 'running' | 'complete' | 'failed'
}

interface RenderContext {
  readonly display: ActivityDisplay
  readonly locale: Locale
  readonly stats: ResearchProgressStats
  readonly questions: Map<string, QuestionState>
}

interface ResearchProgressRendererOptions {
  readonly output: ResearchProgressOutput
  readonly locale: Locale
  readonly verbosity: ResearchVerbosity
}

export function createResearchProgressRenderer(
  options: ResearchProgressRendererOptions
): ResearchProgressRenderer {
  const stats: ResearchProgressStats = {
    questionTotal: 0,
    terminalQuestionCount: 0,
    currentStage: undefined,
    activityCounts: { search: 0, fetch: 0 },
  }
  const display = createActivityDisplay(options.output, options.locale, () => ({
    crawlActive: stats.currentStage === 'crawl',
    questionTotal: stats.questionTotal,
    terminalQuestionCount: stats.terminalQuestionCount,
    searchCount: stats.activityCounts.search,
    fetchCount: stats.activityCounts.fetch,
    showCancelHint: isInteractiveStdout(),
  }))
  const ctx: RenderContext = {
    display,
    locale: options.locale,
    stats,
    questions: new Map(),
  }

  return {
    report: (message) => renderMessage(ctx, options.verbosity, message),
    pause: display.pause,
    resume: display.resume,
    close() {
      ctx.questions.clear()
      display.close()
    },
  }
}

function renderMessage(
  ctx: RenderContext,
  verbosity: ResearchVerbosity,
  message: ResearchProgress
): void {
  if (verbosity === 'off') {
    return
  }

  switch (message.key) {
    case 'progress.researchStart':
      renderStart(ctx, message.params)
      return
    case 'progress.researchPlan':
      renderPlan(ctx, message.params)
      return
    case 'progress.researchStage':
      renderStage(ctx, message.params)
      return
    case 'progress.researchQuestion':
      renderQuestion(ctx, message.params)
      return
    case 'progress.researchTotals':
      renderTotals(ctx, message.params)
      return
    case 'progress.researchWarning':
      ctx.display.printPersistent(
        sanitizeDisplayText(
          translateDisplayText(
            ctx.locale,
            toResearchWarningDisplay(message.params.code, message.params.values)
          )
        )
      )
      return
  }
}

function renderStart(ctx: RenderContext, params: StartParams): void {
  ctx.display.printPersistent(
    sanitizeDisplayText(translateDisplayText(ctx.locale, toResearchStartDisplay(params.depth)))
  )
}

function renderPlan(ctx: RenderContext, params: PlanParams): void {
  ctx.display.printPersistent(
    sanitizeDisplayText(t(ctx.locale, 'cli.researchPlanReview', { total: params.questions.length }))
  )

  for (const [index, question] of params.questions.entries()) {
    ctx.display.printPersistent(
      sanitizeDisplayText(t(ctx.locale, 'cli.researchPlanItem', { index: index + 1, question }))
    )
  }
}

function renderStage(ctx: RenderContext, params: StageParams): void {
  const label = sanitizeDisplayText(
    translateDisplayText(
      ctx.locale,
      toResearchStageDisplay(params.stage, params.state, params.detail)
    )
  )
  ctx.stats.currentStage = params.state === 'running' ? params.stage : undefined

  if (params.state === 'running') {
    ctx.display.set(STATUS_KEY, label)
    return
  }

  ctx.display.remove(STATUS_KEY)
  if (params.state === 'complete' || params.state === 'failed') {
    ctx.display.printPersistent(label)
  }
}

function renderQuestion(ctx: RenderContext, params: QuestionParams): void {
  const previous = ctx.questions.get(params.questionId)
  ctx.questions.set(params.questionId, {
    index: params.index,
    total: params.total,
    state: params.state,
  })
  ctx.stats.questionTotal = params.total
  countQuestionOperation(ctx.stats, params)

  if (params.state !== 'running' && (previous === undefined || previous.state === 'running')) {
    ctx.stats.terminalQuestionCount += 1
  }

  const text = sanitizeDisplayText(
    translateDisplayText(ctx.locale, toResearchQuestionProgressDisplay(params))
  )

  if (params.state === 'running') {
    ctx.display.set(questionKey(params.questionId), text)
    return
  }

  ctx.display.remove(questionKey(params.questionId))
  ctx.display.printPersistent(text)
}

// Each running event that names an operation is one started search or page read: the status-line
// counters have no separate activity stream to tally any more.
function countQuestionOperation(stats: ResearchProgressStats, params: QuestionParams): void {
  if (params.state !== 'running' || params.operation === undefined) {
    return
  }

  stats.activityCounts[params.operation] += 1
}

function renderTotals(ctx: RenderContext, params: ResearchTotalsProgress): void {
  ctx.display.clearKeyed()
  for (const display of toResearchTotalsDisplays(params)) {
    ctx.display.printPersistent(translateDisplayText(ctx.locale, display))
  }
  ctx.display.printPersistent(
    t(ctx.locale, 'progress.researchElapsed', {
      elapsed: formatLongDuration(ctx.locale, params.elapsedMs),
    })
  )

  for (const group of toResearchIssueGroups(params.issues)) {
    renderIssueGroup(ctx, group)
  }
  renderOutcome(ctx, params)
}

function renderIssueGroup(ctx: RenderContext, group: ResearchIssueGroup): void {
  ctx.display.printPersistent(translateDisplayText(ctx.locale, group.summary))
  for (const issue of group.issues) {
    ctx.display.printPersistent(
      t(ctx.locale, 'progress.researchGapItem', {
        issue: translateDisplayText(ctx.locale, issue.display),
        count: issue.count,
      })
    )
  }
}

function renderOutcome(ctx: RenderContext, params: ResearchTotalsProgress): void {
  const outcome = translateDisplayText(ctx.locale, params.outcome)
  const line =
    params.evidenceLevel === undefined
      ? t(ctx.locale, 'progress.researchOutcomeStopped', { outcome })
      : t(ctx.locale, 'progress.researchOutcomeComplete', {
          outcome,
          evidenceLevel: translateDisplayText(ctx.locale, params.evidenceLevel),
        })

  ctx.display.printPersistent(sanitizeDisplayText(line))
  if (params.action !== undefined) {
    ctx.display.printPersistent(
      sanitizeDisplayText(
        t(ctx.locale, 'progress.researchAction', {
          action: translateDisplayText(ctx.locale, params.action),
        })
      )
    )
  }
}
