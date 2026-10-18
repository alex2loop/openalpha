import type { ParsedArgs } from '@/cli/parsing/args'
import type { CliApp } from '@/cli/types'
import type { AgentId } from '@/core/ids'
import type { AgentLogRetentionResult, DaemonLogRetentionResult } from '@/core/logging/retention'
import type { Locale } from '@/core/types/locale'
import type { MessageKey } from '@/i18n'
import { type Command, createCommand } from '@/cli/command'
import { usage } from '@/cli/error-output'
import { renderLocalized } from '@/cli/help'
import { CLI_FLAG_DESCRIPTIONS } from '@/cli/metadata'
import { flagBool, flagString } from '@/cli/parsing/args'
import { parseDurationFlag } from '@/cli/parsing/duration'
import { fail, hint, success } from '@/cli/ui/colors'
import { formatBytes } from '@/cli/ui/format'
import { confirm, declined, defaultPrompt } from '@/cli/ui/prompt'
import { agentId } from '@/core/ids'
import {
  clearAgentLogs,
  clearDaemonLogs,
  countAgentLogs,
  countDaemonLogs,
} from '@/core/logging/retention'
import { MS_PER_DAY } from '@/core/utils/time'
import { pluralKey, t } from '@/i18n'

interface CountedMessage {
  readonly one: MessageKey
  readonly many: MessageKey
}

interface ClearMessages {
  readonly confirm: CountedMessage
  readonly preview: CountedMessage
  readonly cleared: CountedMessage
}

const AGENT_MESSAGES = {
  confirm: { one: 'cli.logsClearConfirmOne', many: 'cli.logsClearConfirm' },
  preview: { one: 'cli.logsClearPreviewOne', many: 'cli.logsClearPreview' },
  cleared: { one: 'cli.logsClearedOne', many: 'cli.logsCleared' },
} as const satisfies ClearMessages

const DAEMON_MESSAGES = {
  confirm: { one: 'cli.logsClearDaemonConfirmOne', many: 'cli.logsClearDaemonConfirm' },
  preview: { one: 'cli.logsClearDaemonPreviewOne', many: 'cli.logsClearDaemonPreview' },
  cleared: { one: 'cli.logsDaemonClearedOne', many: 'cli.logsDaemonCleared' },
} as const satisfies ClearMessages

interface ClearScope {
  readonly app: CliApp
  readonly locale: Locale
  readonly scope: string
  readonly messages: ClearMessages
}

// Both scopes count different things — agent log directories, daemon log files — so the flow
// works on this normalized shape and each scope names its own copy.
interface ClearOutcome {
  readonly count: number
  readonly bytes: number
  readonly failures: number
}

interface ClearOps {
  readonly count: () => Promise<ClearOutcome>
  readonly clear: () => Promise<ClearOutcome>
}

interface AgentPlan {
  readonly kind: 'agent'
  readonly scope: string
  readonly dataDir: string
  readonly agentId?: AgentId
  readonly cutoffAt: number
}

interface DaemonPlan {
  readonly kind: 'daemon'
  readonly scope: string
  readonly file: string
  readonly cutoffAt: number
}

type ClearPlan = AgentPlan | DaemonPlan | { readonly kind: 'error'; readonly error: string }

export const logsClearCommand: Command = createCommand({
  name: 'clear',
  summary: { key: 'cliHelp.logsClearSummary' },
  spec: {
    flags: {
      agent: { type: 'string', describe: CLI_FLAG_DESCRIPTIONS.limitToAgent },
      daemon: { type: 'boolean', describe: CLI_FLAG_DESCRIPTIONS.daemonLogScope },
      olderThan: { type: 'string', describe: CLI_FLAG_DESCRIPTIONS.retentionWindow },
      dryRun: { type: 'boolean', describe: CLI_FLAG_DESCRIPTIONS.previewWithoutDeleting },
      yes: { type: 'boolean', describe: CLI_FLAG_DESCRIPTIONS.skipConfirmation },
    },
  },
  needs: { boot: false, configFile: 'optional', daemon: 'stopped' },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const cutoff = resolveCutoff(flagString(args, 'olderThan'), locale)

    if (cutoff.kind === 'error') {
      return usage(app, cutoff.error)
    }

    const plan = resolvePlan(args, app, cutoff.value)

    if (plan.kind === 'error') {
      return usage(app, plan.error)
    }

    return plan.kind === 'daemon' ? runDaemonClear(plan, args, app) : runAgentClear(plan, args, app)
  },
})

