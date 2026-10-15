import type { Group } from '@/cli/command'
import type { ParsedArgs } from '@/cli/parsing/args'
import type { CliApp } from '@/cli/types'
import type { Locale } from '@/core/types/locale'
import type {
  WorkspaceCleanupAgentResult,
  WorkspaceCleanupPlan,
  WorkspaceCleanupResult,
  WorkspaceCleanupScope,
} from '@/engine/api'
import { createCommand, createGroup } from '@/cli/command'
import { terminalErrorMessage, usage } from '@/cli/error-output'
import { renderLocalized } from '@/cli/help'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'
import { flagBool, flagString } from '@/cli/parsing/args'
import { parseDurationFlag } from '@/cli/parsing/duration'
import { fail, hint, style, success } from '@/cli/ui/colors'
import { formatBytes } from '@/cli/ui/format'
import { confirm, declined, defaultPrompt } from '@/cli/ui/prompt'
import { agentId as brandAgentId } from '@/core/ids'
import {
  applyWorkspaceScratchCleanup,
  isValidAgentId,
  planWorkspaceScratchCleanup,
  RESERVED_AGENT_IDS,
  WORKSPACES_DIR_NAME,
} from '@/engine/api'
import { t } from '@/i18n'

const DELETE_GUARD = 'DELETE'

const workspaceCmdCleanup = createCommand({
  name: 'cleanup',
  summary: { key: 'cliHelp.workspaceCleanSummary' },
  needs: { boot: false, daemon: 'stopped' },
  spec: {
    flags: {
      agent: { type: 'string', describe: { key: 'cliHelp.flagWorkspaceAgent' } },
      all: { type: 'boolean', describe: { key: 'cliHelp.flagWorkspaceAll' } },
      olderThan: { type: 'string', describe: { key: 'cliHelp.flagWorkspaceOlderThan' } },
      dryRun: { type: 'boolean', describe: { key: 'cliHelp.flagWorkspaceDryRun' } },
      yes: { type: 'boolean', describe: { key: 'cliHelp.flagWorkspaceYes' } },
    },
  },
  run: cleanup,
})

export const workspaceCommand: Group = createGroup({
  ...CLI_COMMAND_METADATA.workspace,
  subcommands: [workspaceCmdCleanup],
})

interface CleanupOptions {
  readonly scope: WorkspaceCleanupScope
  readonly olderThanMs?: number
  readonly dryRun: boolean
  readonly yes: boolean
}

async function cleanup(args: ParsedArgs, app: CliApp): Promise<number> {
  const locale = app.config.locale.language
  const options = parseCleanupOptions(args, app, locale)

  if (options === undefined) {
    return 2
  }

  const now = Date.now()
  const cutoffAt = options.olderThanMs === undefined ? undefined : now - options.olderThanMs

  let plan: WorkspaceCleanupPlan

  try {
    plan = await planWorkspaceScratchCleanup({
      dataDir: app.config.paths.dataDir,
      scope: options.scope,
      cutoffAt,
    })
  } catch (error: unknown) {
    app.err(fail(`${scopeName(options.scope)}: ${terminalErrorMessage(error, locale)}`))
    return 1
  }

  if (plan.failures > 0) {
    app.err(fail(t(locale, 'cli.workspaceScanFailures', { count: plan.failures })))
  }

  if (plan.agents.size === 0) {
    if (plan.failures === 0) {
      app.out(hint(t(locale, 'cli.workspaceNoDirectories')))
    }

    return plan.failures === 0 ? 0 : 1
  }

  if (options.dryRun) {
    return reportDryRun(plan, app, locale)
  }

  if (!(await approveCleanup(options, plan, locale))) {
    return declined(app)
  }

  let result: WorkspaceCleanupResult

  try {
    result = await applyWorkspaceScratchCleanup(plan)
  } catch (error: unknown) {
    app.err(fail(`${scopeName(options.scope)}: ${terminalErrorMessage(error, locale)}`))
    return 1
  }

  return reportResult(result, app, locale)
}

