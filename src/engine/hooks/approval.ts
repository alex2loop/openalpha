import { randomUUID } from 'node:crypto'

import type { ToolErrorCode } from '@/core/errors'
import type { EventBus } from '@/core/events'
import type { RunId, SessionId } from '@/core/ids'
import type { ToolCall } from '@/core/tool'
import type {
  ApprovalAnswer,
  ApprovalDecision,
  ApprovalScope,
  ToolApproval,
} from '@/engine/types/approval'
import type { ApprovalGate, PreparedToolCall, RunView, ToolGateResult } from '@/engine/types/run'
import { RunHalted, ToolError } from '@/core/errors'
import { scrubCredentials } from '@/core/security/credentials'
import { APPROVAL_ARGS_PREVIEW_CHARS, APPROVAL_DEFAULT_DENIAL } from '@/engine/constants'
import { approvalContextFor } from '@/engine/hooks/approval-context'
import { approvalKeyFor, createApprovalManager } from '@/engine/hooks/approval-manager'
import { isDangerousCall } from '@/engine/hooks/dangerous'
import { toToolCallDisplay } from '@/engine/loop/tools/presentation'
import { APPROVAL_DECISIONS } from '@/engine/types/approval'

const SESSION_SCOPE = { kind: 'session' } as const satisfies ApprovalScope

// Scopes with no session to remember into re-ask on every dangerous call.
const ONE_TIME_DECISIONS = ['deny', 'once'] as const satisfies readonly ApprovalDecision[]

type DecisionOutcome =
  | { readonly kind: 'answer'; readonly answer: ApprovalAnswer }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'abort' }

interface ApprovalDecisionDeps {
  readonly run: RunView
  readonly approval: ToolApproval
  readonly key: string
  readonly call: PreparedToolCall
  readonly bus: EventBus
}

interface EventDecisionDeps {
  readonly run: RunView
  readonly scope: ApprovalScope
  readonly call: PreparedToolCall
  readonly argsSummary: string
  readonly bus: EventBus
}

interface BlockedInput {
  readonly approval: ToolApproval
  readonly key: string
}

interface TimeoutBlockInput extends BlockedInput {
  readonly run: RunView
}

interface DenialBlockInput extends BlockedInput {
  readonly feedback: string | undefined
}

export interface ApprovalManager {
  isApproved(sessionId: SessionId, key: string): boolean
  recordSession(sessionId: SessionId, key: string): void
  clearSession(sessionId: SessionId): void
  dedupApproval(key: string, decide: () => Promise<ToolGateResult>): Promise<ToolGateResult>
}

export { createApprovalManager }

/** The one decisions map; the gate enforces the same rule structurally. A call that declined a
 *  remembered decision overrides the scope: a surface must never show a button the gate refuses. */
export function decisionsFor(scope: ApprovalScope, oneTime?: boolean): readonly ApprovalDecision[] {
  if (oneTime === true) {
    return ONE_TIME_DECISIONS
  }

  switch (scope.kind) {
    case 'scheduler':
    case 'delegated':
      return ONE_TIME_DECISIONS
    case 'session':
    case 'mcp':
      return APPROVAL_DECISIONS
  }
}

function createSessionApproval(manager: ApprovalManager, sessionId: SessionId): ToolApproval {
  return {
    scope: SESSION_SCOPE,
    status(key): 'remembered' | 'prompt' {
      return manager.isApproved(sessionId, key) ? 'remembered' : 'prompt'
    },
    remember(key): void {
      manager.recordSession(sessionId, key)
    },
    deny(): void {
      // Session denials are not retained; only a single duplicate call is deduplicated.
    },
  }
}

// Stateless one-request scope: no `request`/`remember`, so the approval gate emits the normal
// channel-bound event and the operator's deny/once applies to exactly this dangerous call.
export function createDelegatedApproval(parentRunId: RunId): ToolApproval {
  return {
    scope: { kind: 'delegated', parentRunId },
    status(): 'prompt' {
      return 'prompt'
    },
    deny(): void {
      // One-time denials are not retained.
    },
  }
}

