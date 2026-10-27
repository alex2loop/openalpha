import type { ExecTerminal } from '@/app/server/exec/terminal'
import type { CliApp } from '@/cli/api'
import type { App } from '@/core/container'
import { reloadUserAgents } from '@/app/agent-registry'
import {
  resolveCliCommands,
  resolveCommandPath,
  runCli,
  toTerminalWriters,
  withTerminal,
} from '@/cli/api'
import { formatErrForLog } from '@/core/security/credentials'

// The daemon reads user agents at start and on a reload, and `agent add` checks that registry, so a
// write made here reloads it as an in-process write would find the folder.
const AGENT_WRITE_COMMANDS: ReadonlySet<string> = new Set([
  'agent add',
  'agent edit',
  'agent remove',
])

/**
 * Runs one forwarded command against the connection's terminal and sends its exit code. Logs the
 * command path, its exit code and duration, never argv values, prompt answers, edits or output.
 */
export async function runExec(
  app: App,
  terminal: ExecTerminal,
  argv: readonly string[]
): Promise<number> {
  const startedAt = performance.now()
  const logger = app.resolve('logger')
  const execApp = toExecApp(app, terminal)
  const commands = resolveCliCommands(execApp, app.resolve('extraCliCommands'))
  const command = (await resolveCommandPath(argv, commands)).join(' ')
  let exitCode: number | undefined

  logger.info('api.exec_started', { command })

  try {
    // The whole command runs inside its terminal, so colour, width and prompts read the connection.
    const code = await withTerminal(terminal, () => runCli(execApp, argv, commands))

    if (code === 0 && AGENT_WRITE_COMMANDS.has(command)) {
      await reloadAgents(app)
    }

    if (terminal.exit(code)) {
      exitCode = code
    }

    return code
  } finally {
    logger.info('api.exec_finished', {
      command,
      durationMs: Math.round(performance.now() - startedAt),
      ...(exitCode === undefined ? {} : { exitCode }),
    })
  }
}

/** The daemon's app, seen through the connection: its signal also ends when the terminal goes. No
 *  `configProbe` (the daemon is booted) and no `abortDaemon` (a command never stops the daemon). */
function toExecApp(app: App, terminal: ExecTerminal): CliApp {
  return {
    config: app.config,
    configPath: app.configPath,
    resolve: app.resolve,
    has: app.has,
    signal: AbortSignal.any([app.signal, terminal.aborted]),
    keyFile: app.resolve('keyFile'),
    terminal,
    ...toTerminalWriters(terminal),
  }
}

/** A failed reload leaves the registry as it was; the command itself succeeded. */
async function reloadAgents(app: App): Promise<void> {
  try {
    await reloadUserAgents(app)
  } catch (err: unknown) {
    app.resolve('logger').warn('api.exec_agent_reload_failed', { err: formatErrForLog(err) })
  }
}
