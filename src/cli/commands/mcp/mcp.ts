import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from '@modelcontextprotocol/sdk/types.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import type { Command, Group } from '@/cli/command'
import type { ParsedArgs } from '@/cli/parsing/args'
import type { CliApp } from '@/cli/types'
import type { ProgressMessage } from '@/core/stream-events'
import type { ToolDefinition } from '@/core/tool'
import type { Locale } from '@/core/types/locale'
import type { McpJobReply, McpJobs, McpSurface, ToolApproval } from '@/engine/api'
import { createCommand, createGroup } from '@/cli/command'
import { createMcpApproval, hasFormElicitation } from '@/cli/commands/mcp/approval'
import { mcpInstallCommand } from '@/cli/commands/mcp/install'
import { toCallToolResult } from '@/cli/commands/mcp/reply'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'
import { resolveMcpJobs, resolveMcpSurface } from '@/cli/services'
import { hint, style, warn } from '@/cli/ui/colors'
import { BRAND } from '@/core/brand'
import {
  canRequireApproval,
  MODEL_ANSWER_INPUT,
  MODEL_ANSWER_TOOL,
  MODEL_REQUEST_VIEW_INPUT,
  MODEL_REQUEST_VIEW_TOOL,
  MODEL_RESUME_INPUT,
  MODEL_RESUME_TOOL,
  MODEL_TOOLS,
  toAdvertisedTools,
} from '@/engine/api'
import { t, translateDisplayText } from '@/i18n'

/** Between real progress events, so a client whose request timeout resets on progress survives a
 *  debate role that is legitimately silent for minutes. Below the SDK's 60s default with margin. */
const MCP_PROGRESS_HEARTBEAT_MS = 25_000
/** Keeps a large result inline in Claude Code, which otherwise files anything over 25,000 tokens
 *  for the model to read back. */
const MCP_MAX_RESULT_CHARS = 200_000
const RESULT_SIZE_META = Object.freeze({ 'anthropic/maxResultSizeChars': MCP_MAX_RESULT_CHARS })
const PASSTHROUGH_INPUT = z.looseObject({}).optional()
const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const
/** A client shuts a stdio server down by closing its input first, and may exit without signalling;
 *  missing it left the server running, orphaned, with its event loop spinning on a dead pipe. */
const STDIN_CLOSE_EVENTS = ['end', 'close'] as const

/** One rendered row of `mcp surface`: what it is called, what it does, and any standing caveat. */
interface SurfaceEntry {
  readonly name: string
  readonly description: string
  readonly tag?: string
}

const mcpServeCommand: Command = createCommand({
  name: 'serve',
  summary: { key: 'cliHelp.mcpServeSummary' },
  needs: { modelSource: 'client' },
  run: serveMcp,
})

const mcpSurfaceCommand: Command = createCommand({
  name: 'surface',
  summary: { key: 'cliHelp.mcpSurfaceSummary' },
  needs: { modelSource: 'client' },
  run: showMcpSurface,
})

export const mcpCommand: Group = createGroup({
  ...CLI_COMMAND_METADATA.mcp,
  subcommands: [mcpServeCommand, mcpSurfaceCommand, mcpInstallCommand],
})

async function serveMcp(_args: ParsedArgs, app: CliApp): Promise<number> {
  const locale = app.config.locale.language
  const surface = resolveMcpSurface(app)
  const jobs = resolveMcpJobs(app)
  const server = new McpServer(
    { name: BRAND.name, version: BRAND.version },
    { instructions: await surface.instructions() }
  )
  const approval = createMcpApproval(server, locale)

  registerSurfaceTools({ server, surface, jobs, approval, locale })
  registerModelTools({ server, jobs, locale })
  registerToolList(server, surface)

  const transport = new StdioServerTransport()
  const closed = waitForTransportClose(transport)
  const stop = async (): Promise<void> => {
    await closeTransport(transport)
  }

  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, stop)
  }

  for (const event of STDIN_CLOSE_EVENTS) {
    process.stdin.once(event, stop)
  }

  try {
    await server.connect(transport)
    await closed
  } finally {
    await jobs.drain()
    await closeTransport(transport)

    for (const signal of SHUTDOWN_SIGNALS) {
      process.removeListener(signal, stop)
    }

    for (const event of STDIN_CLOSE_EVENTS) {
      process.stdin.removeListener(event, stop)
    }
  }

  return 0
}

function waitForTransportClose(transport: StdioServerTransport): Promise<void> {
  return new Promise((resolve) => {
    transport.onclose = resolve
  })
}

/** Closing an already-closed stdio transport is harmless. */
function closeTransport(transport: StdioServerTransport): Promise<void> {
  return transport.close().catch(() => undefined)
}

interface ProgressNotifier {
  readonly report: (message: ProgressMessage) => void
  readonly dispose: () => void
}

type ToolHandlerExtra = RequestHandlerExtra<ServerRequest, ServerNotification>

/** Real progress carries the localized stage line; the heartbeat between them carries only the
 *  counter. Both are advisory, and the caller owns dispose so no interval outlives its call. */
