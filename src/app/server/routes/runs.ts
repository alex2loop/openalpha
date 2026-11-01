import type { RunCallsWire, RunCallWire, RunStopWire } from '@/app/server/wire/live'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import type { RunAttempt } from '@/core/types/usage'
import { apiError, json } from '@/app/server/http/dispatch'
import { localeOf, parsePathId } from '@/app/server/routes/params'
import { runId } from '@/core/ids'
import { t } from '@/i18n'

/** Stops a run started from any channel: it only aborts, and an abort answers nobody's question.
 *  An agent run lives in the run registry, a long-running command in the dispatcher; the run ends
 *  through its own path, so the page sees `run_finished`. */
async function handleStop(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const id = parsePathId(req, runId, 1)

  if (id === null) {
    return apiError('invalid_body')
  }

  const stopped =
    ctx.app.resolve('runRegistry').abortRun(id) ||
    ctx.app.resolve('slashDispatcher').abortCommand(id)

  return stopped
    ? json({ stopped: true } satisfies RunStopWire, 202)
    : apiError('not_found', t(localeOf(ctx), 'errors.runNotFound'))
}

/** One page of a run's calls: a debate with retries stays far under it. */
const RUN_CALLS_MAX = 200

/** Operator only: the figures here are never handed to a model. An unknown or unbilled run answers
 *  an empty list. */
async function handleCalls(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const id = parsePathId(req, runId, 1)

  if (id === null) {
    return apiError('invalid_body')
  }

  // One row past the page tells a full page from a cut one.
  const read = await ctx.app.resolve('spendReader').callsForRun(id, RUN_CALLS_MAX + 1)

  return json({
    runId: id,
    calls: read.calls.slice(0, RUN_CALLS_MAX).map(toRunCallWire),
    truncated: read.calls.length > RUN_CALLS_MAX,
    totalCalls: read.totalCalls,
    totalUsd: read.totalUsd,
  } satisfies RunCallsWire)
}

function toRunCallWire(attempt: RunAttempt): RunCallWire {
  return {
    at: attempt.settledAt,
    runId: attempt.runId,
    ...(attempt.parentRunId === undefined ? {} : { parentRunId: attempt.parentRunId }),
    agentId: attempt.agentId,
    kind: attempt.kind,
    provider: attempt.provider,
    model: attempt.model,
    inputTokens: attempt.inputTokens,
    outputTokens: attempt.outputTokens,
    cacheReadTokens: attempt.cacheReadTokens,
    cacheWriteTokens: attempt.cacheWriteTokens,
    reasoningTokens: attempt.reasoningTokens,
    costUsd: attempt.costUsd,
    latencyMs: attempt.latencyMs,
    outcome: attempt.outcome,
    ...(attempt.errorCode === undefined ? {} : { errorCode: attempt.errorCode }),
  }
}

export const RUN_ROUTES: readonly ApiRouteSpec[] = [
  { method: 'POST', path: '/v1/runs/:runId/stop', auth: true, handler: handleStop },
  { method: 'GET', path: '/v1/runs/:runId/calls', auth: true, handler: handleCalls },
]
