import type { ChannelRenderer } from '@/channels/types'
import type { Locale } from '@/core/types/locale'
import type { LLMUsageTotals } from '@/core/types/usage'
import type { FooterDetails } from '@/core/utils/footer'
import type { ResearchProgress, ResearchTotalsProgress, RunResult, TodoStep } from '@/engine/api'
import { BRAND } from '@/core/brand'
import { ChannelError, failureSpecOf, RUN_FAILURE_SPEC } from '@/core/errors'
import { failureHintParams } from '@/core/limits'
import { formatLongDuration } from '@/core/utils/duration'
import { formatRunFooter } from '@/core/utils/footer'
import { sanitizeDisplayText, toSingleLine } from '@/core/utils/text'
import {
  toPlanSteps,
  toResearchIssueGroups,
  toResearchQuestionProgressDisplay,
  toResearchStageDisplay,
  toResearchStartDisplay,
  toResearchTotalsDisplays,
  toResearchWarningDisplay,
} from '@/engine/api'
import { bindLocale, runCompletionMessage, t, translateDisplayText } from '@/i18n'

const FOOTER_GAP = '\n\n'
const HUD_CONTINUATION_INDENT = '  '
const PLAN_STEP_INDENT = '   '
const RESEARCH_QUESTION_SLOT_PREFIX = 'question:'
const BLOCK_BREAK_LENGTH = 2
const HIGH_SURROGATE_MIN = 0xd800
const HIGH_SURROGATE_MAX = 0xdbff

type LiveRunStatus = 'running' | 'success' | 'failure'

interface ToolDisplay {
  readonly label: string
  readonly emoji?: string
  readonly detail?: string
}

export interface HudPlan {
  readonly display: ToolDisplay
  readonly steps: readonly TodoStep[]
}

export interface LiveRunHudTool extends ToolDisplay {
  readonly progress?: string
  readonly persistentProgress?: readonly string[]
  readonly status: LiveRunStatus
}

export interface LiveRunHud {
  readonly elapsedMs: number
  readonly tools: readonly LiveRunHudTool[]
  readonly milestones: readonly string[]
}

type ResearchMilestoneKind = 'start' | 'plan' | 'question' | 'stage' | 'warning' | 'totals'

export interface ResearchMilestone {
  readonly kind: ResearchMilestoneKind
  readonly slot: string
  readonly text: string
}

interface ChunkResearchMilestoneInput {
  readonly renderer: ChannelRenderer
  readonly maxLen: number
  readonly locale: Locale
  readonly text: string
}

type QuestionProgressParams = Extract<
  ResearchProgress,
  { readonly key: 'progress.researchQuestion' }
>['params']
type StageProgressParams = Extract<
  ResearchProgress,
  { readonly key: 'progress.researchStage' }
>['params']
interface LiveRunHudRenderOptions {
  readonly hud: LiveRunHud
  readonly renderer: ChannelRenderer
  readonly maxLen: number
  readonly locale: Locale
}

export function chunkText(text: string, maxLen: number): string[] {
  if (maxLen <= 0) {
    throw new ChannelError('edit_failed', 'chunk maxLen must be positive')
  }

  if (text.length <= maxLen) {
    return [text]
  }

  const chunks: string[] = []
  let pos = 0

  while (pos < text.length) {
    const cut = cutPoint(text, pos, maxLen)
    chunks.push(text.slice(pos, cut))
    pos = cut
  }

  return chunks
}

export function renderLiveRunHud(options: LiveRunHudRenderOptions): readonly string[] {
  const { hud, locale } = options
  const lines = [
    `${t(locale, 'ui.hudElapsed')}: ${formatElapsed(hud.elapsedMs)}`,
    ...hud.tools.flatMap((tool) => renderToolLines(tool)),
    ...hud.milestones.flatMap((milestone) => toHudLines(milestone)),
  ]
  const plain = lines.join('\n')

  return options.renderer.chunk(plain, Math.max(1, options.maxLen))
}

function renderToolLines(tool: LiveRunHudTool): string[] {
  const detail = tool.progress ?? tool.detail
  const planStatus = detail === undefined ? undefined : toPlanStatus(detail)

  if (planStatus !== undefined) {
    return [`${statusGlyph(tool.status)} ${toolDisplayOf(tool, planStatus)}`]
  }

  // A leading newline marks a block (a checklist): it renders under the tool line, never inline.
  const isBlock = detail === undefined || detail.startsWith('\n')
  const detailLines = detail === undefined ? [] : toHudLines(detail)
  const inlineDetail = isBlock ? undefined : detailLines[0]
  const display = toolDisplayOf(tool, inlineDetail)
  const continuation = [
    ...(isBlock ? detailLines : detailLines.slice(1)),
    ...(tool.persistentProgress ?? []).flatMap((line) => toHudLines(line)),
  ]

  return [
    `${statusGlyph(tool.status)} ${display}`,
    ...continuation.map((line) => `${HUD_CONTINUATION_INDENT}${line}`),
  ]
}

