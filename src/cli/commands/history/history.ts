import type { CliApp } from '@/cli/types'
import type { AgentId } from '@/core/ids'
import type { Locale } from '@/core/types/locale'
import type { LLMUsageTotals } from '@/core/types/usage'
import type { SessionDetails, SessionSnapshot } from '@/persistence/api'
import { createCommand, createGroup, type Group } from '@/cli/command'
import { printMessages, printUnlinkedAttempts } from '@/cli/commands/history/transcript'
import { terminalErrorMessage, usage } from '@/cli/error-output'
import { renderLocalized } from '@/cli/help'
import { CLI_COMMAND_METADATA, CLI_FLAG_DESCRIPTIONS } from '@/cli/metadata'
import { flagBool, flagString, parseIntFlagStrict } from '@/cli/parsing/args'
import { fail, style, success } from '@/cli/ui/colors'
import {
  formatSessionEnd,
  formatSessionError,
  formatSessionRow,
  formatSessionStatus,
} from '@/cli/ui/format'
import { confirm, declined, defaultPrompt } from '@/cli/ui/prompt'
import { agentId, sessionId as brandSessionId, type SessionId } from '@/core/ids'
import { formatSpendUsd } from '@/core/utils/cost'
import { sanitizeDisplayText } from '@/core/utils/text'
import { pluralKey, renderAiLabel, t } from '@/i18n'
import { formatCount, formatInstant } from '@/trading/api'

const DEFAULT_LIMIT = 20
const MAX_HISTORY_LIMIT = 10_000

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

  // A command's own answer is stored display-only and carries its label; a model's reply does not.
  if (snapshot.messages.some((m) => m.message.role === 'assistant' && m.displayOnly !== true)) {
    app.out(style.muted(renderAiLabel(locale)))
  }

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
      t(locale, 'cli.historyFieldError', {
        value: sanitizeDisplayText(formatSessionError(locale, session.errorMessage)),
      })
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
  app.out(t(locale, 'cli.historyTotalCost', { value: formatSpendUsd(locale, totals.costUsd) }))
  app.out(t(locale, 'cli.historyTotalInput', { value: formatCount(locale, totals.inputTokens) }))
  app.out(t(locale, 'cli.historyTotalOutput', { value: formatCount(locale, totals.outputTokens) }))
  app.out(
    t(locale, 'cli.historyTotalCacheRead', { value: formatCount(locale, totals.cacheReadTokens) })
  )
  app.out(
    t(locale, 'cli.historyTotalCacheWrite', { value: formatCount(locale, totals.cacheWriteTokens) })
  )
  app.out(
    t(locale, 'cli.historyTotalReasoning', { value: formatCount(locale, totals.reasoningTokens) })
  )
  app.out(
    t(locale, 'cli.historyTotalModelCalls', { value: formatCount(locale, totals.modelCalls) })
  )
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
