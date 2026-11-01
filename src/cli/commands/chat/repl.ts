import type { SlashTurn } from '@/cli/commands/chat/slash'
import type { ChatFlags, ChatSession } from '@/cli/commands/chat/types'
import type { CliApp, CompletionSource, Writer } from '@/cli/types'
import type { PromptFn } from '@/cli/ui/prompt'
import type { HelpRequest } from '@/commands/api'
import type { SessionId } from '@/core/ids'
import { subscribeCliApproval } from '@/cli/commands/chat/approval'
import { runSlash } from '@/cli/commands/chat/slash'
import { executeTurn } from '@/cli/commands/chat/turn'
import { CLI_CHAT_ID } from '@/cli/commands/chat/types'
import { isInteractiveStdin } from '@/cli/env'
import { exitCodeForResult, terminalErrorMessage } from '@/cli/error-output'
import { hint, style } from '@/cli/ui/colors'
import { multiPrompt } from '@/cli/ui/prompt'
import { takeUpdateNotice } from '@/cli/update/notice'
import { HELP_COMMAND, parseHelpLine, renderCommandHelp } from '@/commands/api'
import { BRAND } from '@/core/brand'
import { formatErrForLog } from '@/core/security/credentials'
import { bindLocale, t } from '@/i18n'

const PROMPT = '›'
const EXIT_COMMANDS: ReadonlySet<string> = new Set(['/exit', '/quit'])
const LOCAL_COMMANDS: ReadonlySet<string> = new Set([...EXIT_COMMANDS, HELP_COMMAND])

type LineOutcome = 'continue' | 'exit'

interface CliApprovals {
  readonly app: CliApp
  readonly prompt: PromptFn
  close(): void
}

interface PromptOutput {
  line(write: () => void): void
  raw(chunk: string, write: () => void): void
}

// One readline interface serves both the input loop and the approval prompt; two would fight over stdin.
function openCliApprovals(session: ChatSession): CliApprovals {
  const { app } = session
  const { terminal } = app
  const scope = new AbortController()
  const { prompt, close, lineOutput, rawOutput } = multiPrompt({
    completion: visibleCompletion(session),
    onSigint: () => terminal.interrupt(),
    onUnasked: (line) => noteUnsent(session, line),
  })
  const promptApp = promptAwareApp(app, { line: lineOutput, raw: rawOutput })

  subscribeCliApproval({
    app: promptApp,
    bus: app.resolve('bus'),
    prompt,
    locale: app.config.locale.language,
    signal: scope.signal,
    runSignal: () => session.state.controller?.signal,
    printer: () => session.state.printer ?? undefined,
  })

  return {
    app: promptApp,
    prompt,
    close(): void {
      scope.abort()
      close()
    },
  }
}

/** Never queued for later: the next open question may be an approval, and a line typed ahead must
 *  not answer it. Saying it was dropped beats a silent loss. */
function noteUnsent(session: ChatSession, line: string): void {
  if (line.trim() === '') {
    return
  }

  const printer = session.state.printer ?? undefined

  printer?.pause()
  session.app.err(hint(t(session.app.config.locale.language, 'cli.chatLineNotSent')))
  printer?.resume()
}

function promptAwareApp(app: CliApp, output: PromptOutput): CliApp {
  return {
    keyFile: app.keyFile,
    config: app.config,
    configPath: app.configPath,
    signal: app.signal,
    resolve: (key) => app.resolve(key),
    has: (key) => app.has(key),
    out: wrapLineWriter(app.out, output),
    err: wrapLineWriter(app.err, output),
    write: wrapRawWriter(app.write, output),
    terminal: app.terminal,
    ...(app.abortDaemon === undefined ? {} : { abortDaemon: app.abortDaemon }),
    ...(app.configProbe === undefined ? {} : { configProbe: app.configProbe }),
  }
}

function wrapLineWriter(writer: Writer, output: PromptOutput): Writer {
  return (line) => output.line(() => writer(line))
}

