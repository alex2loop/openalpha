import type { CliApp } from '@/cli/types'
import type { JobId } from '@/core/ids'
import type { Locale } from '@/core/types/locale'
import type { Job } from '@/scheduler/api'
import { type Command, createCommand } from '@/cli/command'
import { terminalErrorMessage, usage } from '@/cli/error-output'
import { flagString } from '@/cli/parsing/args'
import { fail } from '@/cli/ui/colors'
import { jobId } from '@/core/ids'
import { type MessageKey, t } from '@/i18n'
import { formatInstant } from '@/trading/api'

import { formatSchedule } from './list'

interface JobFound {
  readonly kind: 'value'
  readonly job: Job
}

interface JobLookupError {
  readonly kind: 'error'
  readonly error: string
}

type JobResult = JobFound | JobLookupError

export const scheduleShowCommand: Command = createCommand({
  name: 'show',
  summary: { key: 'cliHelp.scheduleShowSummary' },
  spec: { positional: ['id'] },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const rawId = flagString(args, 'id')

    if (rawId === undefined) {
      return usage(app, t(locale, 'cli.scheduleStateUsage', { action: 'show' }))
    }

    const result = await findJob(app, rawId, locale)

    if (result.kind === 'error') {
      app.err(fail(result.error))

      return 1
    }

    printJobDetail(app, result.job, locale)

    return 0
  },
})

export async function findJob(app: CliApp, rawId: string, locale: Locale): Promise<JobResult> {
  let id: JobId

  try {
    id = jobId(rawId)
  } catch (err: unknown) {
    return { kind: 'error', error: terminalErrorMessage(err, locale) }
  }

  const found = await app.resolve('jobStore').find(id)

  return found === undefined
    ? { kind: 'error', error: t(locale, 'cli.scheduleNoJobWithId', { id: rawId }) }
    : { kind: 'value', job: found }
}

function printJobDetail(app: CliApp, job: Job, locale: Locale): void {
  const { timezone } = app.config.locale
  const enabled = t(locale, job.enabled ? 'cli.scheduleEnabledYes' : 'cli.scheduleEnabledNo')
  const rows: readonly (readonly [MessageKey, string])[] = [
    ['cli.scheduleFieldId', job.id],
    ['cli.scheduleFieldAgent', job.agentId],
    ['cli.scheduleFieldEnabled', enabled],
    ['cli.scheduleFieldSchedule', formatSchedule(job, locale, timezone)],
    ...nextRunRows(job, locale, timezone),
    ['cli.scheduleFieldTarget', formatTarget(job, locale)],
    ['cli.scheduleFieldFailures', String(job.consecutiveFailures)],
    ['cli.scheduleFieldTools', formatJobTools(app, job, locale)],
    ['cli.scheduleFieldPrompt', job.prompt],
  ]
  const labels = rows.map(([key]) => `${t(locale, key)}:`)
  const width = Math.max(...labels.map((label) => Bun.stringWidth(label)))

  rows.forEach(([, value], idx) => {
    const label = labels[idx] ?? ''

    app.out(`${label}${' '.repeat(width - Bun.stringWidth(label))} ${value}`)
  })
}

// An event job has no next run, and a paused one will not run then: the row would print its
// parking slot.
function nextRunRows(
  job: Job,
  locale: Locale,
  timezone: string
): readonly (readonly [MessageKey, string])[] {
  return job.event === undefined && job.enabled
    ? [['cli.scheduleFieldNextRun', formatInstant(locale, job.nextRunAt, timezone)]]
    : []
}

function formatTarget(job: Job, locale: Locale): string {
  return job.target === undefined
    ? t(locale, 'cli.scheduleChannelDefault')
    : `${job.target.channel}:${job.target.chatId}`
}

function formatJobTools(app: CliApp, job: Job, locale: Locale): string {
  if (job.allowedTools !== undefined && job.allowedTools.length > 0) {
    return `${job.allowedTools.join(', ')} ${t(locale, 'cli.scheduleToolsRestricted')}`
  }

  const agent = app.resolve('agents').get(job.agentId)
  const tools = agent?.tools

  return tools === undefined || tools.length === 0
    ? t(locale, 'cli.scheduleToolsNone')
    : `${tools.join(', ')} ${t(locale, 'cli.scheduleToolsAll')}`
}
