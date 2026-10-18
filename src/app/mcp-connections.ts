import type { ResolvedConfig } from '@/core/config/resolve'
import type { Logger } from '@/core/logging/logger'
import type { ToolDefinition } from '@/core/tool'
import { formatErrForLog } from '@/core/security/credentials'
import { connectServer } from '@/engine/api'

interface ConnectedMcpServer {
  readonly name: string
  readonly tools: readonly ToolDefinition[]
  close(): Promise<void>
}

interface McpConnections {
  readonly tools: readonly ToolDefinition[]
  close(): Promise<void>
}

// connectServer never throws: a refused, misconfigured or timed-out server logs and yields nothing,
// and so does one whose env var is unset.
// The daemon comes up either way — an MCP server being down is not a reason to have no agent.
export async function connectMcpServers(
  config: ResolvedConfig,
  logger: Logger
): Promise<McpConnections> {
  for (const err of config.mcp.unset) {
    logger.warn('mcp.env_missing', { err: formatErrForLog(err) })
  }

  const connections = (
    await Promise.all(config.mcp.servers.map((server) => connectMcpServer(server, logger)))
  ).filter((connection) => connection !== undefined)

  return {
    tools: connections.flatMap((connection) => connection.tools),
    close: async () => {
      // Settled, not all: one transport failing to close must not strand the others open.
      const results = await Promise.allSettled(connections.map((connection) => connection.close()))

      logMcpCloseFailures(logger, connections, results)
    },
  }
}

async function connectMcpServer(
  server: ResolvedConfig['mcp']['servers'][number],
  logger: Logger
): Promise<ConnectedMcpServer | undefined> {
  const connection = await connectServer(server, logger)

  if (connection === undefined) {
    return undefined
  }

  return { name: server.name, tools: connection.tools, close: connection.close }
}

function logMcpCloseFailures(
  logger: Logger,
  connections: readonly ConnectedMcpServer[],
  results: readonly PromiseSettledResult<void>[]
): void {
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      logger.warn('mcp.close_failed', {
        server: connections[index]?.name ?? 'unknown',
        err: formatErrForLog(result.reason),
      })
    }
  }
}