/** The plan block is delivered with the answer, so the preview keeps only its live line. */
function toPlanStatus(detail: string): string | undefined {
  const steps = toPlanSteps(detail)

  if (steps === undefined) {
    return undefined
  }

  const counter = detail.slice(0, detail.indexOf('\n')).trim()
  const active = steps.find((step) => step.status === 'in_progress')

  return active === undefined ? counter : `${counter} · ${safeHudValue(active.text)}`
}

export function formatPlanBlock(plan: HudPlan): string {
  const width = String(plan.steps.length).length
  const lines = plan.steps.map(
    (step, index) =>
      `${PLAN_STEP_INDENT}${String(index + 1).padStart(width)}. ${safeHudValue(step.text)}`
  )

  return [formatToolDisplay(plan.display), ...lines].join('\n')
}

function toolDisplayOf(tool: LiveRunHudTool, detail: string | undefined): string {
  return formatToolDisplay({
    label: tool.label,
    ...(tool.emoji === undefined ? {} : { emoji: tool.emoji }),
    ...(detail === undefined ? {} : { detail }),
  })
}

/** The one channel-side rendering of a tool call. */
export function formatToolDisplay(display: ToolDisplay): string {
  const emoji = display.emoji === undefined ? '' : `${display.emoji} `
  const suffix = display.detail === undefined ? '' : `: ${safeHudValue(display.detail)}`

  return `${emoji}${safeHudValue(display.label)}${suffix}`
}

function toHudLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => safeHudValue(line))
    .filter((line) => line !== '')
}

// Sanitize before single-lining: an ANSI run whose ESC is already a space no longer matches.
function safeHudValue(value: string): string {
  return toSingleLine(sanitizeDisplayText(value)).trim()
}

function formatElapsed(elapsedMs: number): string {
  const boundedMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0

  return `${(boundedMs / 1_000).toFixed(1)}s`
}

function statusGlyph(status: LiveRunStatus): string {
  if (status === 'running') {
    return '▶'
  }

  return status === 'success' ? '✓' : '✗'
}

function cutPoint(text: string, pos: number, maxLen: number): number {
  if (maxLen <= 0) {
    throw new ChannelError('edit_failed', 'chunk maxLen must be positive')
  }

  const end = cutByUtf16Units(text, pos, maxLen)
  // A blank line separates whole sections, so cutting there keeps a section intact across messages.
  // A section longer than the limit falls through to the line break, then to the hard cut, so no
  // input can fail to advance.
  // The pair must end by `end`: a start at end - 1 would put the cut one unit past the limit.
  const lastBlockBreak = text.lastIndexOf('\n\n', end - BLOCK_BREAK_LENGTH)

  if (lastBlockBreak > pos) {
    return lastBlockBreak + BLOCK_BREAK_LENGTH
  }

  const lastBreak = text.lastIndexOf('\n', end - 1)

  return lastBreak > pos ? lastBreak + 1 : end
}

// Chat length limits count UTF-16 code units (exactly JS `String.length`), not code points: an
// astral character such as an emoji spends two of them. Backs off one unit rather than cutting a
// surrogate pair in half.
export function cutByUtf16Units(text: string, pos: number, maxLen: number): number {
  const end = Math.min(text.length, pos + maxLen)

  if (end >= text.length) {
    return text.length
  }

  const code = text.charCodeAt(end - 1)

  return code >= HIGH_SURROGATE_MIN && code <= HIGH_SURROGATE_MAX ? end - 1 : end
}

export function formatRunResultBody(result: RunResult, locale: Locale): string {
  if (result.completionCode !== undefined) {
    return runCompletionMessage(locale, result.completionCode, result.model ?? '')
  }

  if (result.reason === 'completed') {
    return result.text.trim() || t(locale, 'ui.noContent')
  }

  const failure = failureSpecOf(result) ?? RUN_FAILURE_SPEC[result.reason]
  const message =
    result.operator === undefined
      ? t(locale, failure.messageKey, { brand: BRAND.name })
      : bindLocale(locale).translate(result.operator.key, result.operator.params)
  const hintText =
    'hintKey' in failure && result.operator === undefined
      ? `\n${t(locale, failure.hintKey, failureHintParams(BRAND.name, result.limits))}`
      : ''

  // A partial answer is still worth showing: the localized failure line explains why it stops there.
  return result.text.trim()
    ? `${result.text.trim()}\n\n${message}${hintText}`
    : `${message}${hintText}`
}

export function formatChannelFooter(
  locale: Locale,
  totals: LLMUsageTotals,
  details: FooterDetails
): string {
  return formatRunFooter({
    locale,
    translate: (key, values) => t(locale, key, values),
    totals,
    details,
  })
}

/** One separator wherever a footer follows a body, chunked or not. */
export function joinFooter(body: string, footer: string): string {
  return `${body}${FOOTER_GAP}${footer}`
}

/** The text before the footer `joinFooter` put after the last gap. */
export function stripFooter(text: string): string {
  const gap = text.lastIndexOf(FOOTER_GAP)

  return gap < 0 ? text : text.slice(0, gap)
}

