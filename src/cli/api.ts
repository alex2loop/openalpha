// Public API of cli/.

export type { Command, CommandDef, Group, Needs } from '@/cli/command'
export type { CheckedProbe, DoctorInput } from '@/cli/commands/doctor/types'
export type { ArgIssue } from '@/cli/parsing/args'
export type { GlobalFlags } from '@/cli/parsing/global-flags'
export type { PreBootOptions } from '@/cli/preboot'
export type {
  EditorExit,
  Terminal,
  TerminalEnv,
  TerminalInput,
  TerminalOutput,
} from '@/cli/terminal'
export type { CliApp, ConfigProbe, Writer } from '@/cli/types'
export type { PendingUpgrade, UpdateChat, UpdateState } from '@/cli/update/state'
export type { ReleaseStatus } from '@/cli/update/status'
export {
  admitCommand,
  createCommand,
  createGroup,
  isForwardable,
  lazyCommand,
} from '@/cli/command'
export { readCommandCacheStubs, writeCommandCache } from '@/cli/command-cache'
export {
  spawnRestartProcess,
  spawnUpgradeProcess,
  waitUntilDaemonReady,
} from '@/cli/commands/daemon/background'
export {
  readRestartFlags,
  stopDaemonIfRunning,
  waitForRestart,
} from '@/cli/commands/daemon/daemon'
export {
  CLI_ONLY_CHECK_NAMES,
  collectDoctorProbes,
  WEB_CHECK_NAMES,
} from '@/cli/commands/doctor/checks'
export { checkLabel } from '@/cli/commands/doctor/labels'
export {
  isConfigPresent,
  saveEditedConfig,
  starterConfigToml,
} from '@/cli/commands/onboard/config-file'
export { offerOnboard } from '@/cli/commands/onboard/onboard'
export { isBackgroundLaunch } from '@/cli/daemon-env'
export { liveDaemon } from '@/cli/daemon-guard'
export { isDaemonReady, readDaemonDegraded } from '@/cli/daemon-ready'
export {
  canRestartInPlace,
  execSelf,
  isRestartRequested,
  RESTART_SIGNAL,
} from '@/cli/daemon-restart'
export { editorFromEnv, getEnv, isVerbose } from '@/cli/env'
export {
  type EnvFileLoad,
  isRuntimeEnvName,
  type KeyFile,
  loadEnvFile,
  readEnvFile,
  removeEnvFileValue,
  reportKeyFile,
  writeEnvFileValue,
} from '@/cli/env-file'
export {
  EXIT_TERMINATED,
  formatTerminalError,
  printDaemonLost,
  printError,
  usage,
} from '@/cli/error-output'
export { preflightCommand, resolveCliCommands, resolveCommandPath, runCli } from '@/cli/main'
export { type KeyEnvGroup, keyEnvGroups } from '@/cli/missing-keys'
export { formatArgIssue } from '@/cli/parsing/arg-issue'
export { parseGlobalFlags } from '@/cli/parsing/global-flags'
export { preBootApp } from '@/cli/preboot'
export { BUILT_IN_COMMANDS } from '@/cli/registry'
export { createRoot } from '@/cli/root'
export {
  installProcessTerminal,
  pickTerminalEnv,
  toTerminalWriters,
  withTerminal,
} from '@/cli/terminal'
export { fail, hint, success, warn } from '@/cli/ui/colors'
export {
  formatInstalledNotice,
  formatUpdateNotice,
  readUpdateLine,
  startUpdateNotice,
  takeChatNotice,
  toChatText,
  UPGRADE_COMMAND,
} from '@/cli/update/notice'
export { isCompiledBinary, UPDATE_CHECK_HOST } from '@/cli/update/release'
export {
  isUpdateCheckEnabled,
  newerVersionOf,
  patchUpdateState,
  readFreshUpdateState,
  readUpdateState,
  refreshUpdateState,
} from '@/cli/update/state'
export { readReleaseStatus } from '@/cli/update/status'
