import type { CliApp } from '@/cli/types'
import type { Locale } from '@/core/types/locale'
import type { LLMAttempt, StoredSessionMessage } from '@/persistence/api'
import { style } from '@/cli/ui/colors'
import { formatSpendUsd } from '@/core/utils/cost'
import { sanitizeDisplayText } from '@/core/utils/text'
import { t, translateDisplayText } from '@/i18n'
import { formatCount, formatInstant } from '@/trading/api'

const CONTENT_PREVIEW_CHARS = 200
const INDENT = '    '

export function printMessages(
  app: CliApp,
  messages: readonly StoredSessionMessage[],
  attempts: readonly LLMAttempt[]
): void {
  const { language: locale, timezone } = app.config.locale
  app.out(style.heading(t(locale, 'cli.historyMessagesHeading', { count: messages.length })))

  const byMessageIdx = buildMessageAttemptsMap(attempts)

  for (const stored of messages) {
    const idx = stored.idx.toString().padStart(3)
    const role = stored.message.role.padEnd(9)
    const origin =
      stored.runId === undefined ? '' : `  ${t(locale, 'cli.historyRun', { run: stored.runId })}`
    const shown = stored.displayOnly === true ? `  ${t(locale, 'cli.historyDisplayOnly')}` : ''

    app.out(
      `  ${idx}  ${role} ${formatInstant(locale, stored.createdAt, timezone)}${origin}${shown}`
    )
    app.out(`      ${formatMessageContent(stored.message)}`)

    if (stored.message.role === 'assistant') {
      const linked = byMessageIdx.get(stored.idx) ?? []

      if (linked.length > 0) {
        printMessageGenerationCost(app, linked)
      }
    }
  }
}

function buildMessageAttemptsMap(attempts: readonly LLMAttempt[]): Map<number, LLMAttempt[]> {
  const map = new Map<number, LLMAttempt[]>()

  for (const attempt of attempts) {
    if (attempt.messageIdx === null) {
      continue
    }

    const group = map.get(attempt.messageIdx)

    if (group === undefined) {
      map.set(attempt.messageIdx, [attempt])
    } else {
      group.push(attempt)
    }
  }

  return map
}

function printMessageGenerationCost(app: CliApp, attempts: readonly LLMAttempt[]): void {
  const locale = app.config.locale.language
  const sum = sumAttempts(attempts)

  app.out(
    `${INDENT}${t(locale, 'cli.historyGeneration', { cost: formatSpendUsd(locale, sum.costUsd), tokens: tokenCounts(locale, sum) })}`
  )

  for (const attempt of attempts) {
    printAttemptDetails(app, attempt, INDENT)
  }
}

function printAttemptDetails(app: CliApp, attempt: LLMAttempt, indent: string): void {
  const locale = app.config.locale.language
  const outcome = describeOutcome(locale, attempt)
  const run = t(locale, 'cli.historyRun', { run: attempt.runId })
  const parent =
    attempt.parentRunId === undefined
      ? ''
      : ` ${t(locale, 'cli.historyParentRun', { run: attempt.parentRunId })}`

  app.out(
    `${indent}${t(locale, 'cli.historyAttempt', { agent: attempt.agentId, model: `${attempt.provider}/${attempt.model}`, outcome })}`
  )
  app.out(`${indent}  ${run}${parent}`)
  app.out(
    `${indent}  ${t(locale, 'cli.historyAttemptCost', { cost: formatSpendUsd(locale, attempt.costUsd), tokens: tokenCounts(locale, attempt) })}`
  )
  app.out(
    `${indent}  ${t(locale, 'cli.historyAttemptSources', { usage: attempt.usageSource, cost: attempt.costSource, latencyMs: attempt.latencyMs })}`
  )
}

// The outcome and, for a failed one, the provider's error class in words, as the web's calls list
// words them; a value the catalog does not know prints as stored.
function describeOutcome(locale: Locale, attempt: LLMAttempt): string {
  const outcome = translateDisplayText(locale, {
    key: `ui.office.calls.outcome.${attempt.outcome}`,
    fallback: attempt.outcome,
  })

  if (attempt.errorCode === undefined) {
    return outcome
  }

  const reason = translateDisplayText(locale, {
    key: `ui.office.calls.error.${attempt.errorCode}`,
    fallback: attempt.errorCode,
  })

  return `${outcome} (${reason})`
}

function tokenCounts(
  locale: Locale,
  counts: Pick<
    LLMAttempt,
    'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'reasoningTokens'
  >
): string {
  return t(locale, 'cli.historyTokens', {
    input: formatCount(locale, counts.inputTokens),
    output: formatCount(locale, counts.outputTokens),
    cacheRead: formatCount(locale, counts.cacheReadTokens),
    cacheWrite: formatCount(locale, counts.cacheWriteTokens),
    reasoning: formatCount(locale, counts.reasoningTokens),
  })
}

export function printUnlinkedAttempts(app: CliApp, attempts: readonly LLMAttempt[]): void {
  const { language: locale, timezone } = app.config.locale
  app.out(style.heading(t(locale, 'cli.historyUnlinkedHeading', { count: attempts.length })))

  for (const attempt of attempts) {
    app.out(`  ${attempt.kind} · ${formatInstant(locale, attempt.settledAt, timezone)}`)
    printAttemptDetails(app, attempt, INDENT)
  }
}

interface AttemptSum {
  readonly costUsd: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly reasoningTokens: number
}

function sumAttempts(attempts: readonly LLMAttempt[]): AttemptSum {
  return attempts.reduce(
    (acc, a) => ({
      costUsd: acc.costUsd + a.costUsd,
      inputTokens: acc.inputTokens + a.inputTokens,
      outputTokens: acc.outputTokens + a.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + a.cacheReadTokens,
      cacheWriteTokens: acc.cacheWriteTokens + a.cacheWriteTokens,
      reasoningTokens: acc.reasoningTokens + a.reasoningTokens,
    }),
    {
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
    }
  )
}

function formatMessageContent(message: StoredSessionMessage['message']): string {
  const text =
    typeof message.content === 'string' ? message.content : JSON.stringify(message.content)

  return sanitizeDisplayText(text).slice(0, CONTENT_PREVIEW_CHARS)
}
