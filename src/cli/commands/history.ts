import type { CliApp } from '@/cli/types'
import type { AgentId } from '@/core/ids'
import type { Locale } from '@/core/types/locale'
import type { LLMUsageTotals } from '@/core/types/usage'
import type {
  LLMAttempt,
  SessionDetails,
  SessionSnapshot,
  StoredSessionMessage,
} from '@/persistence/api'
import { createCommand, createGroup, type Group } from '@/cli/command'
import { terminalErrorMessage, usage } from '@/cli/error-output'
import { renderLocalized } from '@/cli/help'
import { CLI_COMMAND_METADATA, CLI_FLAG_DESCRIPTIONS } from '@/cli/metadata'
import { flagBool, flagString, parseIntFlagStrict } from '@/cli/parsing/args'
import { fail, style, success } from '@/cli/ui/colors'
import { formatSessionEnd, formatSessionRow, formatSessionStatus } from '@/cli/ui/format'
import { confirm, declined, defaultPrompt } from '@/cli/ui/prompt'
import { agentId, sessionId as brandSessionId, type SessionId } from '@/core/ids'
import { formatUsd } from '@/core/utils/cost'
import { sanitizeDisplayText } from '@/core/utils/text'
import { pluralKey, t } from '@/i18n'
import { formatInstant } from '@/trading/api'

const DEFAULT_LIMIT = 20
const MAX_HISTORY_LIMIT = 10_000
const CONTENT_PREVIEW_CHARS = 200
const INDENT = '    '

const historyListCommand = createCommand({
  name: 'list',
  summary: { key: 'cliHelp.historyListSummary' },
  spec: {
    flags: {
      limit: { type: 'string', describe: { key: 'cliHelp.flagHistoryLimit' } },
    },
  },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const limitResult = parseIntFlagStrict(flagString(args, 'limit'), '--limit')

    if (limitResult.kind === 'error') {
      return usage(app, renderLocalized(locale, limitResult.error))
    }

    const limit = limitResult.kind === 'value' ? limitResult.value : DEFAULT_LIMIT

    if (limit < 1 || limit > MAX_HISTORY_LIMIT) {
      return usage(app, t(locale, 'cli.historyLimitRange', { max: MAX_HISTORY_LIMIT }))
    }

    const sessions = await app.resolve('sessionStore').listRecent(limit)

    if (sessions.length === 0) {
      app.out(t(locale, 'cli.historyNoSessions'))

      return 0
    }

    app.out(style.heading(t(locale, 'cli.historySessionsHeading', { count: sessions.length })))
    for (const session of sessions) {
      app.out(`  ${formatSessionRow(locale, session, app.config.locale.timezone)}`)
    }

    return 0
  },
})

const historyShowCommand = createCommand({
  name: 'show',
  summary: { key: 'cliHelp.historyShowSummary' },
  spec: { positional: ['sessionId'] },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const raw = flagString(args, 'sessionId')

    if (raw === undefined) {
      return usage(app, t(locale, 'cli.historyShowUsage'))
    }

    const id = await resolveSessionId(app, raw, locale)

    if (id === undefined) {
      return 1
    }

    const snapshot = await app.resolve('sessionStore').loadDetails(id)

    if (snapshot === null) {
      app.err(fail(t(locale, 'cli.historySessionNotFound', { id: raw })))

      return 1
    }

    printSessionDetails(app, snapshot)

    return 0
  },
})

function printSessionDetails(app: CliApp, snapshot: SessionSnapshot): void {
  const locale = app.config.locale.language

  app.out(style.heading(t(locale, 'cli.historySessionHeading', { id: snapshot.session.id })))
  printMetadata(app, snapshot.session)
  app.out('')
  printTotals(app, snapshot.totals)
  app.out('')
  printMessages(app, snapshot.messages, snapshot.attempts)

  const unlinked = snapshot.attempts.filter((a) => a.messageIdx === null)

  if (unlinked.length > 0) {
    app.out('')
    printUnlinkedAttempts(app, unlinked)
  }
}

