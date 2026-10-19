import type { Command, Group } from '@/cli/command'
import { lazyCommand } from '@/cli/command'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'

export const BUILT_IN_COMMANDS: readonly (Command | Group)[] = [
  lazyCommand({
    ...CLI_COMMAND_METADATA.chat,
    load: async () => (await import('@/cli/commands/chat/chat')).handleChat,
  }),
  lazyCommand({
    ...CLI_COMMAND_METADATA.start,
    load: async () => (await import('@/cli/commands/daemon/daemon')).startCommand,
  }),
  lazyCommand({
    ...CLI_COMMAND_METADATA.stop,
    load: async () => (await import('@/cli/commands/daemon/daemon')).stopCommand,
  }),
  lazyCommand({
    ...CLI_COMMAND_METADATA.restart,
    load: async () => (await import('@/cli/commands/daemon/daemon')).restartCommand,
  }),
  lazyCommand({
    ...CLI_COMMAND_METADATA.status,
    load: async () => (await import('@/cli/commands/status')).statusCommand,
  }),
  lazyCommand({
    ...CLI_COMMAND_METADATA.version,
    load: async () => (await import('@/cli/commands/version')).versionCommand,
  }),
  lazyCommand({
    ...CLI_COMMAND_METADATA.upgrade,
    load: async () => (await import('@/cli/commands/upgrade')).upgradeCommand,
  }),
  lazyCommand({
    ...CLI_COMMAND_METADATA.doctor,
    load: async () => (await import('@/cli/commands/doctor/doctor')).doctorCommand,
  }),
  lazyCommand({
    ...CLI_COMMAND_METADATA.onboard,
    load: async () => (await import('@/cli/commands/onboard/onboard')).onboardCommand,
  }),
  lazyCommand({
    ...CLI_COMMAND_METADATA.agent,
    load: async () => (await import('@/cli/commands/agent')).agentCommand,
  }),
  lazyCommand({
    ...CLI_COMMAND_METADATA.social,
    load: async () => (await import('@/cli/commands/social/social')).socialCommand,
  }),
  lazyCommand({
    ...CLI_COMMAND_METADATA.config,
    load: async () => (await import('@/cli/commands/config')).configCommand,
  }),
  lazyCommand({
    ...CLI_COMMAND_METADATA.provider,
    load: async () => (await import('@/cli/commands/provider')).providerCommand,
  }),
  lazyCommand({
    ...CLI_COMMAND_METADATA.key,
    load: async () => (await import('@/cli/commands/key')).keyCommand,
  }),
  lazyCommand({
    ...CLI_COMMAND_METADATA.auth,
    load: async () => (await import('@/cli/commands/auth')).authCommand,
  }),
  lazyCommand({
    ...CLI_COMMAND_METADATA.plugin,
    load: async () => (await import('@/cli/commands/plugin')).pluginCommand,
  }),
  lazyCommand({
    ...CLI_COMMAND_METADATA.skill,
    load: async () => (await import('@/cli/commands/skill')).skillCommand,
  }),
  lazyCommand({
    ...CLI_COMMAND_METADATA.memory,
    load: async () => (await import('@/cli/commands/memory')).memoryCommand,
  }),
  lazyCommand({
    ...CLI_COMMAND_METADATA.history,
    load: async () => (await import('@/cli/commands/history')).historyCommand,
  }),
  lazyCommand({
    ...CLI_COMMAND_METADATA.cost,
    load: async () => (await import('@/cli/commands/cost')).costCommand,
  }),
  lazyCommand({
    ...CLI_COMMAND_METADATA.pair,
    load: async () => (await import('@/cli/commands/pair')).pairCommand,
  }),
  lazyCommand({
    ...CLI_COMMAND_METADATA.schedule,
    load: async () => (await import('@/cli/commands/schedule/schedule')).scheduleCommand,
  }),
  lazyCommand({
    ...CLI_COMMAND_METADATA.workflow,
    load: async () => (await import('@/cli/commands/workflow')).workflowCommand,
  }),
  lazyCommand({
    ...CLI_COMMAND_METADATA.db,
    load: async () => (await import('@/cli/commands/db/db')).dbCommand,
  }),
  lazyCommand({
    ...CLI_COMMAND_METADATA.logs,
    load: async () => (await import('@/cli/commands/logs/logs')).logsCommand,
  }),
  lazyCommand({
    ...CLI_COMMAND_METADATA.mcp,
    load: async () => (await import('@/cli/commands/mcp/mcp')).mcpCommand,
  }),
  lazyCommand({
    ...CLI_COMMAND_METADATA.workspace,
    load: async () => (await import('@/cli/commands/workspace')).workspaceCommand,
  }),
  lazyCommand({
    ...CLI_COMMAND_METADATA.zalo,
    load: async () => (await import('@/cli/commands/zalo')).zaloCommand,
  }),
]
