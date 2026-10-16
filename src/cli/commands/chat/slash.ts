import type { ChatSession } from '@/cli/commands/chat/types'
import type { CliApp } from '@/cli/types'
import type { ResolvedSlashCommand, SlashDispatcher } from '@/commands/api'
import type { AgentId, SessionId } from '@/core/ids'
import type { ProgressReporter, SlashContext, SlashResult } from '@/core/types/command'
import { watchProviderFallbacks } from '@/cli/commands/chat/fallback-notice'
import { printRunFooter } from '@/cli/commands/chat/render'
import { CLI_CHAT_ID } from '@/cli/commands/chat/types'
import { createSpinner, type Spinner } from '@/cli/ui/spinner'
import { renderMessages } from '@/commands/api'
import { LOCAL_CHANNEL_ID } from '@/core/channels'
import { LOCAL_USER_ID } from '@/core/ids'
import { formatErrForLog } from '@/core/security/credentials'
import { hasRunFooter } from '@/core/utils/footer'
import { bindLocale, t } from '@/i18n'
import { toPlainText } from '@/trading/api'

const CLI_CHANNEL_ID = LOCAL_CHANNEL_ID

// A slash command either resolves to a normal agent turn or handles itself outright.
export interface SlashTurn {
  readonly message: string
  readonly agentId?: AgentId
}

// Returns the turn to run, or null when the command handled it outright.
export async function runSlash(session: ChatSession, line: string): Promise<SlashTurn | null> {
  const { app, state } = session
  const dispatcher: SlashDispatcher = app.resolve('slashDispatcher')
  const resolved = dispatcher.resolve(line)
  const controller = new AbortController()
  const spinner = startSlashProgress(session, resolved)
  const fallbacks = watchProviderFallbacks(app)
  const ctx: SlashContext = {
    channel: CLI_CHANNEL_ID,
    requestId: crypto.randomUUID(),
    surface: 'repl',
    userId: LOCAL_USER_ID,
    sessionId: state.sessionId,
    chatId: CLI_CHAT_ID,
    role: 'operator',
    locale: app.config.locale.language,
    signal: controller.signal,
    args: [],
    ...(spinner === undefined
      ? {}
      : { progress: createSlashProgressReporter(session, spinner, controller.signal) }),
  }

  state.controller = controller

  try {
    await openChatSession(session)

    const startedAt = performance.now()
    const result = await dispatcher.dispatch(line, ctx)
    const elapsedMs = Math.round(performance.now() - startedAt)

    // The transient line is cleared before anything prints, so a reply never lands on the spinner.
    spinner?.stop()

    state.sessionId = await routedSessionId(app, state.sessionId)
    const turn = toSlashTurn(session, line, result)

    fallbacks.report()

    // A self-handled command never reaches `executeTurn`, so it owes its own footer.
    if (turn === null && hasRunFooter(resolved?.policy, result)) {
      await printSlashFooter(app, ctx.sessionId, elapsedMs)
    }

    return turn
  } finally {
    fallbacks.dispose()
    spinner?.stop()
    if (state.controller === controller) {
      state.controller = null
    }
  }
}

function openChatSession(session: ChatSession): Promise<void> {
  const { app, state } = session

  return app.resolve('sessionStore').create({
    id: state.sessionId,
    agentId: state.agentId,
    userId: LOCAL_USER_ID,
    channel: CLI_CHANNEL_ID,
    chatId: CLI_CHAT_ID,
  })
}

// Only a long-running command gets a spinner, and it wears the label that command declared.
function startSlashProgress(
  session: ChatSession,
  resolved: ResolvedSlashCommand | null
): Spinner | undefined {
  const execution = resolved?.policy.execution

  if (execution === undefined) {
    return undefined
  }

  const spinner = createSpinner(session.app.write)
  spinner.start(bindLocale(session.app.config.locale.language).translate(execution.progressKey))

  return spinner
}

function createSlashProgressReporter(
  session: ChatSession,
  spinner: Spinner,
  signal: AbortSignal
): ProgressReporter {
  const locale = bindLocale(session.app.config.locale.language)

  // A cancelled command stops its spinner while the work it started is still unwinding. Relabelling
  // it then would re-arm a reveal timer nothing owns and leave it painting over the prompt.
  return (key, params) => {
    if (!signal.aborted) {
      spinner.start(locale.translate(key, params))
    }
  }
}

/** The answer is already on screen, so an unreadable ledger costs the footer and nothing else. */
async function printSlashFooter(app: CliApp, id: SessionId, elapsedMs: number): Promise<void> {
  try {
    const totals = await app.resolve('spendReader').forSession(id)

    // No metric: a slash command runs no chat turn, so there is no context share to report. The
    // model rides the totals, which name it whenever one model served every billed call.
    printRunFooter(app, totals, { metric: undefined, elapsedMs })
  } catch (err: unknown) {
    app.resolve('logger').warn('cli.slash_footer_unavailable', { err: formatErrForLog(err) })
  }
}

async function routedSessionId(app: CliApp, current: SessionId): Promise<SessionId> {
  const routed = await app
    .resolve('sessionRouter')
    .get({ channel: CLI_CHANNEL_ID, chatId: CLI_CHAT_ID, userId: LOCAL_USER_ID })

  return routed ?? current
}

/** The terminal has no keyboard and its reader can type, so every affordance prints as a line
 *  naming the command behind it. */
function withAffordances(app: CliApp, result: Extract<SlashResult, { kind: 'text' }>): string {
  const affordances = result.affordances ?? []

  if (affordances.length === 0) {
    return result.text
  }

  const locale = app.config.locale.language
  const lines = affordances.map((affordance) =>
    t(locale, 'channel.affordanceLine', {
      label:
        affordance.icon === undefined ? affordance.label : `${affordance.icon} ${affordance.label}`,
      command: affordance.command,
    })
  )

  return [result.text, '', ...lines].join('\n')
}

function toSlashTurn(
  session: ChatSession,
  line: string,
  result: SlashResult | null
): SlashTurn | null {
  const { app } = session

  if (result === null) {
    return { message: line }
  }

  switch (result.kind) {
    case 'message':
      app.out(renderMessages(bindLocale(app.config.locale.language), result))
      return null
    case 'text':
      app.out(toPlainText(withAffordances(app, result)))
      return null
    case 'agent':
      return {
        message: result.retryMessage,
        ...(result.agentId === undefined ? {} : { agentId: result.agentId }),
      }
    case 'handled':
      return null
    default: {
      const _exhaustive: never = result
      return _exhaustive
    }
  }
}
