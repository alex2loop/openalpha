import type { StreamPrinter } from '@/cli/commands/chat/render'
import type { CliApp } from '@/cli/types'
import type { PromptFn } from '@/cli/ui/prompt'
import type { EventBus } from '@/core/events'
import type { AgentId, RunId } from '@/core/ids'
import type { Locale } from '@/core/types/locale'
import type { ApprovalDecision, ApprovalScope } from '@/engine/api'
import { formatToolCall } from '@/cli/commands/chat/render'
import { isVerbose } from '@/cli/env'
import { isOwnTerminal } from '@/cli/terminal'
import { style } from '@/cli/ui/colors'
import { LOCAL_CHANNEL_ID } from '@/core/channels'
import { observe } from '@/core/events'
import { formatErrForLog } from '@/core/security/credentials'
import { composeAbort, decisionsFor, TIMEOUT_ABORT } from '@/engine/api'
import {
  approvalDecisionLabel,
  approvalDetail,
  approvalOutcome,
  t,
  translateToolLabel,
} from '@/i18n'

const ONCE = new Set(['o', 'once', 'y', 'yes'])
const REMEMBER = new Set(['r', 'remember'])
const DENY = new Set(['d', 'deny', 'n', 'no', ''])
const CLI_CHANNEL_ID = LOCAL_CHANNEL_ID

const DECISION_SHORTCUTS = {
  deny: 'd',
  once: 'o',
  remember: 'r',
} satisfies Record<ApprovalDecision, string>

interface CliApprovalDeps {
  readonly app: CliApp
  readonly bus: EventBus
  readonly prompt: PromptFn
  readonly locale: Locale
  /** REPL lifetime — the subscription comes off with it. */
  readonly signal: AbortSignal
  /** The run in flight. Replaced each turn, so it is read at prompt time, not at subscribe time. */
  readonly runSignal: () => AbortSignal | undefined
  /** The turn's printer; paused while the question owns the terminal so the spinner can't clobber it. */
  readonly printer: () => StreamPrinter | undefined
}

interface ApprovalRequest {
  readonly requestId: string
  readonly runId: RunId
  readonly agentId: AgentId
  readonly toolName: string
  readonly argsSummary: string
  readonly label: string
  readonly emoji?: string
  readonly detail?: string
  readonly truncated?: true
  readonly scope: ApprovalScope
  readonly oneTime?: true
  readonly expiresAt: number
}

interface PromptForAnswerInput {
  readonly question: string
  readonly signal: AbortSignal
  readonly settled: AbortSignal
}

interface TurnLock {
  /** Resolves with the release once earlier holders let go; rejects if the signal aborts first. */
  readonly acquire: (signal: AbortSignal) => Promise<() => void>
}

export function subscribeCliApproval(deps: CliApprovalDeps): void {
  const turns = createTurnLock()

  observe(deps.bus, 'approval_requested', {
    signal: deps.signal,
    fn: (event) => {
      // One bus serves every surface and, in a daemon, every forwarded terminal. The bus emits
      // synchronously inside the run's async context, and child runs carry their own session ids,
      // so the terminal scope, not the session, names the command a run belongs to.
      if (event.channel !== 'cli' || !isOwnTerminal(deps.app.terminal)) {
        return
      }

      askOperator({ deps, turns }, event)
    },
  })
}

// One question owns the terminal at a time: a second concurrent `rl.question` never settles and
// swallows the next line typed, so approvals from parallel child runs take turns.
function askOperator(
  { deps, turns }: { readonly deps: CliApprovalDeps; readonly turns: TurnLock },
  event: ApprovalRequest
): void {
  const remainingMs = event.expiresAt - Date.now()

  if (remainingMs <= 0) {
    failClosed(deps, event.requestId)

    return
  }

  const scope = composeAbort([deps.signal, deps.runSignal()], remainingMs)
  const { signal } = scope.controller

  takeTurn({ deps, turns }, event, signal)
    .catch((err: unknown) => {
      // Aborted: the gate has stopped listening, so a resolution now would be stale.
      if (signal.aborted) {
        if (signal.reason === TIMEOUT_ABORT) {
          deps.app.err(style.warn(t(deps.locale, 'channel.approvalTimedOut')))
        }

        return
      }

      deps.app.err(style.error(`approval prompt failed: ${formatErrForLog(err).message}`))
      failClosed(deps, event.requestId)
    })
    .finally(() => scope.dispose())
}

async function takeTurn(
  { deps, turns }: { readonly deps: CliApprovalDeps; readonly turns: TurnLock },
  event: ApprovalRequest,
  signal: AbortSignal
): Promise<void> {
  const release = await turns.acquire(signal)

  try {
    await resolve(deps, event, signal)
  } finally {
    release()
  }
}

// First come, first served; each waiter leaves on its own deadline or abort, bounding the line.
function createTurnLock(): TurnLock {
  const waiters: Array<() => void> = []
  let held = false

  const release = (): void => {
    const next = waiters.shift()

    if (next === undefined) {
      held = false

      return
    }

    next()
  }

  return {
    acquire(signal): Promise<() => void> {
      if (signal.aborted) {
        return Promise.reject(signal.reason)
      }

      if (!held) {
        held = true

        return Promise.resolve(release)
      }

      return new Promise((granted, refused) => {
        const grant = (): void => {
          signal.removeEventListener('abort', leave)
          granted(release)
        }
        const leave = (): void => {
          waiters.splice(waiters.indexOf(grant), 1)
          refused(signal.reason)
        }

        waiters.push(grant)
        signal.addEventListener('abort', leave, { once: true })
      })
    },
  }
}

