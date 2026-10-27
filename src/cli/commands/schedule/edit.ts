import type { ParsedArgs } from '@/cli/parsing/args'
import type { ChannelAddress } from '@/core/channels'
import type { Locale } from '@/core/types/locale'
import type { Job } from '@/scheduler/api'
import { type Command, createCommand } from '@/cli/command'
import { terminalErrorMessage, usage } from '@/cli/error-output'
import { flagString } from '@/cli/parsing/args'
import { fail, success } from '@/cli/ui/colors'
import { parseChannelAddress } from '@/core/channels'
import { t } from '@/i18n'

import type { ScheduleResult } from './types'
import { promptRefusal, resolveCronSchedule, resolveSchedule } from './add'
import { findJob } from './show'

interface EditApplied {
  readonly kind: 'value'
  readonly job: Job
}

interface EditError {
  readonly kind: 'error'
  readonly error: string
}

type EditJobResult = EditApplied | EditError

export const scheduleEditCommand: Command = createCommand({
  name: 'edit',
  summary: { key: 'cliHelp.scheduleEditSummary' },
  spec: {
    positional: ['id'],
    flags: {
      cron: { type: 'string', describe: { key: 'cliHelp.flagScheduleNewCron' } },
      every: { type: 'string', describe: { key: 'cliHelp.flagScheduleNewEvery' } },
      tz: { type: 'string', describe: { key: 'cliHelp.flagScheduleNewTimezone' } },
      prompt: { type: 'string', describe: { key: 'cliHelp.flagScheduleNewPrompt' } },
      to: { type: 'string', describe: { key: 'cliHelp.flagScheduleNewTarget' } },
      agent: { type: 'string', describe: { key: 'cliHelp.flagScheduleAgentImmutable' } },
    },
  },
  needs: { daemon: 'stopped' },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language

    if (flagString(args, 'agent') !== undefined) {
      return usage(app, t(locale, 'cli.scheduleCantChangeAgent'))
    }

    const rawId = flagString(args, 'id')

    if (rawId === undefined) {
      return usage(app, t(locale, 'cli.scheduleEditUsage'))
    }

    const found = await findJob(app, rawId, locale)

    if (found.kind === 'error') {
      app.err(fail(found.error))

      return 1
    }

    const prompt = flagString(args, 'prompt')
    const promptError = prompt === undefined ? undefined : promptRefusal(app, prompt, locale)

    if (promptError !== undefined) {
      return usage(app, promptError)
    }

    const edited = applyEdits({ job: found.job, args, tz: app.config.locale.timezone, locale })

    if (edited.kind === 'error') {
      return usage(app, edited.error)
    }

    await app.resolve('jobStore').put(edited.job)
    app.out(success(t(locale, 'cli.scheduleUpdated', { id: found.job.id })))

    return 0
  },
})

function applyEdits(options: {
  readonly job: Job
  readonly args: ParsedArgs
  readonly tz: string
  readonly locale: Locale
}): EditJobResult {
  const prompt = flagString(options.args, 'prompt')
  const rawTarget = flagString(options.args, 'to')
  const rawTimezone = flagString(options.args, 'tz')
  const reschedule = flagString(options.args, 'cron') ?? flagString(options.args, 'every')

  if (
    prompt === undefined &&
    rawTarget === undefined &&
    reschedule === undefined &&
    rawTimezone === undefined
  ) {
    return { kind: 'error', error: t(options.locale, 'cli.scheduleEditUsage') }
  }

  const target = parseTarget(rawTarget, options.locale)

  if (target.kind === 'error') {
    return target
  }

  const scheduled = resolveEditedSchedule({
    job: options.job,
    args: options.args,
    defaultTimezone: options.tz,
    rawTimezone: rawTimezone,
    locale: options.locale,
  })

  if (scheduled?.kind === 'error') {
    return { kind: 'error', error: scheduled.error }
  }

  return {
    kind: 'value',
    job: {
      ...options.job,
      ...(prompt === undefined ? {} : { prompt }),
      ...(target.value === undefined ? {} : { target: target.value }),
      ...(scheduled === undefined
        ? {}
        : { schedule: scheduled.schedule, nextRunAt: scheduled.nextRunAt }),
    },
  }
}

function parseTarget(
  rawTarget: string | undefined,
  locale: Locale
): { readonly kind: 'value'; readonly value?: ChannelAddress } | EditError {
  try {
    const value = rawTarget === undefined ? undefined : parseChannelAddress(rawTarget)

    return { kind: 'value', ...(value === undefined ? {} : { value }) }
  } catch (err: unknown) {
    return { kind: 'error', error: terminalErrorMessage(err, locale) }
  }
}

function resolveEditedSchedule(options: {
  readonly job: Job
  readonly args: ParsedArgs
  readonly defaultTimezone: string
  readonly rawTimezone: string | undefined
  readonly locale: Locale
}): ScheduleResult | undefined {
  const cronExpr = flagString(options.args, 'cron')
  const every = flagString(options.args, 'every')

  if (options.job.event !== undefined && (cronExpr ?? every ?? options.rawTimezone) !== undefined) {
    return { kind: 'error', error: t(options.locale, 'cli.scheduleEventNoSchedule') }
  }

  if (cronExpr !== undefined || every !== undefined) {
    const storedTimezone =
      options.job.schedule.kind === 'cron' ? options.job.schedule.timezone : undefined

    return resolveSchedule(
      options.args,
      options.rawTimezone ?? storedTimezone ?? options.defaultTimezone,
      options.locale
    )
  }

  if (options.rawTimezone === undefined) {
    return undefined
  }

  if (options.job.schedule.kind !== 'cron') {
    return { kind: 'error', error: t(options.locale, 'cli.scheduleTzCronOnly') }
  }

  return resolveCronSchedule(options.job.schedule.expr, options.rawTimezone, options.locale)
}