function createProgressNotifier(
  extra: ToolHandlerExtra,
  progressToken: string | number,
  locale: Locale
): ProgressNotifier {
  let steps = 0
  const send = (message?: string): void => {
    steps += 1
    extra
      .sendNotification({
        method: 'notifications/progress',
        params: { progressToken, progress: steps, ...(message === undefined ? {} : { message }) },
      })
      .catch(() => {
        // Progress is advisory; a transport hiccup must not fail the tool call.
      })
  }
  const heartbeat = setInterval(send, MCP_PROGRESS_HEARTBEAT_MS)

  return {
    report: (message: ProgressMessage): void => {
      heartbeat.refresh()
      send(translateDisplayText(locale, message))
    },
    dispose: (): void => clearInterval(heartbeat),
  }
}

interface RegisterSurfaceToolsInput {
  readonly server: McpServer
  readonly surface: McpSurface
  readonly jobs: McpJobs
  readonly approval: ToolApproval
  readonly locale: Locale
}

function registerSurfaceTools(input: RegisterSurfaceToolsInput): void {
  const { server, surface, jobs, approval, locale } = input

  for (const tool of surface.tools()) {
    server.registerTool(
      tool.name,
      // `registerToolList` advertises the real schema and the executor is its one parser: parsed
      // here as well, a transforming schema reached the executor already transformed and failed.
      { description: tool.description, inputSchema: PASSTHROUGH_INPUT },
      (args, extra) =>
        withCallProgress(extra, locale, (progress) =>
          jobs.start({
            name: tool.name,
            input: args,
            signal: extra.signal,
            // Client capabilities are only known after initialize, so this cannot move to startup.
            ...(hasFormElicitation(server) ? { approval } : {}),
            ...(progress === undefined ? {} : { progress }),
          })
        )
    )
  }
}

interface RegisterModelToolsInput {
  readonly server: McpServer
  readonly jobs: McpJobs
  readonly locale: Locale
}

function registerModelTools(input: RegisterModelToolsInput): void {
  const { server, jobs, locale } = input

  server.registerTool(
    MODEL_REQUEST_VIEW_TOOL.name,
    { description: MODEL_REQUEST_VIEW_TOOL.description, inputSchema: MODEL_REQUEST_VIEW_INPUT },
    (args) => toCallToolResult(jobs.view(args), locale)
  )
  server.registerTool(
    MODEL_ANSWER_TOOL.name,
    { description: MODEL_ANSWER_TOOL.description, inputSchema: MODEL_ANSWER_INPUT },
    (args, extra) =>
      withCallProgress(extra, locale, (progress) =>
        jobs.answer({
          continuation: args.continuation,
          answers: args.answers,
          model: args.model,
          inline: args.inline === true,
          signal: extra.signal,
          ...(progress === undefined ? {} : { progress }),
        })
      )
  )
  server.registerTool(
    MODEL_RESUME_TOOL.name,
    { description: MODEL_RESUME_TOOL.description, inputSchema: MODEL_RESUME_INPUT },
    (args, extra) =>
      withCallProgress(extra, locale, (progress) =>
        jobs.resume({
          continuation: args.continuation,
          inline: args.inline === true,
          signal: extra.signal,
          ...(progress === undefined ? {} : { progress }),
        })
      )
  )
}

/** Only when the client asked: a token-less client would receive notifications it never
 *  subscribed to, and some reject them. The caller's notifier never outlives its call. */
async function withCallProgress(
  extra: ToolHandlerExtra,
  locale: Locale,
  run: (progress?: (message: ProgressMessage) => void) => Promise<McpJobReply>
): Promise<CallToolResult> {
  const progressToken = extra._meta?.progressToken
  const notifier =
    progressToken === undefined ? undefined : createProgressNotifier(extra, progressToken, locale)

  try {
    return toCallToolResult(await run(notifier?.report), locale)
  } finally {
    notifier?.dispose()
  }
}

function registerToolList(server: McpServer, surface: McpSurface): void {
  const tools = [...toAdvertisedTools(surface.tools()), ...MODEL_TOOLS].map((tool) => ({
    ...tool,
    _meta: RESULT_SIZE_META,
  }))

  server.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }))
}

function showMcpSurface(_args: ParsedArgs, app: CliApp): number {
  const locale = app.config.locale.language
  const surface = resolveMcpSurface(app)

  app.out(warn(t(locale, 'cli.mcpSurfaceNote')))
  app.out('')
  printSection(app, t(locale, 'cli.mcpToolsHeading'), [
    ...surface.tools().map((tool) => toolEntry(tool, locale)),
    ...MODEL_TOOLS.map(({ name, description }) => ({ name, description })),
  ])

  return 0
}

function printSection(app: CliApp, title: string, entries: readonly SurfaceEntry[]): void {
  app.out(style.heading(title))

  if (entries.length === 0) {
    app.out(hint(t(app.config.locale.language, 'cli.mcpNonePlaceholder')))
  }

  for (const entry of entries) {
    app.out(`  ${entry.name}${entry.tag === undefined ? '' : ` ${entry.tag}`}`)
    app.out(`    ${hint(entry.description)}`)
  }

  app.out('')
}

function toolEntry(tool: ToolDefinition, locale: Locale): SurfaceEntry {
  return {
    name: tool.name,
    description: tool.description,
    ...(canRequireApproval(tool) ? { tag: warn(t(locale, 'cli.mcpToolGated')) } : {}),
  }
}