function resolvePlan(args: ParsedArgs, app: CliApp, cutoffAt: number): ClearPlan {
  const locale = app.config.locale.language
  const rawAgent = flagString(args, 'agent')

  if (flagBool(args, 'daemon')) {
    if (rawAgent !== undefined) {
      return { kind: 'error', error: t(locale, 'cli.logsClearScopeConflict') }
    }

    return {
      kind: 'daemon',
      scope: t(locale, 'cli.logsClearScopeDaemon'),
      file: app.config.log.file,
      cutoffAt,
    }
  }

  const dataDir = app.config.paths.dataDir

  if (rawAgent === undefined) {
    return { kind: 'agent', scope: t(locale, 'cli.logsClearScopeAll'), dataDir, cutoffAt }
  }

  try {
    const agent = agentId(rawAgent)

    return {
      kind: 'agent',
      scope: t(locale, 'cli.logsClearScopeAgent', { agent }),
      dataDir,
      agentId: agent,
      cutoffAt,
    }
  } catch {
    return { kind: 'error', error: t(locale, 'cli.logsInvalidAgent') }
  }
}

function runAgentClear(plan: AgentPlan, args: ParsedArgs, app: CliApp): Promise<number> {
  const target: ClearScope = {
    app,
    locale: app.config.locale.language,
    scope: plan.scope,
    messages: AGENT_MESSAGES,
  }

  return runClear(target, args, {
    count: async () => agentOutcome(await countAgentLogs(plan)),
    clear: async () => agentOutcome(await clearAgentLogs(plan)),
  })
}

function runDaemonClear(plan: DaemonPlan, args: ParsedArgs, app: CliApp): Promise<number> {
  const target: ClearScope = {
    app,
    locale: app.config.locale.language,
    scope: plan.scope,
    messages: DAEMON_MESSAGES,
  }

  return runClear(target, args, {
    count: async () => daemonOutcome(await countDaemonLogs(plan)),
    clear: async () => daemonOutcome(await clearDaemonLogs(plan)),
  })
}

async function runClear(target: ClearScope, args: ParsedArgs, ops: ClearOps): Promise<number> {
  const { app, locale, scope } = target
  const preview = await ops.count()

  if (flagBool(args, 'dryRun')) {
    return reportDryRun(target, preview)
  }

  if (preview.count === 0) {
    app.out(t(locale, 'cli.logsNothingToDelete', { scope }))

    return 0
  }

  if (!(await confirmClear(target, args, preview.count))) {
    return declined(app)
  }

  const result = await ops.clear()

  app.out(
    success(
      t(locale, countedKey(target.messages.cleared, result.count), {
        count: result.count,
        bytes: formatBytes(result.bytes),
      })
    )
  )

  return reportFailures(target, result)
}

function confirmClear(target: ClearScope, args: ParsedArgs, count: number): Promise<boolean> {
  const { locale, scope } = target

  if (flagBool(args, 'yes')) {
    return Promise.resolve(true)
  }

  return confirm(
    defaultPrompt(),
    t(locale, countedKey(target.messages.confirm, count), { count, scope }),
    locale
  )
}

function reportDryRun(target: ClearScope, preview: ClearOutcome): number {
  const { app, locale, scope } = target

  app.out(
    t(locale, countedKey(target.messages.preview, preview.count), {
      count: preview.count,
      bytes: formatBytes(preview.bytes),
      scope,
    })
  )
  app.out(hint(t(locale, 'cli.dbDryRunHint')))

  return reportFailures(target, preview)
}

function reportFailures(target: ClearScope, result: ClearOutcome): number {
  if (result.failures === 0) {
    return 0
  }

  target.app.err(
    fail(
      t(
        target.locale,
        pluralKey(result.failures, 'cli.logsClearFailuresOne', 'cli.logsClearFailures'),
        { count: result.failures }
      )
    )
  )

  return 1
}

function agentOutcome(result: AgentLogRetentionResult): ClearOutcome {
  return { count: result.removedDirectories, bytes: result.removedBytes, failures: result.failures }
}

function daemonOutcome(result: DaemonLogRetentionResult): ClearOutcome {
  return { count: result.removedFiles, bytes: result.removedBytes, failures: result.failures }
}

type CutoffResult =
  | { readonly kind: 'value'; readonly value: number }
  | { readonly kind: 'error'; readonly error: string }

function resolveCutoff(olderThan: string | undefined, locale: Locale): CutoffResult {
  if (olderThan === undefined) {
    return { kind: 'value', value: Number.POSITIVE_INFINITY }
  }

  const parsed = parseDurationFlag(olderThan, '--older-than')

  if (parsed.kind === 'error') {
    return { kind: 'error', error: renderLocalized(locale, parsed.error) }
  }

  if (parsed.ms < MS_PER_DAY) {
    return { kind: 'error', error: t(locale, 'cli.dbOlderThanMinDay') }
  }

  return { kind: 'value', value: Date.now() - parsed.ms }
}

function countedKey(message: CountedMessage, count: number): MessageKey {
  return pluralKey(count, message.one, message.many)
}