function wrapRawWriter(writer: Writer, output: PromptOutput): Writer {
  return (chunk) => output.raw(chunk, () => writer(chunk))
}

function visibleCompletion(session: ChatSession): CompletionSource {
  const visibleCommands = new Set<string>(
    session.app
      .resolve('slashDispatcher')
      .all('repl', 'operator')
      .map((command) => `/${command.name}`)
  )

  for (const command of LOCAL_COMMANDS) {
    visibleCommands.add(command)
  }

  return {
    complete(line): readonly string[] {
      const trimmed = line.trimStart()

      if (!trimmed.startsWith('/') || trimmed.includes(' ')) {
        return session.completion.complete(line)
      }

      const visible = session.completion
        .complete(line)
        .filter((candidate) => visibleCommands.has(candidate))
      const local = [...LOCAL_COMMANDS].filter((command) => command.startsWith(trimmed))

      return [...new Set([...visible, ...local])]
    },
  }
}

export async function repl(session: ChatSession): Promise<number> {
  const { display, state } = session
  const approvals = openCliApprovals(session)
  const promptedSession = { ...session, app: approvals.app }
  const { app } = promptedSession

  // Mid-run Ctrl-C cancels the turn and keeps the session; at the prompt there is nothing to cancel, so closing.
  const onSigint = (): void => {
    if (state.controller && !state.controller.signal.aborted) {
      state.controller.abort()

      return
    }

    approvals.close()
  }

  const onSigterm = (): void => {
    state.controller?.abort()
    approvals.close()
  }

  const offInterrupt = app.terminal.onInterrupt(onSigint)
  const offTerminate = app.terminal.onTerminate(onSigterm)
  const shortSession = state.sessionId.slice(0, 8)

  const locale = app.config.locale.language

  app.out(style.title(t(locale, 'cli.chatTitle', { brand: BRAND.display })))
  app.out(
    style.muted(
      t(locale, 'cli.chatBanner', {
        agent: display.agentName,
        model: display.model,
        session: shortSession,
      })
    )
  )
  app.out(hint(t(locale, 'ui.replHelp')))

  for (const line of await takeUpdateNotice(app.config)) {
    app.out(line)
  }

  try {
    return await loop(promptedSession, approvals.prompt)
  } finally {
    offInterrupt()
    offTerminate()
    approvals.close()
    await closeIdleSession(app, state.sessionId)
  }
}

async function loop(session: ChatSession, prompt: PromptFn): Promise<number> {
  for (;;) {
    let line: string

    try {
      line = (await prompt(PROMPT, { suggestions: true, bare: true })).trim()
    } catch {
      // Interface closed: Ctrl-C at the prompt, Ctrl-D, or piped stdin at EOF.
      return 0
    }

    if (line === '') {
      continue
    }

    if ((await handleLine(session, line, prompt)) === 'exit') {
      return 0
    }
  }
}

async function handleLine(
  session: ChatSession,
  line: string,
  prompt: PromptFn
): Promise<LineOutcome> {
  if (EXIT_COMMANDS.has(line)) {
    return 'exit'
  }

  const help = parseHelpLine(line)

  if (help !== null) {
    printHelp(session, help)
    return 'continue'
  }

  const turn = line.startsWith('/') ? await runSlashCaught(session, line) : { message: line }

  if (turn === null) {
    return 'continue'
  }

  await runTurn(session, turn, prompt)

  return 'continue'
}

/** A failed command ends the command, not the session — the boundary `runTurn` already owns for a
 *  failed turn. Without it a store or provider error unwinds the whole REPL. */
async function runSlashCaught(session: ChatSession, line: string): Promise<SlashTurn | null> {
  const { app } = session

  try {
    return await runSlash(session, line)
  } catch (err: unknown) {
    app.err(style.error(terminalErrorMessage(err, app.config.locale.language)))

    return null
  }
}

/** The REPL's own verbs never reach the dispatcher, so `/help` would otherwise list every command
 *  except the three the reader is currently using. */