export function createApprovalGate(deps: {
  readonly bus: EventBus
  readonly manager: ApprovalManager
}): ApprovalGate {
  return async (run, call): Promise<ToolGateResult> => {
    if (run.env.approvalMode === 'bypass') {
      return { action: 'allow' }
    }

    if (!isDangerousCall(call.tool, call.input, () => approvalContextFor(run, call.name))) {
      return { action: 'allow' }
    }

    const approval = approvalFor(run, deps.manager)
    const key = approvalKeyFor(call)
    const status = approval.status(key)

    if (status === 'remembered') {
      return { action: 'allow' }
    }

    if (status === 'denied') {
      run.services.logger.info('approval.denied_repeat', {
        tool: call.name,
        scope: approval.scope.kind,
      })

      return blockedRepeat({ approval, key }, call.name)
    }

    if (run.env.approvalMode === 'unavailable') {
      run.services.logger.warn('approval.unavailable', {
        tool: call.name,
        callDepth: run.env.callDepth,
      })

      return unavailableResult()
    }

    const dedupKey = `${run.identity.runId}:${call.name}:${JSON.stringify(call.input ?? {})}`

    return deps.manager.dedupApproval(dedupKey, () =>
      decideApproval({ run, approval, key, call, bus: deps.bus })
    )
  }
}

// A tool can decline a remembered decision outright, and so does a call whose prompt could not
// show the whole of it: a remembered approval would cover arguments the operator never read.
function isOneTimeCall(call: PreparedToolCall): boolean {
  return call.tool.oneTimeApproval === true || call.presentation.truncated === true
}

function approvalFor(run: RunView, manager: ApprovalManager): ToolApproval {
  return run.env.approval ?? createSessionApproval(manager, run.identity.sessionId)
}

async function decideApproval(deps: ApprovalDecisionDeps): Promise<ToolGateResult> {
  const { approval, run } = deps
  // Safe to stop the cap: every wait below is self-bounded by approvalTimeoutMs. Leaving it
  // running would abort the run mid-prompt.
  run.state.deadline.pause()

  const outcome = await awaitDecision(deps).finally(() => run.state.deadline.resume())

  if (outcome.kind === 'abort') {
    throw new RunHalted('abort', 'approval aborted')
  }

  if (outcome.kind === 'timeout') {
    deps.run.services.logger.warn('approval.timeout', {
      tool: deps.call.name,
      scope: deps.approval.scope.kind,
      timeoutMs: deps.run.env.limits.approvalTimeoutMs,
    })

    return blockedTimeout({ approval, key: deps.key, run })
  }

  if (outcome.answer.decision === 'once') {
    return { action: 'allow' }
  }

  if (outcome.answer.decision === 'remember') {
    if (approval.remember !== undefined && !isOneTimeCall(deps.call)) {
      approval.remember(deps.key)
      return { action: 'allow' }
    }

    return blockedRememberUnavailable({ approval, key: deps.key })
  }

  deps.run.services.logger.info('approval.denied', {
    tool: deps.call.name,
    scope: deps.approval.scope.kind,
    ...(outcome.answer.feedback === undefined ? {} : { feedback: outcome.answer.feedback }),
  })

  return blockedDenial({
    approval,
    key: deps.key,
    feedback: outcome.answer.feedback,
  })
}

async function awaitDecision(deps: ApprovalDecisionDeps): Promise<DecisionOutcome> {
  const { approval, call, run } = deps
  const argsSummary = argsSummaryFor(call)

  if (run.state.abort.signal.aborted) {
    return { kind: 'abort' }
  }

  const request = approval.request

  if (request !== undefined) {
    return await awaitAdapterDecision(deps, argsSummary, request)
  }

  return await awaitEventDecision({ run, scope: approval.scope, call, argsSummary, bus: deps.bus })
}

// Engine-owned settlement: the run's abort is the only external signal, so a never-settling adapter
// is bounded by requestAbort plus the shared race. finally tears both down.
async function awaitAdapterDecision(
  deps: ApprovalDecisionDeps,
  argsSummary: string,
  request: NonNullable<ToolApproval['request']>
): Promise<DecisionOutcome> {
  const { call, run } = deps
  const timeoutMs = run.env.limits.approvalTimeoutMs
  const requestAbort = new AbortController()
  const race = armDecisionRace(run.state.abort.signal, timeoutMs)

  try {
    const requested = request({
      toolName: call.name,
      ...toToolCallDisplay(call.presentation),
      argsSummary,
      ...(isOneTimeCall(call) ? { oneTime: true as const } : {}),
      signal: AbortSignal.any([run.state.abort.signal, requestAbort.signal]),
      timeoutMs,
    }).then((answer): DecisionOutcome => ({ kind: 'answer', answer }))

    return await Promise.race([requested, race.outcome])
  } finally {
    requestAbort.abort()
    race.dispose()
  }
}

interface DecisionRace {
  readonly outcome: Promise<DecisionOutcome>
  readonly dispose: () => void
}

