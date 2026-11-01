import type { JobEventWire } from '@/app/server/wire/jobs'
import { tr } from '@/web/text/tr'

/** "FPT thủng mức cắt lỗ", or "một mã ..." for a job that runs for any name. */
export function describeEvent(trigger: Pick<JobEventWire, 'event' | 'ticker'>): string {
  const subject = trigger.ticker ?? tr('scheduler.event.anyName')

  return tr('ui.office.jobs.eventWhen', {
    subject,
    event: tr(`scheduler.event.${trigger.event}`),
  })
}
