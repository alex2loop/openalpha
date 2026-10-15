import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  CallToolResultSchema,
  ErrorCode,
  McpError,
  type Tool as McpTool,
} from '@modelcontextprotocol/sdk/types.js'

import type { ResolvedMcpServer } from '@/core/config/resolve'
import type { Logger } from '@/core/logging/logger'
import { BRAND } from '@/core/brand'
import { ConfigError, ToolError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { NetworkPolicy } from '@/core/ssrf/network-policy'
import {
  MCP_CALL_TIMEOUT_MS,
  MCP_DISCOVERY_TIMEOUT_MS,
  MCP_MAX_TOOL_PAGES,
  MCP_MAX_TOOLS,
  MCP_RECONNECT_COOLDOWN_MS,
} from '@/engine/constants'

const CLIENT_INFO = { name: BRAND.name, version: BRAND.version }
const TOOL_NAME_SEPARATOR = '\n'

interface McpCallParams {
  readonly name: string
  readonly arguments: Record<string, unknown>
}

/** One MCP server's connection. The tool registry is frozen at boot, so a lost connection is
 *  re-dialed lazily by the next call, never by a timer: a server that stays down costs nothing. */
export class McpSession {
  private current: Client
  private connecting: Client | undefined
  private flight: Promise<void> | undefined
  private toolNames: string | undefined
  private down = false
  private closed = false
  private retryAt = 0

  constructor(
    private readonly server: ResolvedMcpServer,
    private readonly logger: Logger
  ) {
    this.current = this.createClient()
  }

  /** Dials and lists the server's tools; the list becomes the one a reconnect must reproduce. */
  async open(): Promise<readonly McpTool[]> {
    const remote = await this.dial(this.current)

    this.toolNames = namesOf(remote)

    return remote
  }

  /** Throws ToolError('server_unavailable') while the server is down and cannot be redialed. */
  async call(params: McpCallParams, signal: AbortSignal): Promise<unknown> {
    const client = await this.ensureUp()

    try {
      return await client.callTool(params, CallToolResultSchema, {
        signal,
        timeout: MCP_CALL_TIMEOUT_MS,
      })
    } catch (err: unknown) {
      if (isConnectionFailure(err)) {
        this.markDown(client)
      }

      throw err
    }
  }

  // Closes whichever clients exist, so a reconnect in flight cannot strand a child process.
  async close(): Promise<void> {
    this.closed = true

    const clients = this.connecting === undefined ? [this.current] : [this.current, this.connecting]
    const results = await Promise.allSettled(clients.map((client) => client.close()))
    const failed = results.find((result) => result.status === 'rejected')

    if (failed !== undefined) {
      throw failed.reason
    }
  }

  private createClient(): Client {
    const client = new Client(CLIENT_INFO)

    client.onclose = (): void => this.markDown(client)

    return client
  }

  private async dial(client: Client): Promise<readonly McpTool[]> {
    await client.connect(createTransport(this.server))

    return await listAll(client, this.server.name)
  }

  // A stale client's close fires after it was replaced, and our own close is not an outage.
  private markDown(client: Client): void {
    if (this.closed || this.down || client !== this.current) {
      return
    }

    this.down = true
    this.logger.warn('mcp.server_down', { server: this.server.name })
  }

  private async ensureUp(): Promise<Client> {
    if (!this.down) {
      return this.current
    }

    if (this.flight === undefined) {
      const now = Date.now()

      if (now < this.retryAt) {
        throw this.unavailable('reconnect is cooling down')
      }

      this.retryAt = now + MCP_RECONNECT_COOLDOWN_MS
      this.flight = this.reconnect().finally(() => {
        this.flight = undefined
      })
    }

    await this.flight

    return this.current
  }

  private async reconnect(): Promise<void> {
    const fresh = this.createClient()

    this.connecting = fresh

    try {
      await this.closeQuietly(this.current)
      await this.adopt(fresh)
    } catch (err: unknown) {
      this.logger.warn('mcp.reconnect_failed', {
        server: this.server.name,
        err: formatErrForLog(err),
      })
      await this.closeQuietly(fresh)

      throw err instanceof ToolError ? err : this.unavailable('reconnect failed', err)
    } finally {
      this.connecting = undefined
    }
  }

  private async adopt(fresh: Client): Promise<void> {
    const discovery = this.dial(fresh)
    // If the deadline abandons it, the late rejection must not become an unhandled rejection.
    discovery.catch(() => undefined)

    const remote = await withDeadline(discovery, MCP_DISCOVERY_TIMEOUT_MS)

    if (remote === undefined) {
      throw this.unavailable('reconnect timed out')
    }

    if (this.closed || namesOf(remote) !== this.toolNames) {
      throw this.unavailable(this.closed ? 'session closed' : 'tool set changed')
    }

    this.current = fresh
    this.down = false
    this.logger.info('mcp.reconnected', { server: this.server.name })
  }

  // Closing a dead stdio client still reaps its child; a failure here is not the call's failure.
  private async closeQuietly(client: Client): Promise<void> {
    try {
      await client.close()
    } catch {
      // The transport is already gone or going; nothing is left to release.
    }
  }

  private unavailable(reason: string, cause?: unknown): ToolError {
    return new ToolError(
      'server_unavailable',
      `MCP server "${this.server.name}" is unavailable: ${reason}`,
      cause
    )
  }
}

// HTTP errors and a closed connection are the transport failing; a JSON-RPC error or a slow tool is
// the server answering, and says nothing about the next call.
function isConnectionFailure(err: unknown): boolean {
  return (
    err instanceof StreamableHTTPError ||
    (err instanceof McpError && err.code === ErrorCode.ConnectionClosed)
  )
}

function namesOf(tools: readonly McpTool[]): string {
  return tools
    .map((tool) => tool.name)
    .sort()
    .join(TOOL_NAME_SEPARATOR)
}

async function listAll(client: Client, server: string): Promise<readonly McpTool[]> {
  const all: McpTool[] = []
  let cursor: string | undefined
  let pages = 0

  do {
    if (pages === MCP_MAX_TOOL_PAGES) {
      throw new ConfigError(`mcp server "${server}" exceeded ${MCP_MAX_TOOL_PAGES} tool pages`)
    }

    const page = await client.listTools(cursor === undefined ? undefined : { cursor })
    pages++
    all.push(...page.tools)

    if (all.length > MCP_MAX_TOOLS) {
      throw new ConfigError(`mcp server "${server}" advertised more than ${MCP_MAX_TOOLS} tools`)
    }
    cursor = page.nextCursor
  } while (cursor !== undefined)

  return all
}

// The SDK's own transports declare `sessionId: string | undefined` while its `Transport` interface
// declares `sessionId?: string`. Under exactOptionalPropertyTypes those two spellings disagree even
// though the runtime shape is identical — an SDK typing bug, not ours.
function createTransport(server: ResolvedMcpServer): Transport {
  if (server.transport === 'stdio') {
    const stdio = new StdioClientTransport({
      command: server.command,
      args: [...server.args],
      env: { ...getDefaultEnvironment(), ...server.env },
    })

    // why-safe: an SDK transport IS a Transport at runtime; only the optionality spelling differs.
    return stdio as Transport
  }

  // why-safe: an SDK transport IS a Transport at runtime; only the optionality spelling differs.
  return new StreamableHTTPClientTransport(new URL(server.url), {
    // Revalidated per request, not once at boot: a host string match misses encoded and mapped IP
    // forms, and a host can start resolving to a blocked address after the first connect. The dial
    // itself is not pinned to the validated address. Loopback and private LAN stay reachable.
    fetch: NetworkPolicy.guardedServerFetch,
  }) as Transport
}

// Resolves to undefined on timeout. The timer is always cleared, so it never pins the event loop.
export async function withDeadline<T>(work: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs)
  })

  try {
    return await Promise.race([work, deadline])
  } finally {
    clearTimeout(timer)
  }
}
