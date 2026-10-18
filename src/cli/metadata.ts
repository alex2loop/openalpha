import type { LocalizedText } from '@/cli/types'
import { BRAND } from '@/core/brand'

export const CLI_ROOT_SUMMARY = {
  key: 'cliHelp.rootSummary',
  params: { brand: BRAND.display, command: BRAND.name },
} satisfies LocalizedText

interface CommandMetadata {
  readonly name: string
  readonly summary: LocalizedText
}

export const CLI_COMMAND_METADATA = {
  chat: {
    name: 'chat',
    summary: { key: 'cliHelp.commandChatSummary' },
  },
  start: {
    name: 'start',
    summary: { key: 'cliHelp.commandStartSummary' },
  },
  stop: {
    name: 'stop',
    summary: { key: 'cliHelp.commandStopSummary' },
  },
  restart: {
    name: 'restart',
    summary: { key: 'cliHelp.commandRestartSummary' },
  },
  status: {
    name: 'status',
    summary: { key: 'cliHelp.commandStatusSummary', params: { brand: BRAND.display } },
  },
  help: {
    name: 'help',
    summary: { key: 'cliHelp.commandHelpSummary' },
  },
  version: {
    name: 'version',
    summary: { key: 'cliHelp.commandVersionSummary', params: { brand: BRAND.display } },
  },
  upgrade: {
    name: 'upgrade',
    summary: { key: 'cliHelp.commandUpgradeSummary', params: { brand: BRAND.display } },
  },
  doctor: {
    name: 'doctor',
    summary: { key: 'cliHelp.commandDoctorSummary' },
  },
  onboard: {
    name: 'onboard',
    summary: { key: 'cliHelp.commandOnboardSummary', params: { brand: BRAND.display } },
  },
  agent: {
    name: 'agent',
    summary: { key: 'cliHelp.commandAgentSummary' },
  },
  social: {
    name: 'social',
    summary: { key: 'cliHelp.commandSocialSummary' },
  },
  config: {
    name: 'config',
    summary: { key: 'cliHelp.commandConfigSummary' },
  },
  provider: {
    name: 'provider',
    summary: { key: 'cliHelp.commandProviderSummary' },
  },
  auth: {
    name: 'auth',
    summary: { key: 'cliHelp.commandAuthSummary' },
  },
  plugin: {
    name: 'plugin',
    summary: { key: 'cliHelp.commandPluginSummary' },
  },
  skill: {
    name: 'skill',
    summary: { key: 'cliHelp.commandSkillSummary' },
  },
  memory: {
    name: 'memory',
    summary: { key: 'cliHelp.commandMemorySummary' },
  },
  history: {
    name: 'history',
    summary: { key: 'cliHelp.commandHistorySummary' },
  },
  cost: {
    name: 'cost',
    summary: { key: 'cliHelp.commandCostSummary' },
  },
  pair: {
    name: 'pair',
    summary: { key: 'cliHelp.commandPairSummary' },
  },
  schedule: {
    name: 'schedule',
    summary: { key: 'cliHelp.commandScheduleSummary' },
  },
  workflow: {
    name: 'workflow',
    summary: { key: 'cliHelp.commandWorkflowSummary' },
  },
  db: {
    name: 'db',
    summary: { key: 'cliHelp.commandDbSummary' },
  },
  logs: {
    name: 'logs',
    summary: { key: 'cliHelp.commandLogsSummary', params: { brand: BRAND.display } },
  },
  mcp: {
    name: 'mcp',
    summary: { key: 'cliHelp.commandMcpSummary' },
  },
  workspace: {
    name: 'workspace',
    summary: { key: 'cliHelp.commandWorkspaceSummary' },
  },
  zalo: {
    name: 'zalo',
    summary: { key: 'cliHelp.commandZaloSummary' },
  },
} satisfies Record<string, CommandMetadata>

export const CLI_FLAG_DESCRIPTIONS = {
  skipConfirmation: { key: 'cliHelp.flagSkipConfirmation' },
  limitToAgent: { key: 'cliHelp.flagLimitToAgent' },
  daemonLogScope: { key: 'cliHelp.flagDaemonLogScope' },
  runInBackground: { key: 'cliHelp.flagRunInBackground' },
  retentionWindow: { key: 'cliHelp.flagRetentionWindow' },
  previewWithoutDeleting: { key: 'cliHelp.flagPreviewWithoutDeleting' },
} satisfies Record<string, LocalizedText>
