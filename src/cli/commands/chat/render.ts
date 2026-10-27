import type { CliApp } from '@/cli/types'
import type { StreamEvent } from '@/core/stream-events'
import type { Locale } from '@/core/types/locale'
import type { LLMUsageTotals } from '@/core/types/usage'
import type { FooterDetails } from '@/core/utils/footer'
import { isUnicode, isVerbose, resolveTerminalPolicy } from '@/cli/env'
import { colors, icons, style } from '@/cli/ui/colors'
import { formatCliFooter } from '@/cli/ui/footer'
import { createMarkdownStream } from '@/cli/ui/markdown'
import { createPlanView } from '@/cli/ui/plan'
import { createSpinner } from '@/cli/ui/spinner'
import { isPersistentProgress } from '@/core/stream-events'
import { sanitizeDisplayText } from '@/core/utils/text'
import { MS_PER_SECOND } from '@/core/utils/time'
import { t, translateDisplayText, translateToolError, translateToolLabel } from '@/i18n'

/** Below this a call reads as instant and the number is noise; above it the reader is trying to
 *  work out where a slow turn went. */
const SLOW_TOOL_CALL_MS = 3_000

type ToolExecutionStart = Extract<StreamEvent, { readonly type: 'tool_execution_start' }>
type ToolResult = Extract<StreamEvent, { readonly type: 'tool_result' }>

interface ToolDisplay {
  readonly label: string
  readonly emoji: string | undefined
  readonly detail: string | undefined
}

type TurnMetric = Extract<StreamEvent, { readonly type: 'turn_metric' }>

export interface StreamPrinter {
  onChunk(event: StreamEvent): void
  latestMetric(): TurnMetric | undefined
  /** Stops the spinner and closes any open answer block so a prompt owns the terminal. */
  pause(): void
  /** Restarts the activity spinner after a pause; no-op once ended. */
  resume(): void
  /** Closes the answer block and spinner. Idempotent. */
  end(): void
}

interface RenderState {
  readonly app: CliApp
  readonly locale: Locale
  readonly markdown: ReturnType<typeof createMarkdownStream>
  readonly spinner: ReturnType<typeof createSpinner>
  readonly plan: ReturnType<typeof createPlanView>
  readonly toolLabels: Map<string, ToolDisplay>
  /** Cleared with `toolLabels`: both are per-call and neither may outlive the turn. */
  readonly toolStartedAt: Map<string, number>
  started: boolean
  ended: boolean
  latest: TurnMetric | undefined
  reasoning: string
  reasoningDeltas: string | null
}

export function createStreamPrinter(app: CliApp): StreamPrinter {
  const state = createRenderState(app)

  return {
    onChunk(event): void {
      renderChunk(state, event)
    },

    latestMetric(): TurnMetric | undefined {
      return state.latest
    },

    pause(): void {
      prepareActivity(state)
    },

    resume(): void {
      resumeThinking(state)
    },

    end(): void {
      endPrinter(state)
    },
  }
}

interface PrintFooterInput {
  readonly metric: TurnMetric | undefined
  /** Wall time of the whole run, measured by the caller with performance.now(). */
  readonly elapsedMs: number
}

export function printRunFooter(app: CliApp, totals: LLMUsageTotals, input: PrintFooterInput): void {
  const { metric } = input
  const details: FooterDetails = {
    ...(metric === undefined ? {} : { contextPct: metric.contextPct }),
    elapsedMs: input.elapsedMs,
  }

  app.out(formatCliFooter(app.config.locale.language, totals, details))
}

function createRenderState(app: CliApp): RenderState {
  const policy = resolveTerminalPolicy({ input: app.terminal.stdin, output: app.terminal.stdout })
  const state: RenderState = {
    app,
    locale: app.config.locale.language,
    markdown: createMarkdownStream(app.write, { hyperlinks: policy.hyperlinks }),
    spinner: createSpinner(app.write),
    plan: createPlanView(app.config.locale.language),
    toolLabels: new Map(),
    toolStartedAt: new Map(),
    started: false,
    ended: false,
    latest: undefined,
    reasoning: '',
    reasoningDeltas: null,
  }

  state.spinner.start(t(state.locale, 'ui.thinking'))

  return state
}