// The gate waits for exactly one resolution; a question we could not ask still owes it one.
function failClosed(deps: CliApprovalDeps, requestId: string): void {
  deps.bus.emit('approval_resolved', {
    requestId,
    decision: 'deny',
    channel: CLI_CHANNEL_ID,
  })
}

async function resolve(
  deps: CliApprovalDeps,
  event: ApprovalRequest,
  signal: AbortSignal
): Promise<void> {
  const { app, locale } = deps
  const allowed = decisionsFor(event.scope, event.oneTime)
  const delegated = event.scope.kind === 'delegated' ? event.scope : undefined
  const printer = deps.printer()

  // The spinner ticks over the same line readline renders the question on; it stays parked
  // until the answer is in.
  printer?.pause()

  // The gate owns the deadline: if it settles the request itself (timeout), the prompt retracts
  // off its broadcast instead of racing a mirror timer.
  const settlement = watchSettlement(deps.bus, event.requestId)

  try {
    const toolLine = formatToolCall({
      label: translateToolLabel(locale, event.toolName, event.label),
      emoji: event.emoji,
      detail: approvalDetail(locale, event.detail, event.truncated),
    })

    app.out('')
    app.out(`${style.warn(t(locale, 'channel.approvalRequired'))}: ${toolLine}`)

    if (delegated !== undefined) {
      app.out(t(locale, 'channel.approvalAgent', { agentId: event.agentId }))
      app.out(t(locale, 'channel.approvalChildRun', { runId: event.runId }))
      app.out(t(locale, 'channel.approvalDelegated', { parentRunId: delegated.parentRunId }))
    }

    if (isVerbose()) {
      app.out(t(locale, 'channel.approvalArgs', { argsSummary: event.argsSummary }))
    }

    const hints = allowed.map((offered) => decisionHint(locale, offered)).join(' / ')
    const question = `${t(locale, 'channel.approvalPrompt', { hints })} ${style.accent('›')}`
    const answer = await promptForAnswer(deps, { question, signal, settled: settlement.signal })

    if (answer === undefined) {
      return
    }

    const decision = decisionFor(answer, allowed)
    const feedback = feedbackFor(answer, decision)

    deps.bus.emit('approval_resolved', {
      requestId: event.requestId,
      decision,
      channel: CLI_CHANNEL_ID,
      ...(feedback === undefined ? {} : { feedback }),
    })

    const outcome = approvalOutcome(locale, decision)

    if (decision === 'deny') {
      app.out(style.error(outcome))
    } else if (decision === 'remember') {
      app.out(style.warn(outcome))
    } else {
      app.out(style.success(outcome))
    }
  } finally {
    settlement.dispose()
    printer?.resume()
  }
}

// The gate settles every request it broadcasts; a matching resolution is the prompt's cue to retract.
function watchSettlement(
  bus: EventBus,
  requestId: string
): { readonly signal: AbortSignal; readonly dispose: () => void } {
  const controller = new AbortController()
  const off = bus.on('approval_resolved', (resolved) => {
    if (resolved.requestId === requestId) {
      controller.abort()
    }
  })

  return { signal: controller.signal, dispose: off }
}

// Undefined when the prompt ended without an answer: aborted locally, or the gate settled first.
async function promptForAnswer(
  deps: CliApprovalDeps,
  input: PromptForAnswerInput
): Promise<string | undefined> {
  const promptSignal = AbortSignal.any([input.signal, input.settled])

  try {
    const answer = (await deps.prompt(input.question, { signal: promptSignal })).trim()

    return input.signal.aborted || input.settled.aborted ? undefined : answer
  } catch (err: unknown) {
    // The gate timed the request out: the retraction note belongs where the question stood.
    if (input.settled.aborted && !input.signal.aborted) {
      deps.app.err(style.warn(t(deps.locale, 'channel.approvalTimedOut')))

      return undefined
    }

    throw err
  }
}

function decisionHint(locale: Locale, decision: ApprovalDecision): string {
  return `[${DECISION_SHORTCUTS[decision]}] ${approvalDecisionLabel(locale, decision)}`
}

// Anything unrecognised is a denial — never an approval — and a decision this scope does not
// offer (Remember, for a scheduled job) is unrecognised.
function decisionFor(answer: string, allowed: readonly ApprovalDecision[]): ApprovalDecision {
  const normalized = answer.toLowerCase()

  if (ONCE.has(normalized)) {
    return 'once'
  }

  if (REMEMBER.has(normalized) && allowed.includes('remember')) {
    return 'remember'
  }

  return 'deny'
}

// Only free text is feedback: a bare `d`, or an `r` the scope never offered, is just a denial.
function feedbackFor(answer: string, decision: ApprovalDecision): string | undefined {
  const normalized = answer.toLowerCase()

  if (decision !== 'deny' || DENY.has(normalized) || ONCE.has(normalized)) {
    return undefined
  }

  return REMEMBER.has(normalized) ? undefined : answer
}
