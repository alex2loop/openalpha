import type { Locale } from '@/core/types/locale'
import type { Job, JobSchedule } from '@/scheduler/api'
import { type Command, createCommand } from '@/cli/command'
import { hint, style, success } from '@/cli/ui/colors'
import { formatLongDuration } from '@/core/utils/duration'
import { t } from '@/i18n'
import { formatInstant } from '@/trading/api'

const PROMPT_PREVIEW_CHARS = 40

export const scheduleListCommand: Command = createCommand({
  name: 'list',
  summary: { key: 'cliHelp.scheduleListSummary' },
  async run(_args, app): Promise<number> {
    const { language: locale, timezone } = app.config.locale
    const jobs = await app.resolve('jobStore').list()

    app.out(style.heading(t(locale, 'cli.scheduleListHeading', { count: jobs.length })))
    if (jobs.length === 0) {
      app.out(hint(t(locale, 'cli.scheduleNonePlaceholder')))
    }
    for (const job of jobs) {
      app.out(`  ${formatJobLine(job, locale, timezone)}`)
    }

    return 0
  },
})

export function formatSchedule(schedule: JobSchedule, locale: Locale, timezone: string): string {
  if (schedule.kind === 'cron') {
    return t(locale, 'cli.scheduleCronFormat', { expr: schedule.expr, tz: schedule.timezone })
  }

  if (schedule.kind === 'interval') {
    return t(locale, 'cli.scheduleIntervalFormat', {
      duration: formatLongDuration(locale, schedule.everyMs),
    })
  }

  return t(locale, 'cli.scheduleOnceFormat', { time: formatInstant(locale, schedule.at, timezone) })
}

function formatJobLine(job: Job, locale: Locale, timezone: string): string {
  const dot = job.enabled ? success('*') : hint('-')
  const preview =
    job.prompt.length > PROMPT_PREVIEW_CHARS
      ? `${job.prompt.slice(0, PROMPT_PREVIEW_CHARS)}...`
      : job.prompt

  return `${dot} ${job.id}  [${job.agentId}]  ${formatSchedule(job.schedule, locale, timezone)}  -> ${preview}`
}
