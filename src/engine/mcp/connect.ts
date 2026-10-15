import { CallToolResultSchema, type Tool as McpTool } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import type { ResolvedMcpServer } from '@/core/config/resolve'
import type { Logger } from '@/core/logging/logger'
import type { ToolDefinition } from '@/core/tool'
import { ConfigError, ToolError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { scanSkill } from '@/core/security/sanitize'
import { createTool } from '@/core/tool'
import { hashString } from '@/core/utils/hash'
import {
  MCP_DISCOVERY_TIMEOUT_MS,
  MCP_MAX_TOOL_DESCRIPTION_BYTES,
  MCP_MAX_TOOL_SCHEMA_BYTES,
} from '@/engine/constants'
import { McpSession, withDeadline } from '@/engine/mcp/session'

const ENCODER = new TextEncoder()
// Providers accept tool names matching `^[a-zA-Z0-9_-]{1,64}$`.
const TOOL_NAME_MAX_LENGTH = 64
const TOOL_NAME_UNSAFE_RE = /[^A-Za-z0-9_-]/g

// A bare executable name or path never contains shell operators; their presence means someone is
// smuggling a shell invocation through the command field. (StdioClientTransport spawns no shell.)
const SHELL_METACHARS_RE = /[;&|`$<>\n\r]/

type McpCallResult = z.infer<typeof CallToolResultSchema>
type McpContentBlock = McpCallResult['content'][number]

export interface McpConnection {
  readonly tools: readonly ToolDefinition[]
  close(): Promise<void>
}

// Connect, list, and wrap, hard-bounded by MCP_DISCOVERY_TIMEOUT_MS. Any failure (refused, bad
// command, timeout) logs, closes (killing the stdio child or aborting the HTTP session), and yields
// undefined. Never throws: one bad server must not take the process down.
export async function connectServer(
  server: ResolvedMcpServer,
  logger: Logger
): Promise<McpConnection | undefined> {
  const blocked = blockReason(server)

  if (blocked !== undefined) {
    logger.warn('mcp.blocked', { server: server.name, reason: blocked })

    return undefined
  }

  const session = new McpSession(server, logger)
  const close = (): Promise<void> => session.close()

  const discovery = discover(session, server, logger)
  // If the deadline abandons it, the late rejection must not become an unhandled rejection.
  discovery.catch(() => undefined)

  try {
    const tools = await withDeadline(discovery, MCP_DISCOVERY_TIMEOUT_MS)

    if (tools === undefined) {
      logger.warn('mcp.connect_timeout', {
        server: server.name,
        timeoutMs: MCP_DISCOVERY_TIMEOUT_MS,
      })
      await closeAfterDiscoveryFailure(close, server.name, logger)

      return undefined
    }

    logger.info('mcp.connected', { server: server.name, tools: tools.length })

    return { tools, close }
  } catch (err: unknown) {
    logger.error('mcp.connect_failed', { server: server.name, err: formatErrForLog(err) })
    await closeAfterDiscoveryFailure(close, server.name, logger)

    return undefined
  }
}

async function closeAfterDiscoveryFailure(
  close: () => Promise<void>,
  server: string,
  logger: Logger
): Promise<void> {
  try {
    await close()
  } catch (err: unknown) {
    logger.warn('mcp.discovery_close_failed', { server, err: formatErrForLog(err) })
  }
}

async function discover(
  session: McpSession,
  server: ResolvedMcpServer,
  logger: Logger
): Promise<readonly ToolDefinition[]> {
  const remoteTools = await session.open()

  assertUniqueToolNames(server.name, remoteTools)

  const tools: ToolDefinition[] = []
  const taken = new Set<string>()

  for (const remote of remoteTools) {
    const name = toProviderToolName(server.name, remote.name)

    if (taken.has(name)) {
      logger.warn('mcp.tool_name_collision', { server: server.name, tool: remote.name })
      continue
    }

    taken.add(name)
    tools.push(wrapMcpTool({ session, server, remote, name, logger }))
  }

  return tools
}

// A name that is altered or cut to fit carries a hash of the original, so two remote spellings
// cannot land on one provider name. The remote's own name is still what `callTool` receives.
function toProviderToolName(server: string, remote: string): string {
  const name = `mcp__${server}__${remote}`
  const safe = name.replace(TOOL_NAME_UNSAFE_RE, '_')

  if (safe === name && name.length <= TOOL_NAME_MAX_LENGTH) {
    return name
  }

  const suffix = `_${hashString(name)}`

  return `${safe.slice(0, TOOL_NAME_MAX_LENGTH - suffix.length)}${suffix}`
}

function assertUniqueToolNames(server: string, tools: readonly McpTool[]): void {
  const names = new Set<string>()

  for (const remote of tools) {
    if (names.has(remote.name)) {
      throw new ConfigError(`mcp server "${server}" advertised duplicate tool "${remote.name}"`)
    }

    names.add(remote.name)
  }
}

interface WrapMcpToolOptions {
  readonly session: McpSession
  readonly server: ResolvedMcpServer
  readonly remote: McpTool
  readonly name: string
  readonly logger: Logger
}

function wrapMcpTool(options: WrapMcpToolOptions): ToolDefinition {
  const { session, remote } = options
  const jsonSchema = safeSchema(options)

  return createTool({
    name: options.name,
    description: safeDescription(options),
    // Passthrough: the remote server validates args, and advertises its own schema to the model.
    inputSchema: z.looseObject({}),
    ...(jsonSchema === undefined ? {} : { jsonSchema }),
    capability: 'net',
    // External code always reaches the active run's approval policy after admission.
    isExternal: true,
    execute: async (input, ctx): Promise<string> => {
      const raw = await session.call(
        { name: remote.name, arguments: asArguments(input) },
        ctx.signal
      )
      // The SDK's return type also admits a legacy `{ toolResult }` shape whose `content` is
      // untyped; re-parsing narrows to the modern result without an assertion.
      const parsed = CallToolResultSchema.safeParse(raw)

      if (!parsed.success) {
        throw new ToolError('unexpected', `MCP tool ${remote.name} returned an unusable result`)
      }

      const text = flattenContent(parsed.data.content)

      if (parsed.data.isError === true) {
        throw new ToolError('unexpected', text === '' ? `MCP tool ${remote.name} failed` : text)
      }

      return text
    },
  })
}

function blockReason(server: ResolvedMcpServer): string | undefined {
  if (server.transport !== 'stdio') {
    return undefined
  }

  if (server.command.trim() === '' || SHELL_METACHARS_RE.test(server.command)) {
    return 'command is empty or contains shell metacharacters'
  }

  return undefined
}

// Tool metadata is advertised to the model as authoritative instruction - a surface the executor's
// result scan does not cover. A detected injection is dropped entirely; prefixing a warning would
// still deliver the payload.
function safeDescription(options: WrapMcpToolOptions): string {
  const { server, remote, logger } = options
  const raw = remote.description
  const text = raw !== undefined && raw.trim() !== '' ? raw : remote.name
  const reason = metadataBlockReason(text, MCP_MAX_TOOL_DESCRIPTION_BYTES)

  if (reason === undefined) {
    return text
  }

  logger.warn('mcp.tool_description_blocked', { server: server.name, tool: remote.name, reason })
  return remote.name
}

// The schema (nested descriptions included) reaches the model verbatim; on detected injection or an
// oversized payload the tool degrades to a schema derived from the passthrough input - the server
// still validates its own args.
function safeSchema(options: WrapMcpToolOptions): McpTool['inputSchema'] | undefined {
  const { server, remote, logger } = options
  const reason = metadataBlockReason(JSON.stringify(remote.inputSchema), MCP_MAX_TOOL_SCHEMA_BYTES)

  if (reason === undefined) {
    return remote.inputSchema
  }

  logger.warn('mcp.tool_schema_blocked', { server: server.name, tool: remote.name, reason })
  return undefined
}

// Discovery is boot-time, so the full skill scan (leet flatten, vi/zh locales) is affordable here.
// Only block-tier findings disqualify: the caution tier flags words like curl or process.env,
// which are legitimate in tool documentation.
function metadataBlockReason(
  text: string,
  maxBytes: number
): 'oversized' | 'injection' | undefined {
  if (ENCODER.encode(text).byteLength > maxBytes) {
    return 'oversized'
  }
  return scanSkill(text).some((threat) => threat.severity === 'block') ? 'injection' : undefined
}

function flattenContent(content: readonly McpContentBlock[]): string {
  return content.map(blockToText).join('\n')
}

function blockToText(block: McpContentBlock): string {
  if (block.type === 'text') {
    return block.text
  }

  if (block.type === 'image' || block.type === 'audio') {
    return `[${block.type} ${block.mimeType}]`
  }

  if (block.type === 'resource') {
    return `[resource ${'uri' in block.resource ? block.resource.uri : ''}]`
  }

  return `[${block.type}]`
}

function asArguments(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input) ? { ...input } : {}
}
