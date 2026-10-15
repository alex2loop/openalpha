import type { Command } from '@/cli/command'
import type { ParsedArgs } from '@/cli/parsing/args'
import type { CliApp } from '@/cli/types'
import type { AgentId } from '@/core/ids'
import { createCommand } from '@/cli/command'
import { usage } from '@/cli/error-output'
import { flagBool, flagString } from '@/cli/parsing/args'
import { hint, success } from '@/cli/ui/colors'
import { agentId } from '@/core/ids'
import { t } from '@/i18n'

type PauseAction = 'pause' | 'resume'

const ALL_FLAG = {
  type: 'boolean',
  describe: { key: 'cliHelp.flagAllAgents' },
} as const

export const agentCmdPause: Command = createCommand({
  name: 'pause',
  summary: { key: 'cliHelp.agentPauseSummary' },
  spec: { positional: ['id'], positionalOptional: true, flags: { all: ALL_FLAG } },
  run: (args, app) => setPaused('pause', args, app),
})

export const agentCmdResume: Command = createCommand({
  name: 'resume',
  summary: { key: 'cliHelp.agentResumeSummary' },
  spec: { positional: ['id'], positionalOptional: true, flags: { all: ALL_FLAG } },
  run: (args, app) => setPaused('resume', args, app),
})

type Selection =
  | { readonly kind: 'ids'; readonly ids: readonly AgentId[] }
  | { readonly kind: 'usage'; readonly message: string }

// Only the operator's own agents: pausing a debate persona would break every suggestion.
function selectAgents(action: PauseAction, args: ParsedArgs, app: CliApp): Selection {
  const locale = app.config.locale.language
  const userIds = app.resolve('userAgentIds')
  const raw = flagString(args, 'id')

  if (flagBool(args, 'all')) {
    return { kind: 'ids', ids: [...userIds].sort() }
  }

  if (raw === undefined) {
    return { kind: 'usage', message: t(locale, 'cli.agentPauseUsage', { action }) }
  }

  if (userIds.has(agentId(raw))) {
    return { kind: 'ids', ids: [agentId(raw)] }
  }

  const known = app.resolve('agents').has(raw)

  return {
    kind: 'usage',
    message: known
      ? t(locale, 'cli.agentNotUser', { agent: raw })
      : t(locale, 'cli.agentUnknown', { id: raw }),
  }
}

async function setPaused(action: PauseAction, args: ParsedArgs, app: CliApp): Promise<number> {
  const locale = app.config.locale.language
  const selection = selectAgents(action, args, app)

  if (selection.kind === 'usage') {
    return usage(app, selection.message)
  }

  if (selection.ids.length === 0) {
    app.out(hint(t(locale, 'cli.agentNoAgents')))

    return 0
  }

  const store = app.resolve('agentPauseStore')

  if (action === 'pause') {
    await store.pause(selection.ids, Date.now())
  } else {
    await store.resume(selection.ids)
  }

  const agents = selection.ids.join(', ')
  const key = action === 'pause' ? 'cli.agentPaused' : 'cli.agentResumed'

  app.out(success(t(locale, key, { agents })))

  return 0
}
