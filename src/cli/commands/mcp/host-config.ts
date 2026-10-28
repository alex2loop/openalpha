import type { HostAddCommand, HostConfigFormat } from '@/cli/commands/mcp/hosts'
import type { SelfCommand } from '@/cli/services'
import { BRAND } from '@/core/brand'
import { MCP_CALL_WAIT_MS } from '@/engine/api'

const JSON_INDENT = 2
/** opencode and Kilo Code time out a local server in 5-10 s unless told otherwise, and a served
 *  call waits up to `MCP_CALL_WAIT_MS` before it answers `working`. */
const HOST_TIMEOUT_MS = MCP_CALL_WAIT_MS * 2
/** Muse Code refuses a settings file without its schema version. */
const MUSE_SCHEMA_VERSION = 1
const SHELL_SAFE_RE = /^[\w@%+=:,./-]+$/
const SINGLE_QUOTE_RE = /'/g
const QUOTED_SINGLE_QUOTE = `'\\''`

/** The server entry in the shape the app reads. The name is the brand, so every app lists it
 *  under the same key. */
export function buildHostConfig(format: HostConfigFormat, server: SelfCommand): string {
  const { command, args } = server

  switch (format) {
    case 'mcp-servers':
      return toJson({ mcpServers: { [BRAND.name]: { command, args } } })
    case 'vscode':
      return toJson({ servers: { [BRAND.name]: { type: 'stdio', command, args } } })
    case 'opencode':
      return toJson({
        mcp: {
          [BRAND.name]: {
            type: 'local',
            command: [command, ...args],
            enabled: true,
            timeout: HOST_TIMEOUT_MS,
          },
        },
        experimental: { mcp_timeout: HOST_TIMEOUT_MS },
      })
    case 'muse':
      // A required server that fails to start aborts every Muse Code run; optional skips it with a warning.
      return toJson({
        schema_version: MUSE_SCHEMA_VERSION,
        mcp_servers: {
          [BRAND.name]: { transport: 'stdio', command, args, mode: 'optional' },
        },
      })
    case 'zed':
      return toJson({ context_servers: { [BRAND.name]: { source: 'custom', command, args } } })
    case 'codex':
      // A JSON string and a JSON array of strings are also valid TOML values.
      return [
        `[mcp_servers.${BRAND.name}]`,
        `command = ${JSON.stringify(command)}`,
        `args = ${JSON.stringify(args)}`,
      ].join('\n')
    default: {
      const exhaustive: never = format
      return exhaustive
    }
  }
}

/** One line for the app's own CLI, which writes its config itself. */
export function buildAddCommand(kind: HostAddCommand, server: SelfCommand): string {
  const argv = [server.command, ...server.args]

  switch (kind) {
    case 'claude':
      return toShellLine(['claude', 'mcp', 'add', '--scope', 'user', BRAND.name, '--', ...argv])
    case 'codex':
      return toShellLine(['codex', 'mcp', 'add', BRAND.name, '--', ...argv])
    case 'vscode':
      return toShellLine([
        'code',
        '--add-mcp',
        JSON.stringify({ name: BRAND.name, command: server.command, args: server.args }),
      ])
    default: {
      const exhaustive: never = kind
      return exhaustive
    }
  }
}

function toJson(value: unknown): string {
  return JSON.stringify(value, null, JSON_INDENT)
}

function toShellLine(words: readonly string[]): string {
  return words.map(toShellWord).join(' ')
}

function toShellWord(word: string): string {
  return SHELL_SAFE_RE.test(word) ? word : `'${word.replace(SINGLE_QUOTE_RE, QUOTED_SINGLE_QUOTE)}'`
}