function renderChunk(state: RenderState, event: StreamEvent): void {
  if (state.ended) {
    return
  }

  switch (event.type) {
    case 'text_delta':
      renderText(state, event.delta)
      return
    case 'reasoning_delta':
      renderReasoning(state, event.delta)
      return
    case 'thinking_block':
      renderThinkingBlock(state, event)
      return
    case 'tool_execution_start':
      renderToolStart(state, event)
      return
    case 'tool_progress':
      renderToolProgress(state, event)
      return
    case 'tool_result':
      renderToolResult(state, event)
      return
    case 'turn_metric':
      renderMetric(state, event)
      return
    // Protocol and accounting events the surface has no line for, plus the two provider events a
    // child run would never deliver here: `fallback-notice` reads those off the bus instead.
    case 'tool_call_start':
    case 'tool_call_args_delta':
    case 'finish_reason':
    case 'usage':
    case 'provider_attempt_failed':
    case 'provider_fallback':
      return
    default:
      event satisfies never
      return
  }
}

function renderText(state: RenderState, delta: string): void {
  if (delta === '') {
    return
  }

  flushReasoning(state)
  clearReasoningDeltas(state)
  openAnswer(state)
  state.markdown.write(delta)
}

function renderReasoning(state: RenderState, delta: string): void {
  if (!isVerbose() || delta === '') {
    return
  }

  state.reasoning += delta
  state.reasoningDeltas = `${state.reasoningDeltas ?? ''}${delta}`
  flushCompleteReasoning(state)
}

function renderThinkingBlock(
  state: RenderState,
  event: Extract<StreamEvent, { readonly type: 'thinking_block' }>
): void {
  if (!isVerbose()) {
    return
  }

  flushReasoning(state)

  const duplicate = isRepeatedThinking(state, event)
  clearReasoningDeltas(state)

  if (duplicate) {
    return
  }

  printActivityLine(
    state,
    event.block.type === 'thinking' ? event.block.thinking : t(state.locale, 'ui.thinkingRedacted')
  )
}

function renderToolStart(state: RenderState, event: ToolExecutionStart): void {
  if (event.lifecycleOwner === 'progress') {
    return
  }

  const display: ToolDisplay = {
    label: translateToolLabel(state.locale, event.name, event.label),
    emoji: event.emoji,
    detail: event.detail,
  }
  state.toolLabels.set(event.id, display)
  // Monotonic, so an NTP step during a long call cannot report a negative elapsed.
  state.toolStartedAt.set(event.id, performance.now())

  flushReasoning(state)
  clearReasoningDeltas(state)
  prepareActivity(state)

  // Non-verbose shows only the transient spinner; the result line replaces it in place.
  if (isVerbose()) {
    state.app.out(colors.dim(toolStartLabel(display)))
  }

  state.spinner.start(t(state.locale, 'ui.runningTool', { label: spinnerLabel(display) }))
}

function renderToolProgress(
  state: RenderState,
  event: Extract<StreamEvent, { readonly type: 'tool_progress' }>
): void {
  const display = state.toolLabels.get(event.id)
  const label = display === undefined ? 'tool' : sanitizeDisplayText(display.label)
  const message = sanitizeDisplayText(translateDisplayText(state.locale, event.message))

  if (isPersistentProgress(event.message)) {
    printActivityLine(state, message)
    return
  }

  if (isVerbose()) {
    printActivityLine(state, `${label}: ${message}`)
    return
  }

  state.spinner.start(`${label}: ${message}`)
}

function renderToolResult(state: RenderState, event: ToolResult): void {
  if (event.lifecycleOwner === 'progress') {
    return
  }

  flushReasoning(state)
  clearReasoningDeltas(state)
  prepareActivity(state)

  const display = state.toolLabels.get(event.id) ?? {
    label: event.name,
    emoji: undefined,
    detail: undefined,
  }
  const startedAt = state.toolStartedAt.get(event.id)
  const text =
    event.display === undefined
      ? undefined
      : sanitizeDisplayText(translateDisplayText(state.locale, event.display))
  // A plan is the view's to print, or to swallow once it has already been stated.
  const plan =
    event.ok && text !== undefined ? state.plan.update(formatToolCall(display), text) : undefined

  if (plan === undefined) {
    state.app.out(
      colors.dim(
        toolResultLabel({
          event,
          display,
          locale: state.locale,
          text,
          elapsedMs: startedAt === undefined ? 0 : performance.now() - startedAt,
        })
      )
    )
  } else if (plan.block !== undefined) {
    state.app.out(plan.block)
  }

  state.toolLabels.delete(event.id)
  state.toolStartedAt.delete(event.id)
  resumeThinking(state)
}

function renderMetric(state: RenderState, event: TurnMetric): void {
  state.latest = event

  if (isVerbose()) {
    flushReasoning(state)
    clearReasoningDeltas(state)
    printActivityLine(state, formatTurnMetric(event))
  }
}

function openAnswer(state: RenderState): void {
  if (state.started) {
    return
  }

  state.spinner.stop()
  state.app.write(`${style.accent(icons().assistant)} `)
  state.started = true
}

function prepareActivity(state: RenderState): void {
  state.spinner.stop()
  closeAnswer(state)
}

