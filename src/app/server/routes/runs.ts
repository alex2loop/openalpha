import type { RunStopWire } from '@/app/server/wire/live'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
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

export const RUN_ROUTES: readonly ApiRouteSpec[] = [
  { method: 'POST', path: '/v1/runs/:runId/stop', auth: true, handler: handleStop },
]
