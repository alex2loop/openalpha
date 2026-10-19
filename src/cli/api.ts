// Public API of cli/.

export type { Command, CommandDef, Group, Needs } from '@/cli/command'
export type { ArgIssue } from '@/cli/parsing/args'
export type { GlobalFlags } from '@/cli/parsing/global-flags'
export type { PreBootOptions } from '@/cli/preboot'
export type { CliApp, ConfigProbe, Writer } from '@/cli/types'
export type { PendingUpgrade, UpdateChat, UpdateState } from '@/cli/update/state'
export type { ReleaseStatus } from '@/cli/update/status'
export { admitCommand, createCommand, createGroup, lazyCommand } from '@/cli/command'
export { readCommandCacheStubs, writeCommandCache } from '@/cli/command-cache'
export { spawnUpgradeProcess } from '@/cli/commands/daemon/background'
export { stopDaemonIfRunning } from '@/cli/commands/daemon/daemon'
export { isConfigPresent, starterConfigToml } from '@/cli/commands/onboard/config-file'
export { offerOnboard } from '@/cli/commands/onboard/onboard'
export { resolveContributedCliCommands } from '@/cli/contributed'
export { isBackgroundLaunch } from '@/cli/daemon-env'
export { readDaemonDegraded } from '@/cli/daemon-ready'
export { getEnv, isVerbose } from '@/cli/env'
export { type EnvFileLoad, loadEnvFile, reportKeyFile } from '@/cli/env-file'
export { formatTerminalError, printError, usage } from '@/cli/error-output'
export { preflightCommand, runCli } from '@/cli/main'
export { formatArgIssue } from '@/cli/parsing/arg-issue'
export { parseGlobalFlags } from '@/cli/parsing/global-flags'
export { preBootApp } from '@/cli/preboot'
export { BUILT_IN_COMMANDS } from '@/cli/registry'
export { createRoot } from '@/cli/root'
export { fail } from '@/cli/ui/colors'
export {
  formatInstalledNotice,
  formatUpdateNotice,
  readUpdateLine,
  startUpdateNotice,
  takeChatNotice,
  toChatText,
  UPGRADE_COMMAND,
} from '@/cli/update/notice'
export { isCompiledBinary } from '@/cli/update/release'
export {
  isUpdateCheckEnabled,
  newerVersionOf,
  patchUpdateState,
  readFreshUpdateState,
  readUpdateState,
  refreshUpdateState,
} from '@/cli/update/state'
export { readReleaseStatus } from '@/cli/update/status'