function closeAnswer(state: RenderState): void {
  if (!state.started) {
    return
  }

  state.markdown.flush()
  state.started = false
}

function printActivityLine(state: RenderState, text: string): void {
  prepareActivity(state)
  state.app.out(colors.dim(sanitizeDisplayText(text)))
  resumeThinking(state)
}

function flushCompleteReasoning(state: RenderState): void {
  const lastNewline = state.reasoning.lastIndexOf('\n')

  if (lastNewline === -1) {
    return
  }

  const complete = state.reasoning.slice(0, lastNewline)
  state.reasoning = state.reasoning.slice(lastNewline + 1)
  printActivityLine(state, complete)
}

function flushReasoning(state: RenderState): void {
  if (state.reasoning === '') {
    return
  }

  const reasoning = state.reasoning
  state.reasoning = ''
  printActivityLine(state, reasoning)
}

function isRepeatedThinking(
  state: RenderState,
  event: Extract<StreamEvent, { readonly type: 'thinking_block' }>
): boolean {
  return event.block.type === 'thinking' && state.reasoningDeltas === event.block.thinking
}

function clearReasoningDeltas(state: RenderState): void {
  state.reasoningDeltas = null
}

function resumeThinking(state: RenderState): void {
  if (state.ended) {
    return
  }

  // The running step, when there is one: the spinner is where plan progress lives now.
  state.spinner.start(state.plan.status() ?? t(state.locale, 'ui.thinking'))
}

function endPrinter(state: RenderState): void {
  if (state.ended) {
    return
  }

  state.ended = true
  state.spinner.stop()
  flushReasoning(state)
  clearReasoningDeltas(state)
  closeAnswer(state)

  const abandoned = state.plan.close()

  if (abandoned !== undefined) {
    state.app.out(abandoned)
  }

  state.toolLabels.clear()
  state.toolStartedAt.clear()
}

// The one composition for a tool call line, shared by the activity lines and the approval prompt.
export function formatToolCall(display: ToolDisplay): string {
  const base =
    display.emoji === undefined || !isUnicode()
      ? sanitizeDisplayText(display.label)
      : `${display.emoji} ${sanitizeDisplayText(display.label)}`

  return display.detail === undefined ? base : `${base}: ${sanitizeDisplayText(display.detail)}`
}

// Spinner stays emoji-free: the frame glyph is the activity marker.
function spinnerLabel(display: ToolDisplay): string {
  const detail = display.detail === undefined ? '' : `: ${sanitizeDisplayText(display.detail)}`

  return `${sanitizeDisplayText(display.label)}${detail}`
}

function toolStartLabel(display: ToolDisplay): string {
  const { arrow } = icons()

  return `${arrow} ${formatToolCall(display)}`
}

interface ToolResultLine {
  readonly event: ToolResult
  readonly display: ToolDisplay
  readonly locale: Locale
  /** The already-translated display text, so the caller's plan probe does not translate twice. */
  readonly text: string | undefined
  readonly elapsedMs: number
}

function toolResultLabel(input: ToolResultLine): string {
  const { event, display, locale, text } = input
  const { success, error } = icons()
  const label = formatToolCall(display)

  if (!event.ok) {
    const fallbackErr = t(locale, 'ui.toolFailed')
    const detail = event.error === undefined ? undefined : sanitizeDisplayText(event.error)

    const errMsg =
      text ??
      (event.errorCode === undefined
        ? (detail ?? fallbackErr)
        : translateToolError(locale, event.errorCode, detail))

    return `${error} ${label}: ${errMsg}`
  }

  const summary = text ?? (isVerbose() ? event.resultSummary : undefined)

  return `${success} ${label}${toSummarySuffix(summary)}${toElapsedSuffix(input.elapsedMs)}`
}

function toElapsedSuffix(elapsedMs: number): string {
  return elapsedMs < SLOW_TOOL_CALL_MS ? '' : ` (${Math.round(elapsedMs / MS_PER_SECOND)}s)`
}

// A leading newline marks a block summary, where the separator space would trail after the colon.
function toSummarySuffix(summary: string | undefined): string {
  if (summary === undefined) {
    return ''
  }

  const text = sanitizeDisplayText(summary)

  return text.startsWith('\n') ? `:${text}` : `: ${text}`
}

function formatTurnMetric(metric: TurnMetric): string {
  return `${sanitizeDisplayText(metric.model)} · ${formatLatency(metric.latencyMs)} · ctx ${metric.contextPct}%`
}

function formatLatency(latencyMs: number): string {
  return latencyMs < MS_PER_SECOND
    ? `${Math.round(latencyMs)}ms`
    : `${(latencyMs / MS_PER_SECOND).toFixed(1)}s`
}
