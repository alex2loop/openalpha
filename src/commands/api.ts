// Public API of commands/. Other modules import from here — never from commands/ internals.

export type { ConfigSummary, ConfigSummaryReader } from '@/commands/config'
export type { ContinueNudge } from '@/commands/continue'
export type { SpendCommandDeps, SpendReader } from '@/commands/cost'
export type {
  ChannelHealth,
  HealthCode,
  HealthSummary,
  HealthSummaryReader,
} from '@/commands/health'
export type {
  ModelCommandDeps,
  ModelControl,
  ModelSummary,
  SelectableModel,
  SessionModelSelection,
} from '@/commands/model'
export type { CoreCommandDeps } from '@/commands/services'
export type {
  CommandCatalog,
  KeyValidator,
  ResolvedSlashCommand,
  SlashDispatcher,
} from '@/commands/types'
export type {
  ReleaseUpdates,
  UpgradeReply,
  UpgradeRequest,
} from '@/commands/upgrade'
export type { SlashCommand, SlashContext, SlashResult } from '@/core/types/command'
export {
  type CommandHelpOptions,
  type HelpControl,
  type HelpRequest,
  parseHelpLine,
  renderCommandHelp,
} from '@/commands/dispatcher/help'
export {
  collectSlashCommandIssues,
  createSlashCommand,
} from '@/commands/dispatcher/registration'
export { describeCommand, type LocaleLookup, renderMessages } from '@/commands/dispatcher/render'
export { commandHeadOf, HELP_COMMAND } from '@/commands/dispatcher/resolve'
export { createSessionModelSelection } from '@/commands/model'
export { createCommandsProvider, createCoreCommands } from '@/commands/services'
export { UPGRADE_CHAT_COMMAND, UPGRADE_CONFIRM_COMMAND } from '@/commands/upgrade'