function parseCleanupOptions(
  args: ParsedArgs,
  app: CliApp,
  locale: Locale
): CleanupOptions | undefined {
  const agent = flagString(args, 'agent')
  const all = flagBool(args, 'all')

  if ((agent !== undefined) === all) {
    usage(app, t(locale, 'cli.workspaceCleanupUsage'))
    return undefined
  }

  if (agent !== undefined && !isValidAgentId(agent)) {
    usage(app, t(locale, 'cli.workspaceInvalidAgentId'))
    return undefined
  }

  if (agent !== undefined && RESERVED_AGENT_IDS.has(agent)) {
    usage(app, t(locale, 'cli.workspaceReservedAgentId', { id: agent }))
    return undefined
  }

  const olderThan = parseOlderThan(flagString(args, 'olderThan'), app, locale)

  if (olderThan === false) {
    return undefined
  }

  return {
    scope: agent === undefined ? { kind: 'all' } : { kind: 'agent', agentId: brandAgentId(agent) },
    ...(olderThan === undefined ? {} : { olderThanMs: olderThan }),
    dryRun: flagBool(args, 'dryRun'),
    yes: flagBool(args, 'yes'),
  }
}

function parseOlderThan(
  raw: string | undefined,
  app: CliApp,
  locale: Locale
): number | false | undefined {
  if (raw === undefined) {
    return undefined
  }

  if (raw !== raw.trim()) {
    usage(app, t(locale, 'cli.workspaceInvalidOlderThan'))
    return false
  }

  const parsed = parseDurationFlag(raw, '--older-than')

  if (parsed.kind === 'error') {
    usage(app, renderLocalized(locale, parsed.error))
    return false
  }

  return parsed.ms
}

function scopeName(scope: WorkspaceCleanupScope): string {
  return scope.kind === 'agent' ? scope.agentId : WORKSPACES_DIR_NAME
}

function totalBytes(plan: WorkspaceCleanupPlan): number {
  let total = 0

  for (const agent of plan.agents.values()) {
    total += agent.files.reduce((sum, file) => sum + file.bytes, 0)
  }

  return total
}

function reportDryRun(plan: WorkspaceCleanupPlan, app: CliApp, locale: Locale): number {
  const bytes = totalBytes(plan)

  for (const [agentId, agent] of plan.agents) {
    const agentBytes = agent.files.reduce((sum, file) => sum + file.bytes, 0)
    const reclaimed = t(locale, 'cli.workspaceWouldReclaim', { size: formatBytes(agentBytes) })
    app.out(`${success(agentId)}  ${hint(reclaimed)}`)
  }

  app.out('')
  app.out(
    style.heading(t(locale, 'cli.workspaceWouldReclaimHeading', { size: formatBytes(bytes) }))
  )
  return plan.failures === 0 ? 0 : 1
}

async function approveCleanup(
  options: CleanupOptions,
  plan: WorkspaceCleanupPlan,
  locale: Locale
): Promise<boolean> {
  const bytes = totalBytes(plan)
  const prompt = defaultPrompt()

  if (options.scope.kind === 'all' && options.olderThanMs === undefined) {
    const answer = await prompt(
      t(locale, 'cli.workspaceDeleteAllConfirm', {
        count: plan.agents.size,
        size: formatBytes(bytes),
        guard: DELETE_GUARD,
      })
    )

    return answer === DELETE_GUARD
  }

  if (options.yes) {
    return true
  }

  return confirm(
    prompt,
    t(locale, 'cli.workspaceDeleteEligibleConfirm', {
      count: plan.agents.size,
      size: formatBytes(bytes),
    }),
    locale
  )
}

function reportResult(result: WorkspaceCleanupResult, app: CliApp, locale: Locale): number {
  let totalFreed = 0
  let totalFailures = 0

  for (const [agentId, agent] of result.agents) {
    const agentResult: WorkspaceCleanupAgentResult = agent
    totalFreed += agentResult.removedBytes
    totalFailures += agentResult.failures
    app.out(`${success(agentId)}  ${hint(formatBytes(agentResult.removedBytes))}`)
  }

  app.out('')
  app.out(
    style.heading(t(locale, 'cli.workspaceReclaimedHeading', { size: formatBytes(totalFreed) }))
  )

  if (totalFailures > 0) {
    app.err(fail(t(locale, 'cli.workspaceCleanupFailures', { count: totalFailures })))
    return 1
  }

  return 0
}
