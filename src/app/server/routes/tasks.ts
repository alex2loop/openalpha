import type { IntradayNextWire, TasksResponse } from '@/app/server/wire/tasks'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import type { App } from '@/core/container'
import { json } from '@/app/server/http/dispatch'
import { readBriefSchedule } from '@/app/server/routes/brief-schedule'
import { formatErrForLog } from '@/core/security/credentials'

// Like the brief read, this never fails the payload: the page polls it for the tasks.
async function readIntradayNext(
  app: App,
  signal: AbortSignal
): Promise<IntradayNextWire | undefined> {
  if (!app.has('tradingHost')) {
    return undefined
  }

  try {
    return await app.resolve('tradingHost').nextIntraday(signal)
  } catch (err: unknown) {
    if (!signal.aborted) {
      app.resolve('logger').warn('api.intraday_next_failed', { err: formatErrForLog(err) })
    }

    return undefined
  }
}

async function handleTasks(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const [brief, intraday] = await Promise.all([
    readBriefSchedule(ctx.app, req.signal),
    readIntradayNext(ctx.app, req.signal),
  ])

  return json({
    tasks: ctx.app.resolve('taskStatus').list(),
    ...(brief === undefined ? {} : { brief }),
    ...(intraday === undefined ? {} : { intraday }),
  } satisfies TasksResponse)
}

export const TASK_ROUTES: readonly ApiRouteSpec[] = [
  { method: 'GET', path: '/v1/tasks', auth: true, handler: handleTasks },
]
