import type { ResolvedConfig } from '@/core/config/resolve'
import type { AgentId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import type {
  CommandDescription,
  CommandMessageKey,
  LongRunningExecution,
  SlashCommand,
  SlashContext,
  SlashResult,
} from '@/core/types/command'
import type { DeclarativeSlashCommandSource } from '@/core/types/plugin'
import type { AgentProfile, Runner, Workflow } from '@/engine/api'
import { runWorkflow } from '@/engine/api'

const MESSAGE_KEYS: readonly CommandMessageKey[] = [
  'slash.pluginAgentUnavailable',
  'slash.pluginWorkflowUnavailable',
  'slash.pluginWorkflowDone',
  'slash.pluginWorkflowFail',
]

const DECLARATIVE_SURFACES = ['channel', 'repl'] as const
const DECLARATIVE_COOLDOWN_MS = 5_000
const WORKFLOW_EXECUTION: LongRunningExecution = { progressKey: 'slash.pluginWorkflowProgress' }

function declarativeIdempotencyKey(ctx: SlashContext): string {
  return ctx.requestId
}

interface DeclarativeCommandDeps {
  readonly agents: ReadonlyMap<string, AgentProfile>
  readonly workflows: ReadonlyMap<string, Workflow>
  readonly runner: Runner
  readonly config: ResolvedConfig
  readonly logger: Logger
}

export function createDeclarativeCommand(
  source: DeclarativeSlashCommandSource,
  deps: DeclarativeCommandDeps
): SlashCommand {
  const description: CommandDescription = { kind: 'plugin', text: source.description }
  const isWorkflow = source.target.kind === 'workflow'

  return {
    name: source.name,
    description,
    messageKeys: [...MESSAGE_KEYS],
    policy: {
      surfaces: [...DECLARATIVE_SURFACES],
      role: 'member',
      action: isWorkflow ? 'mutate' : 'costly',
      cooldownMs: DECLARATIVE_COOLDOWN_MS,
      idempotencyKey: declarativeIdempotencyKey,
      ...(isWorkflow ? { execution: WORKFLOW_EXECUTION } : {}),
    },
    run: async (ctx): Promise<SlashResult> => runDeclarativeCommand(source, deps, ctx),
  }
}

async function runDeclarativeCommand(
  source: DeclarativeSlashCommandSource,
  deps: DeclarativeCommandDeps,
  ctx: SlashContext
): Promise<SlashResult> {
  if (source.target.kind === 'agent') {
    return runAgentCommand(source.target, deps, ctx)
  }

  return runWorkflowCommand(source.target, deps, ctx)
}

function runAgentCommand(
  target: { readonly kind: 'agent'; readonly id: AgentId; readonly prompt: string },
  deps: DeclarativeCommandDeps,
  ctx: SlashContext
): SlashResult {
  if (!deps.agents.has(target.id)) {
    return {
      kind: 'message',
      messages: [{ key: 'slash.pluginAgentUnavailable', values: { id: target.id } }],
    }
  }

  return {
    kind: 'agent',
    agentId: target.id,
    retryMessage: [target.prompt, ...ctx.args].filter((part) => part !== '').join(' '),
  }
}

async function runWorkflowCommand(
  target: { readonly kind: 'workflow'; readonly id: string },
  deps: DeclarativeCommandDeps,
  ctx: SlashContext
): Promise<SlashResult> {
  const workflow = deps.workflows.get(target.id)

  if (workflow === undefined) {
    return {
      kind: 'message',
      messages: [{ key: 'slash.pluginWorkflowUnavailable', values: { id: target.id } }],
    }
  }

  const result = await runWorkflow({
    runner: deps.runner,
    config: deps.config,
    logger: deps.logger,
    workflow,
    invocation: {
      channel: ctx.channel,
      userId: ctx.userId,
      chatId: ctx.chatId,
      parentSignal: ctx.signal,
    },
  })

  if (ctx.signal.aborted) {
    return { kind: 'handled' }
  }

  return result.ok
    ? {
        kind: 'message',
        messages: [
          { key: 'slash.pluginWorkflowDone', values: { id: workflow.id, steps: result.steps } },
        ],
      }
    : {
        kind: 'message',
        messages: [{ key: 'slash.pluginWorkflowFail', values: { id: workflow.id } }],
      }
}
