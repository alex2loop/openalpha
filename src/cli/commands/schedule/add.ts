import type { ParsedArgs } from '@/cli/parsing/args'
import type { ChannelAddress } from '@/core/channels'
import type { AgentId, JobId } from '@/core/ids'
import type { Locale } from '@/core/types/locale'
import type { Job } from '@/scheduler/api'
import { type Command, createCommand } from '@/cli/command'
import { terminalErrorMessage, usage } from '@/cli/error-output'
import { renderLocalized } from '@/cli/help'
import { flagList, flagString } from '@/cli/parsing/args'
import { parseDurationFlag } from '@/cli/parsing/duration'
import { success } from '@/cli/ui/colors'
import { parseChannelAddress } from '@/core/channels'
import { agentId, jobId } from '@/core/ids'
import { advanceCron } from '@/core/utils/cron'
import { MS_PER_MINUTE, toCanonicalTimeZone } from '@/core/utils/time'
import { t } from '@/i18n'

import type { ScheduleResult } from './types'

// Cron's own granularity: a shorter interval only spends model calls faster.
const MINIMUM_INTERVAL_MS = MS_PER_MINUTE

export const scheduleAddCommand: Command = createCommand({
  name: 'add',
  summary: { key: 'cliHelp.scheduleAddSummary' },
  spec: {
    positional: ['id'],
    flags: {
      agent: { type: 'string', describe: { key: 'cliHelp.flagScheduleAgent' } },
      allowTools: {
        type: 'string',
        multi: true,
        describe: { key: 'cliHelp.flagScheduleAllowTools' },
      },
      prompt: { type: 'string', describe: { key: 'cliHelp.flagSchedulePrompt' } },
      cron: { type: 'string', describe: { key: 'cliHelp.flagScheduleCron' } },
      every: { type: 'string', describe: { key: 'cliHelp.flagScheduleEvery' } },
      tz: { type: 'string', describe: { key: 'cliHelp.flagScheduleTimezone' } },
      to: { type: 'string', describe: { key: 'cliHelp.flagScheduleTo' } },
    },
  },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const rawId = flagString(args, 'id')
    const prompt = flagString(args, 'prompt')

    if (rawId === undefined || prompt === undefined) {
      return usage(app, t(locale, 'cli.scheduleAddUsage'))
    }

    const scheduleResult = resolveSchedule(args, app.config.locale.timezone, locale)

    if (scheduleResult.kind === 'error') {
      return usage(app, scheduleResult.error)
    }

    const rawTarget = flagString(args, 'to')
    const agentRaw = flagString(args, 'agent')
    const allowedTools = parseAllowedTools(args)
    let id: JobId
    let agent: AgentId
    let target: ChannelAddress | undefined

    try {
      id = jobId(rawId)
      agent = agentRaw === undefined ? agentId('chat') : agentId(agentRaw)
      target = rawTarget === undefined ? undefined : parseChannelAddress(rawTarget)
    } catch (err: unknown) {
      return usage(app, terminalErrorMessage(err, locale))
    }

    if (!app.resolve('agents').has(agent)) {
      const validIds = [...app.resolve('agents').keys()].sort().join(', ')

      return usage(
        app,
        t(locale, 'cli.scheduleUnknownAgent', {
          agent: agentRaw ?? 'chat',
          valid: validIds,
        })
      )
    }

    const job: Job = {
      id,
      agentId: agent,
      prompt,
      schedule: scheduleResult.schedule,
      ...(allowedTools === undefined ? {} : { allowedTools }),
      ...(target === undefined ? {} : { target }),
      enabled: true,
      nextRunAt: scheduleResult.nextRunAt,
      consecutiveFailures: 0,
    }

    const created = await app.resolve('jobStore').create(job)

    if (!created) {
      return usage(app, t(locale, 'cli.scheduleJobAlreadyExists', { id }))
    }

    app.out(success(t(locale, 'cli.scheduleAdded', { id })))

    return 0
  },
})

export function resolveSchedule(args: ParsedArgs, tz: string, locale: Locale): ScheduleResult {
  const cronExpr = flagString(args, 'cron')
  const everyRaw = flagString(args, 'every')

  if (cronExpr !== undefined && everyRaw !== undefined) {
    return {
      kind: 'error',
      error: t(locale, 'cli.scheduleCronOrEveryOnly'),
    }
  }

  if (cronExpr !== undefined) {
    return resolveCronSchedule(cronExpr, flagString(args, 'tz') ?? tz, locale)
  }

  if (everyRaw !== undefined && flagString(args, 'tz') !== undefined) {
    return { kind: 'error', error: t(locale, 'cli.scheduleTzCronOnly') }
  }

  if (everyRaw !== undefined) {
    return resolveIntervalSchedule(everyRaw, locale)
  }

  return {
    kind: 'error',
    error: t(locale, 'cli.scheduleCronOrEveryRequired'),
  }
}

export function resolveCronSchedule(expr: string, tz: string, locale: Locale): ScheduleResult {
  try {
    const timezone = toCanonicalTimeZone(tz)
    const now = new Date()
    const nextRunAt = advanceCron(expr, now, timezone).getTime()

    return { kind: 'value', schedule: { kind: 'cron', expr, timezone }, nextRunAt }
  } catch (err: unknown) {
    return { kind: 'error', error: `--cron: ${terminalErrorMessage(err, locale)}` }
  }
}

function resolveIntervalSchedule(raw: string, locale: Locale): ScheduleResult {
  const parsed = parseDurationFlag(raw, '--every')

  if (parsed.kind === 'error') {
    return { kind: 'error', error: renderLocalized(locale, parsed.error) }
  }

  if (parsed.ms < MINIMUM_INTERVAL_MS) {
    return { kind: 'error', error: t(locale, 'cli.scheduleEveryTooShort', { value: raw }) }
  }

  const now = Date.now()

  return {
    kind: 'value',
    schedule: { kind: 'interval', everyMs: parsed.ms },
    nextRunAt: now + parsed.ms,
  }
}

function parseAllowedTools(args: ParsedArgs): readonly string[] | undefined {
  const raw = flagList(args, 'allowTools')
  const items = raw.flatMap((entry) =>
    entry
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
  )

  return items.length > 0 ? items : undefined
}