// The timeout and abort arms every decision wait shares. Both pin the event loop, so a caller that
// races its own source against `outcome` must call `dispose` in a finally.
function armDecisionRace(signal: AbortSignal, timeoutMs: number): DecisionRace {
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined

  const timedOut = new Promise<DecisionOutcome>((resolve) => {
    timer = setTimeout(() => {
      resolve(signal.aborted ? { kind: 'abort' } : { kind: 'timeout' })
    }, timeoutMs)
  })
  const aborted = new Promise<DecisionOutcome>((resolve) => {
    onAbort = (): void => resolve({ kind: 'abort' })
    signal.addEventListener('abort', onAbort, { once: true })
  })

  return {
    outcome: Promise.race([timedOut, aborted]),
    dispose: (): void => {
      if (timer !== undefined) {
        clearTimeout(timer)
      }

      if (onAbort !== undefined) {
        signal.removeEventListener('abort', onAbort)
      }
    },
  }
}

async function awaitEventDecision(deps: EventDecisionDeps): Promise<DecisionOutcome> {
  const { argsSummary, bus, call, run, scope } = deps
  // One bus carries every run's prompts, so the key must be unique across all of them.
  const requestId = randomUUID()
  const timeoutMs = run.env.limits.approvalTimeoutMs
  // One clock read: the timer below and every surface's prompt expire at the same instant.
  const expiresAt = Date.now() + timeoutMs
  const race = armDecisionRace(run.state.abort.signal, timeoutMs)
  let off: () => void = () => {
    // Placeholder until `bus.on()` returns the real unsubscribe handle.
  }

  const decided = new Promise<ApprovalAnswer>((resolve) => {
    off = bus.on('approval_resolved', (event) => {
      // Channel-bound: requestId alone is not authority across surfaces.
      if (event.requestId === requestId && event.channel === run.identity.channel) {
        resolve({
          decision: event.decision,
          ...(event.feedback === undefined ? {} : { feedback: event.feedback }),
        })
      }
    })
  })

  try {
    bus.emit('approval_requested', {
      runId: run.identity.runId,
      requestId,
      agentId: run.identity.agentId,
      toolName: call.name,
      argsSummary,
      ...toToolCallDisplay(call.presentation),
      scope,
      ...(isOneTimeCall(call) ? { oneTime: true as const } : {}),
      expiresAt,
      channel: run.identity.channel,
      chatId: run.identity.chatId ?? run.identity.sessionId,
      callDepth: run.env.callDepth,
    })

    const outcome = await Promise.race([decided, race.outcome])
    const settled: DecisionOutcome =
      'decision' in outcome ? { kind: 'answer', answer: outcome } : outcome

    // The gate owns the deadline: a timeout settles the request on the bus so surfaces retract
    // their prompts off this broadcast instead of racing a mirror timer. Our own listener below
    // resolves an already-settled race — a no-op.
    if (settled.kind === 'timeout') {
      bus.emit('approval_resolved', {
        requestId,
        decision: 'deny',
        channel: run.identity.channel,
      })
    }

    return settled
  } finally {
    off()
    race.dispose()
  }
}

function argsSummaryFor(call: ToolCall): string {
  return scrubCredentials(JSON.stringify(call.input ?? {})).slice(0, APPROVAL_ARGS_PREVIEW_CHARS)
}

function blockResult(code: ToolErrorCode, message: string): ToolGateResult {
  return { action: 'block', message, error: new ToolError(code, message) }
}

// Denying before blocking is what stops the model re-emitting the same call next turn.
function denyAndBlock(input: BlockedInput, code: ToolErrorCode, message: string): ToolGateResult {
  input.approval.deny(input.key)

  return blockResult(code, message)
}

function blockedRepeat(input: BlockedInput, toolName: string): ToolGateResult {
  return denyAndBlock(
    input,
    'approval_denied',
    `Approval for ${toolName} was already denied; do not retry it`
  )
}

function unavailableResult(): ToolGateResult {
  return blockResult('approval_unavailable', 'Approval is unavailable for this run')
}

// No answer is not a denial with feedback, but the model must still stop re-emitting the call.
function blockedTimeout(input: TimeoutBlockInput): ToolGateResult {
  return denyAndBlock(
    input,
    'approval_timeout',
    `Approval timed out after ${input.run.env.limits.approvalTimeoutMs}ms. Do not retry this action - tell the user the approval was not answered.`
  )
}

function blockedRememberUnavailable(input: BlockedInput): ToolGateResult {
  return denyAndBlock(
    input,
    'approval_unavailable',
    'Remember approval is unavailable for this scope'
  )
}

function blockedDenial(input: DenialBlockInput): ToolGateResult {
  return denyAndBlock(
    input,
    'approval_denied',
    input.feedback === undefined
      ? APPROVAL_DEFAULT_DENIAL
      : `Operator declined and requested changes: ${input.feedback}`
  )
}