function printMetadata(app: CliApp, session: SessionDetails): void {
  const { language: locale, timezone } = app.config.locale
  const channel =
    session.chatId === undefined ? session.channel : `${session.channel} / ${session.chatId}`

  app.out(t(locale, 'cli.historyFieldAgent', { value: session.agentId }))
  app.out(t(locale, 'cli.historyFieldUser', { value: session.userId }))
  app.out(t(locale, 'cli.historyFieldChannel', { value: channel }))
  app.out(
    t(locale, 'cli.historyFieldStatus', { value: formatSessionStatus(locale, session.status) })
  )

  if (session.endReason !== undefined) {
    app.out(
      t(locale, 'cli.historyFieldEnd', { value: formatSessionEnd(locale, session.endReason) })
    )
  }

  if (session.errorMessage !== undefined && session.errorMessage.length > 0) {
    app.out(
      t(locale, 'cli.historyFieldError', { value: sanitizeDisplayText(session.errorMessage) })
    )
  }

  app.out(
    t(locale, 'cli.historyFieldStarted', {
      value: formatInstant(locale, session.startedAt, timezone),
    })
  )
  app.out(
    t(locale, 'cli.historyFieldActivity', {
      value: formatInstant(locale, session.lastActivityAt, timezone),
    })
  )

  if (session.endedAt !== undefined) {
    app.out(
      t(locale, 'cli.historyFieldEnded', {
        value: formatInstant(locale, session.endedAt, timezone),
      })
    )
  }
}

function printTotals(app: CliApp, totals: LLMUsageTotals): void {
  const locale = app.config.locale.language
  app.out(style.heading(t(locale, 'cli.historyTotalsHeading')))
  app.out(t(locale, 'cli.historyTotalCost', { value: formatUsd(totals.costUsd) }))
  app.out(t(locale, 'cli.historyTotalInput', { value: totals.inputTokens }))
  app.out(t(locale, 'cli.historyTotalOutput', { value: totals.outputTokens }))
  app.out(t(locale, 'cli.historyTotalCacheRead', { value: totals.cacheReadTokens }))
  app.out(t(locale, 'cli.historyTotalCacheWrite', { value: totals.cacheWriteTokens }))
  app.out(t(locale, 'cli.historyTotalReasoning', { value: totals.reasoningTokens }))
  app.out(t(locale, 'cli.historyTotalModelCalls', { value: totals.modelCalls }))
}

function printMessages(
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
    const origin = stored.runId === undefined ? '' : `  run:${stored.runId}`

    app.out(`  ${idx}  ${role} ${formatInstant(locale, stored.createdAt, timezone)}${origin}`)
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
  const sum = sumAttempts(attempts)
  const tokens = `in=${sum.inputTokens} out=${sum.outputTokens}`
  const cache = `cache=${sum.cacheReadTokens}/${sum.cacheWriteTokens}`

  app.out(
    `      generation: ${formatUsd(sum.costUsd)} · ${tokens} ${cache} reason=${sum.reasoningTokens}`
  )

  for (const attempt of attempts) {
    printAttemptDetails(app, attempt, INDENT)
  }
}

function printAttemptDetails(app: CliApp, attempt: LLMAttempt, indent: string): void {
  const outcome =
    attempt.outcome === 'success' ? attempt.outcome : `${attempt.outcome} (${attempt.errorCode})`
  const parent = attempt.parentRunId === undefined ? '' : ` parent:${attempt.parentRunId}`

  app.out(`${indent}agent:${attempt.agentId} ${attempt.provider}/${attempt.model} · ${outcome}`)
  app.out(`${indent}  run:${attempt.runId}${parent}`)
  const tokenLine = `in=${attempt.inputTokens} out=${attempt.outputTokens}`
  const cacheLine = `cache=${attempt.cacheReadTokens}/${attempt.cacheWriteTokens}`

  app.out(
    `${indent}  cost:${formatUsd(attempt.costUsd)} ${tokenLine} ${cacheLine} reason=${attempt.reasoningTokens}`
  )
  app.out(
    `${indent}  usage:${attempt.usageSource} cost:${attempt.costSource} latency:${attempt.latencyMs}ms`
  )
}

