import type { CommandCatalog, KeyValidator, SlashDispatcher } from '@/commands/types'
import type { App, ServiceProvider } from '@/core/container'
import type { AgentId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import type { SlashCommand, SlashContext } from '@/core/types/command'
import type { Memory, MemoryScope } from '@/core/types/memory'
import type { AgentRegistry } from '@/engine/api'
import { type AgentCommandDeps, createAgentCommand } from '@/commands/agent'
import { type ConfigSummaryReader, createConfigCommand } from '@/commands/config'
import { type ContinueCommandDeps, createContinueCommand } from '@/commands/continue'
import { createCostCommand, type SpendCommandDeps, type SpendReader } from '@/commands/cost'
import { createSlashDispatcher } from '@/commands/dispatcher/dispatcher'
import { createHealthCommand, type HealthSummaryReader } from '@/commands/health'
import { createMemoryCommand } from '@/commands/memory'
import { createModelCommand, type ModelCommandDeps, type ModelControl } from '@/commands/model'
import { createResearchCommand } from '@/commands/research'
import { createScheduleCommand } from '@/commands/schedule'
import { createNewSessionCommand, type SessionReset } from '@/commands/session'
import { createUpgradeCommand, type ReleaseUpdates } from '@/commands/upgrade'

declare module '@/core/container' {
  interface Services {
    commands: readonly SlashCommand[]
    slashDispatcher: SlashDispatcher
    commandCatalog: CommandCatalog
    modelControl: ModelControl
    healthSummary: HealthSummaryReader
    releaseUpdates: ReleaseUpdates
    spendReader: SpendReader
  }
}

export interface CoreCommandDeps {
  readonly agents: AgentRegistry
  readonly pausedAgents: AgentCommandDeps['pausedAgents']
  readonly memory: Memory
  readonly spend: SpendCommandDeps
  readonly healthSummary: HealthSummaryReader
  readonly releases: ReleaseUpdates
  readonly modelControl: ModelControl
  readonly schedulerCommands: Parameters<typeof createScheduleCommand>[0]
  readonly scopeFor: (ctx: SlashContext) => Promise<MemoryScope>
  readonly agentFor: (ctx: SlashContext) => Promise<AgentId>
  readonly selectAgent: (ctx: SlashContext, target: AgentId | 'default') => Promise<void>
  readonly resetSession: SessionReset
  readonly configSummary: ConfigSummaryReader
  readonly continueCommand: ContinueCommandDeps
  readonly logger: Logger
}

export function createCoreCommands(deps: CoreCommandDeps): readonly SlashCommand[] {
  const agentDeps: AgentCommandDeps = {
    agents: deps.agents,
    pausedAgents: deps.pausedAgents,
    agentFor: deps.agentFor,
    selectAgent: deps.selectAgent,
  }
  const modelDeps: ModelCommandDeps = {
    control: deps.modelControl,
    agentFor: deps.agentFor,
  }

  return [
    createAgentCommand(agentDeps),
    createModelCommand(modelDeps),
    createResearchCommand(),
    createHealthCommand(deps.healthSummary),
    createUpgradeCommand(deps.releases),
    createMemoryCommand(deps.memory, deps.scopeFor, deps.logger),
    createCostCommand(deps.spend),
    createScheduleCommand(deps.schedulerCommands),
    createNewSessionCommand(deps.resetSession),
    createContinueCommand(deps.continueCommand),
    createConfigCommand(deps.configSummary),
  ]
}

// The command set is built lazily from `app`: the core commands need resolved services
// (agents, memory, spendReader, schedulerCommands), which do not exist until assembly finishes.
export function createCommandsProvider(
  build: (app: App) => readonly SlashCommand[],
  keys: KeyValidator
): ServiceProvider {
  return {
    name: 'commands',
    register(bind): void {
      bind('commands', (app) => build(app))
      bind('slashDispatcher', (app) => {
        const dispatcher = createSlashDispatcher({
          keys,
          logger: app.resolve('logger'),
          transcript: app.resolve('sessionStore'),
          ratePerMinute: app.config.commands.ratePerMinute,
        })
        for (const command of app.resolve('commands')) {
          dispatcher.register(command)
        }
        return dispatcher
      })
      bind('commandCatalog', (app) => app.resolve('slashDispatcher'))
    },
  }
}