/** Keeps the footer on the last body chunk while it fits, so it is never cut in half. */
export function buildFooterChunks(
  bodyChunks: readonly string[],
  footer: string,
  maxLen: number
): readonly string[] {
  const last = bodyChunks.at(-1)

  if (last === undefined) {
    return [footer]
  }

  const glued = joinFooter(last, footer)

  return glued.length <= maxLen ? [...bodyChunks.slice(0, -1), glued] : [...bodyChunks, footer]
}

export function toResearchMilestone(
  event: ResearchProgress,
  locale: Locale
): ResearchMilestone | undefined {
  const milestone = toMilestoneText(event, locale)

  return milestone === undefined
    ? undefined
    : { ...milestone, text: sanitizeDisplayText(milestone.text) }
}

function toMilestoneText(event: ResearchProgress, locale: Locale): ResearchMilestone | undefined {
  switch (event.key) {
    case 'progress.researchStart':
      return {
        kind: 'start',
        slot: 'start',
        text: translateDisplayText(locale, toResearchStartDisplay(event.params.depth)),
      }
    case 'progress.researchPlan':
      return {
        kind: 'plan',
        slot: 'plan',
        text: planMilestoneText(event.params.questions, locale),
      }
    case 'progress.researchQuestion':
      return questionMilestone(event.params, locale)
    case 'progress.researchStage':
      return stageMilestone(event.params, locale)
    case 'progress.researchWarning':
      return {
        kind: 'warning',
        slot: `warning:${event.params.code}`,
        text: translateDisplayText(
          locale,
          toResearchWarningDisplay(event.params.code, event.params.values)
        ),
      }
    case 'progress.researchTotals':
      return {
        kind: 'totals',
        slot: 'totals',
        text: totalsMilestoneText(event.params, locale),
      }
  }
}

function formatResearchQuestionText(question: QuestionProgressParams, locale: Locale): string {
  return translateDisplayText(locale, toResearchQuestionProgressDisplay(question))
}

export function toResearchQuestionSlot(questionId: string): string {
  return `${RESEARCH_QUESTION_SLOT_PREFIX}${questionId}`
}

function planMilestoneText(questions: readonly string[], locale: Locale): string {
  const lines = [
    t(locale, 'cli.researchPlanReview', { total: questions.length }),
    ...questions.map((question, index) =>
      t(locale, 'cli.researchPlanItem', { index: index + 1, question: safeHudValue(question) })
    ),
  ]

  return lines.join('\n')
}

function questionMilestone(params: QuestionProgressParams, locale: Locale): ResearchMilestone {
  return {
    kind: 'question',
    slot: toResearchQuestionSlot(params.questionId),
    text: formatResearchQuestionText(params, locale),
  }
}

function stageMilestone(params: StageProgressParams, locale: Locale): ResearchMilestone {
  return {
    kind: 'stage',
    slot: `stage:${params.stage}`,
    text: translateDisplayText(
      locale,
      toResearchStageDisplay(params.stage, params.state, params.detail)
    ),
  }
}

function totalsMilestoneText(params: ResearchTotalsProgress, locale: Locale): string {
  const totals = [
    ...toResearchTotalsDisplays(params).map((display) => translateDisplayText(locale, display)),
    t(locale, 'progress.researchElapsed', {
      elapsed: formatLongDuration(locale, params.elapsedMs),
    }),
  ]
  const issueLines = toResearchIssueGroups(params.issues).flatMap((group) => [
    translateDisplayText(locale, group.summary),
    ...group.issues.map((issue) =>
      t(locale, 'progress.researchGapItem', {
        issue: translateDisplayText(locale, issue.display),
        count: issue.count,
      })
    ),
  ])

  return [...totals, ...issueLines, ...outcomeLines(params, locale)].join('\n')
}

function outcomeLines(params: ResearchTotalsProgress, locale: Locale): readonly string[] {
  const outcome = translateDisplayText(locale, params.outcome)
  const line =
    params.evidenceLevel === undefined
      ? t(locale, 'progress.researchOutcomeStopped', { outcome })
      : t(locale, 'progress.researchOutcomeComplete', {
          outcome,
          evidenceLevel: translateDisplayText(locale, params.evidenceLevel),
        })

  return params.action === undefined
    ? [line]
    : [
        line,
        t(locale, 'progress.researchAction', {
          action: translateDisplayText(locale, params.action),
        }),
      ]
}

// A milestone longer than one message continues through the overflow path; every chunk lands.
export function chunkResearchMilestone(input: ChunkResearchMilestoneInput): string[] {
  const continuation = t(input.locale, 'channel.researchContinued')
  // Prepended to an already-chunked piece, so it carries its own escaping.
  const prefix = `${input.renderer.escape(continuation)}\n`
  const bodyMaxLen = input.maxLen - prefix.length

  if (bodyMaxLen <= 0) {
    throw new ChannelError('send_failed', 'channel maxTextLen cannot fit research continuation')
  }

  const chunks = input.renderer.chunk(input.text, bodyMaxLen)
  return chunks.map((chunk, index) => (index === 0 ? chunk : prefix + chunk))
}