function printUnlinkedAttempts(app: CliApp, attempts: readonly LLMAttempt[]): void {
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

const historyDeleteCommand = createCommand({
  name: 'delete',
  summary: { key: 'cliHelp.historyDeleteSummary' },
  spec: { positional: ['sessionId'] },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const raw = flagString(args, 'sessionId')

    if (raw === undefined) {
      return usage(app, t(locale, 'cli.historyDeleteUsage'))
    }

    const id = await resolveSessionId(app, raw, locale)

    if (id === undefined) {
      return 1
    }

    const removal = await app.resolve('sessionStore').remove(id)

    if (removal !== 'removed') {
      const key = removal === 'active' ? 'cli.historySessionActive' : 'cli.historySessionNotFound'

      app.err(fail(t(locale, key, { id: raw })))

      return 1
    }

    app.out(success(t(locale, 'cli.historyDeleted', { id: raw })))

    return 0
  },
})

async function resolveSessionId(
  app: CliApp,
  raw: string,
  locale: Locale
): Promise<SessionId | undefined> {
  const prefix = parseSessionId(app, raw)

  if (prefix === undefined) {
    return undefined
  }

  const resolved = await app.resolve('sessionStore').resolveIdPrefix(prefix)

  if (resolved.kind === 'not_found') {
    app.err(fail(t(locale, 'cli.historySessionNotFound', { id: raw })))

    return undefined
  }

  if (resolved.kind === 'ambiguous') {
    app.err(fail(t(locale, 'cli.historySessionAmbiguous', { id: raw })))

    return undefined
  }

  return resolved.id
}

function parseSessionId(app: CliApp, raw: string): SessionId | undefined {
  try {
    return brandSessionId(raw)
  } catch (err: unknown) {
    app.err(fail(terminalErrorMessage(err, app.config.locale.language)))

    return undefined
  }
}

function reportCleared(
  app: CliApp,
  result: { readonly kind: 'removed' | 'active'; readonly count: number }
): number {
  const locale = app.config.locale.language
  const { count } = result

  if (result.kind === 'active') {
    app.err(
      fail(
        t(locale, pluralKey(count, 'cli.historyActiveSessionsOne', 'cli.historyActiveSessions'), {
          count,
        })
      )
    )

    return 1
  }

  app.out(
    success(t(locale, pluralKey(count, 'cli.historyClearedOne', 'cli.historyCleared'), { count }))
  )

  return 0
}

const historyClearCommand = createCommand({
  name: 'clear',
  summary: { key: 'cliHelp.historyClearSummary' },
  spec: {
    flags: {
      agent: { type: 'string', describe: CLI_FLAG_DESCRIPTIONS.limitToAgent },
      yes: { type: 'boolean', describe: CLI_FLAG_DESCRIPTIONS.skipConfirmation },
    },
  },
  needs: { daemon: 'stopped' },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const rawAgent = flagString(args, 'agent')
    let agent: AgentId | undefined

    try {
      agent = rawAgent === undefined ? undefined : agentId(rawAgent)
    } catch {
      return usage(app, t(locale, 'cli.historyInvalidAgent'))
    }

    const store = app.resolve('sessionStore')
    const count = await store.count(agent)

    if (count === 0) {
      app.out(t(locale, 'cli.historyNoSessionsToDelete'))

      return 0
    }

    const scope =
      agent === undefined
        ? t(locale, 'cli.historyClearAllScope')
        : t(locale, 'cli.historyClearAgentScope', { agent })

    if (
      !(
        flagBool(args, 'yes') ||
        (await confirm(
          defaultPrompt(),
          t(locale, pluralKey(count, 'cli.historyClearConfirmOne', 'cli.historyClearConfirm'), {
            count,
            scope,
          }),
          locale
        ))
      )
    ) {
      return declined(app)
    }

    return reportCleared(app, await store.clear(agent))
  },
})

export const historyCommand: Group = createGroup({
  ...CLI_COMMAND_METADATA.history,
  subcommands: [historyListCommand, historyShowCommand, historyDeleteCommand, historyClearCommand],
})
