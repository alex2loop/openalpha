import type { StreamPrinter } from '@/cli/commands/chat/render'
import type { ChatFlags } from '@/cli/commands/chat/types'
import type { CliApp } from '@/cli/types'
import type { PromptFn } from '@/cli/ui/prompt'
import type { AgentId, SessionId } from '@/core/ids'
import type { RunResult } from '@/engine/api'
import { watchProviderFallbacks } from '@/cli/commands/chat/fallback-notice'
import { createStreamPrinter, printRunFooter } from '@/cli/commands/chat/render'
import { createCliResearchInteraction } from '@/cli/commands/chat/research'
import { buildRunInput, buildRunOptions } from '@/cli/commands/chat/run-args'
import { hint, style } from '@/cli/ui/colors'
import { BRAND } from '@/core/brand'
import { failureSpecOf, RUN_FAILURE_SPEC } from '@/core/errors'
import { failureHintParams } from '@/core/limits'
import { bindLocale, runCompletionMessage, t } from '@/i18n'

interface TurnRequest {
  readonly app: CliApp
  readonly agentId: AgentId
  readonly sessionId: SessionId
  readonly message: string
  readonly flags: ChatFlags
  readonly signal?: AbortSignal
  readonly chatId?: string
  /** The turn's prompt owner; deep research plan review exists only when a human can answer. */
  readonly prompt?: PromptFn
  /** Receives the live printer so an approval prompt can pause it; cleared when the turn ends. */
  readonly onPrinter?: (printer: StreamPrinter | undefined) => void
}

export async function executeTurn(req: TurnRequest): Promise<RunResult> {
  const { app } = req
  const runner = app.resolve('runner')
  const printer = createStreamPrinter(app)
  const fallbacks = watchProviderFallbacks(app)
  const researchInteraction = createCliResearchInteraction({
    app,
    printer,
    signal: req.signal ?? app.signal,
    ...(req.prompt === undefined ? {} : { prompt: req.prompt }),
  })

  req.onPrinter?.(printer)

  try {
    const startedAt = performance.now()
    const result = await runner.run(
      buildRunInput({
        agentId: req.agentId,
        sessionId: req.sessionId,
        message: req.message,
        onChunk: printer.onChunk,
      }),
      buildRunOptions({
        flags: req.flags,
        ...(req.signal === undefined ? {} : { signal: req.signal }),
        ...(req.chatId === undefined ? {} : { chatId: req.chatId }),
        researchInteraction,
      })
    )
    const elapsedMs = Math.round(performance.now() - startedAt)

    // Closed before anything else prints, so the footer never lands mid-answer.
    printer.end()
    fallbacks.report()
    reportReason(req, result)
    printRunFooter(app, result.totals, { metric: printer.latestMetric(), elapsedMs })

    return result
  } finally {
    fallbacks.dispose()
    req.onPrinter?.(undefined)
    researchInteraction.finish()
    // Also closes the answer block when the run throws, so the error is not glued to the last delta.
    printer.end()
  }
}

function reportReason(req: TurnRequest, result: RunResult): void {
  const { app } = req
  const locale = app.config.locale.language

  if (result.completionCode !== undefined) {
    app.out(style.warn(runCompletionMessage(locale, result.completionCode, result.model ?? '')))

    return
  }

  if (result.reason === 'completed') {
    return
  }

  if (result.operator !== undefined) {
    app.err(style.error(bindLocale(locale).translate(result.operator.key, result.operator.params)))

    return
  }

  const failure = failureSpecOf(result) ?? RUN_FAILURE_SPEC[result.reason]
  const message = t(locale, failure.messageKey, { brand: BRAND.name })

  app.err(style.error(message))

  if ('hintKey' in failure) {
    app.out(hint(t(locale, failure.hintKey, failureHintParams(BRAND.name, result.limits))))
  }
}
