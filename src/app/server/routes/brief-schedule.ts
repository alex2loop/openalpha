import type { BriefScheduleWire } from '@/app/server/wire/system'
import type { App } from '@/core/container'
import { toBriefScheduleWire } from '@/app/server/mappers/brief'
import { formatErrForLog } from '@/core/security/credentials'

// The state is polled every few seconds, so the brief read can never fail the whole payload.
export async function readBriefSchedule(
  app: App,
  signal: AbortSignal
): Promise<BriefScheduleWire | undefined> {
  if (!app.has('tradingHost')) {
    return undefined
  }

  try {
    const delivery = await app.resolve('tradingHost').getBriefDelivery({ signal })

    return delivery === null ? undefined : toBriefScheduleWire(delivery)
  } catch (err: unknown) {
    // A client that hung up mid-read is not a failure of the read.
    if (!signal.aborted) {
      app.resolve('logger').warn('api.brief_schedule_failed', { err: formatErrForLog(err) })
    }

    return undefined
  }
}
