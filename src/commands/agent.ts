import type { AgentId } from '@/core/ids'
import type { AgentPauseStore } from '@/core/types/agent-pause'
import type {
  CommandDescription,
  SlashCommand,
  SlashContext,
  SlashResult,
} from '@/core/types/command'
import type { AgentRegistry } from '@/engine/api'

const MESSAGE_KEYS = [
  'slash.agentCurrent',
  'slash.agentUnknown',
  'slash.agentSet',
  'slash.agentPausedSelected',
  'slash.agentTerminalHint',
] as const
const DEFAULT_AGENT = 'default'

const DESCRIPTION: CommandDescription = { kind: 'localized', key: 'slash.agentHelp' }
const READ_POLICY = {
  surfaces: ['channel', 'repl'] as const,
  role: 'member' as const,
  action: 'read' as const,
}
const SELECT_POLICY = {
  surfaces: ['channel'] as const,
  role: 'operator' as const,
  action: 'mutate' as const,
  idempotencyKey: (ctx: SlashContext) => ctx.requestId,
  surfaceHint: 'slash.agentTerminalHint' as const,
}

export interface AgentCommandDeps {
  readonly agents: AgentRegistry
  readonly pausedAgents: Pick<AgentPauseStore, 'isPaused'>
  readonly agentFor: (ctx: SlashContext) => Promise<AgentId>
  readonly selectAgent: (ctx: SlashContext, target: AgentId | 'default') => Promise<void>
}

export function createAgentCommand(deps: AgentCommandDeps): SlashCommand {
  return {
    name: 'agent',
    description: DESCRIPTION,
    messageKeys: [...MESSAGE_KEYS],
    policy: READ_POLICY,
    policyFor: (args) => (args.length > 0 ? SELECT_POLICY : READ_POLICY),
    completeFor: (args) => (args.length === 1 ? agentTargets(deps.agents) : []),
    run: async (ctx: SlashContext): Promise<SlashResult> => runAgentCommand(deps, ctx),
  }
}

async function runAgentCommand(deps: AgentCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  const requested = ctx.args[0]

  if (requested === undefined) {
    return {
      kind: 'message',
      messages: [{ key: 'slash.agentCurrent', values: { id: await deps.agentFor(ctx) } }],
    }
  }

  if (ctx.args.length > 1) {
    return {
      kind: 'message',
      messages: [
        {
          key: 'slash.agentUnknown',
          values: { id: ctx.args.join(' '), list: agentList(deps.agents) },
        },
      ],
    }
  }

  if (requested === DEFAULT_AGENT) {
    await deps.selectAgent(ctx, requested)

    return { kind: 'message', messages: [{ key: 'slash.agentSet', values: { id: requested } }] }
  }

  const agent = deps.agents.get(requested)

  if (!agent) {
    return {
      kind: 'message',
      messages: [
        { key: 'slash.agentUnknown', values: { id: requested, list: agentList(deps.agents) } },
      ],
    }
  }

  await deps.selectAgent(ctx, agent.id)

  const set = { key: 'slash.agentSet', values: { id: agent.id } } as const

  // Selecting is still allowed: the chat is bound, and the agent answers again once resumed.
  return {
    kind: 'message',
    messages: (await isPausedOrUnknown(deps.pausedAgents, agent.id))
      ? [set, { key: 'slash.agentPausedSelected' }]
      : [set],
  }
}

// The selection already happened; an unreadable pause only drops the notice.
async function isPausedOrUnknown(
  store: AgentCommandDeps['pausedAgents'],
  id: AgentId
): Promise<boolean> {
  try {
    return await store.isPaused(id)
  } catch {
    return false
  }
}

function agentList(agents: AgentRegistry): string {
  return agentTargets(agents).join(', ')
}

function agentTargets(agents: AgentRegistry): readonly string[] {
  return [DEFAULT_AGENT, ...agents.all().map((item) => item.id)]
}
