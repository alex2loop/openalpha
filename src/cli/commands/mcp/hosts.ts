import type { MessageKey } from '@/i18n'

/** How an app writes its MCP server list: each is a different file shape. */
export type HostConfigFormat = 'mcp-servers' | 'vscode' | 'opencode' | 'codex' | 'muse' | 'zed'

/** An app whose own CLI adds a server, so the operator can paste one line instead of editing JSON. */
export type HostAddCommand = 'claude' | 'codex' | 'vscode'

interface HostSkill {
  /** Where the app reads user-scoped skills. `~` is expanded at install time. */
  readonly dir: string
  /** Locale key for the invocation line, absent where the app renders no command to type. */
  readonly invocation?: MessageKey
}

/** Where the app reads user-scoped subagents, in Claude Code's file format. Only a host whose
 *  subagents run on the app's own model in a context of their own gets one; every other host
 *  answers requests inline. */
interface HostAgent {
  readonly dir: string
}

export interface McpHost {
  /** Shown to the operator as written; the app, not this command, edits it. */
  readonly configFile: string
  readonly format: HostConfigFormat
  readonly addCommand?: HostAddCommand
  /** Absent for an app with no skills folder: it reads the rules from the server when it connects. */
  readonly skill?: HostSkill
  readonly agent?: HostAgent
}

const MCP_HOSTS = {
  'claude-code': {
    configFile: '.mcp.json',
    format: 'mcp-servers',
    addCommand: 'claude',
    skill: { dir: '~/.claude/skills', invocation: 'cli.mcpInstallSkillCommand' },
    agent: { dir: '~/.claude/agents' },
  },
  'claude-desktop': {
    configFile: '~/Library/Application Support/Claude/claude_desktop_config.json',
    format: 'mcp-servers',
  },
  codex: {
    configFile: '~/.codex/config.toml',
    format: 'codex',
    addCommand: 'codex',
    skill: { dir: '~/.agents/skills' },
  },
  cursor: {
    configFile: '~/.cursor/mcp.json',
    format: 'mcp-servers',
    skill: { dir: '~/.cursor/skills' },
  },
  gemini: {
    configFile: '~/.gemini/settings.json',
    format: 'mcp-servers',
    skill: { dir: '~/.gemini/skills' },
  },
  // Kilo Code 7+ reads opencode's `mcp` shape.
  'kilo-code': {
    configFile: '~/.config/kilo/kilo.jsonc',
    format: 'opencode',
    skill: { dir: '~/.kilo/skills' },
  },
  muse: {
    configFile: '~/.config/muse/settings.json',
    format: 'muse',
    skill: { dir: '~/.config/muse/skills' },
  },
  opencode: {
    configFile: '~/.config/opencode/opencode.json',
    format: 'opencode',
    skill: { dir: '~/.config/opencode/skills' },
  },
  vscode: {
    configFile: '.vscode/mcp.json',
    format: 'vscode',
    addCommand: 'vscode',
    skill: { dir: '~/.copilot/skills' },
  },
  windsurf: {
    configFile: '~/.codeium/windsurf/mcp_config.json',
    format: 'mcp-servers',
  },
  zed: {
    configFile: '~/.config/zed/settings.json',
    format: 'zed',
  },
  agents: {
    configFile: '.mcp.json',
    format: 'mcp-servers',
    skill: { dir: '~/.agents/skills' },
  },
} as const satisfies Record<string, McpHost>

export type McpHostId = keyof typeof MCP_HOSTS

export const MCP_HOST_IDS: readonly string[] = Object.keys(MCP_HOSTS)

export const DEFAULT_MCP_HOST: McpHostId = 'claude-code'

export function resolveMcpHost(id: McpHostId): McpHost {
  return MCP_HOSTS[id]
}