function printHelp(session: ChatSession, request: HelpRequest): void {
  const { app } = session
  const language = app.config.locale.language

  app.out(
    renderCommandHelp(bindLocale(language), {
      controls: [
        { verb: HELP_COMMAND, description: t(language, 'slash.helpHelp') },
        { verb: '/exit', description: t(language, 'slash.helpExit') },
        { verb: '/quit', description: t(language, 'slash.helpExit') },
      ],
      commands: app.resolve('slashDispatcher').all('repl', 'operator'),
      ...request,
    })
  )
}

async function runTurn(session: ChatSession, turn: SlashTurn, prompt: PromptFn): Promise<void> {
  const { app, flags, state } = session
  state.controller = new AbortController()

  try {
    await executeTurn({
      app,
      agentId: turn.agentId ?? state.agentId,
      sessionId: state.sessionId,
      message: turn.message,
      flags,
      signal: state.controller.signal,
      // The REPL loop is enclosed by `openCliApprovals`, so its responder is always armed.
      chatId: CLI_CHAT_ID,
      prompt,
      onPrinter: (printer) => {
        state.printer = printer ?? null
      },
    })
  } catch (err: unknown) {
    // A failed turn ends the turn, not the session.
    app.err(style.error(terminalErrorMessage(err, app.config.locale.language)))
  } finally {
    state.controller = null
  }
}

// One turn; the run's outcome becomes the process exit code.
export async function singleShot(session: ChatSession, message: string): Promise<number> {
  const { app, state } = session

  // The dispatcher does not own `/help` — the REPL answers it directly — so without this the one
  // mode where it is unreachable is the one whose unknown-command reply says to try it.
  const help = parseHelpLine(message)

  if (help !== null) {
    printHelp(session, help)

    return 0
  }

  const approvals = isInteractiveStdin() ? openCliApprovals(session) : undefined
  const activeSession = approvals === undefined ? session : { ...session, app: approvals.app }
  const controller = new AbortController()

  const onSignal = (): void => {
    controller.abort()

    if (state.controller !== controller) {
      state.controller?.abort()
    }
  }
  const offInterrupt = app.terminal.onInterrupt(onSignal)
  const offTerminate = app.terminal.onTerminate(onSignal)

  try {
    const turn = message.startsWith('/') ? await runSlash(activeSession, message) : { message }

    if (turn === null) {
      await closeIdleSession(app, state.sessionId)

      return 0
    }

    state.controller = controller

    const result = await executeTurn({
      app: approvals?.app ?? app,
      agentId: turn.agentId ?? state.agentId,
      sessionId: state.sessionId,
      message: turn.message,
      flags: approvals === undefined ? withoutApprover(session.flags) : session.flags,
      signal: controller.signal,
      // The route is live only while the interactive approval responder is armed; a headless
      // one-shot omits it so its dangerous delegated children fail approval-unavailable.
      ...(approvals === undefined ? {} : { chatId: CLI_CHAT_ID, prompt: approvals.prompt }),
      onPrinter: (printer) => {
        state.printer = printer ?? null
      },
    })

    return exitCodeForResult(result)
  } finally {
    offInterrupt()
    offTerminate()
    approvals?.close()

    if (state.controller === controller) {
      state.controller = null
    }
  }
}

// A command that answered itself ran no turn to finalize the session; left active once the chat ends,
// the next daemon start files it as interrupted. The store leaves a session a run still holds alone.
async function closeIdleSession(app: CliApp, id: SessionId): Promise<void> {
  try {
    await app.resolve('sessionStore').updateStatus(id, 'done')
  } catch (err: unknown) {
    app.resolve('logger').warn('cli.command_session_close_failed', { err: formatErrForLog(err) })
  }
}

// `bypass` is the operator saying "do not ask"; anything else with nobody to ask must block.
function withoutApprover(flags: ChatFlags): ChatFlags {
  return flags.mode === 'bypass' ? flags : { ...flags, mode: 'unavailable' }
}
