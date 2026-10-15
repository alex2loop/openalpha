import type { ParsedArgs } from '@/cli/parsing/args'
import type { CliApp } from '@/cli/types'
import type { MessageKey } from '@/i18n'
import { type Command, createCommand } from '@/cli/command'
import { usage } from '@/cli/error-output'
import { flagString } from '@/cli/parsing/args'
import { fail, success } from '@/cli/ui/colors'
import { t } from '@/i18n'

import { formatJobFailure } from './result'

interface EnabledState {
  readonly action: 'pause' | 'resume'
  readonly completedKey: MessageKey
}

const PAUSED_STATE: EnabledState = { action: 'pause', completedKey: 'cli.schedulePaused' }
const RESUMED_STATE: EnabledState = { action: 'resume', completedKey: 'cli.scheduleResumed' }

export const scheduleRemoveCommand: Command = createCommand({
  name: 'remove',
  summary: { key: 'cliHelp.scheduleRemoveSummary' },
  spec: { positional: ['id'] },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const rawId = flagString(args, 'id')

    if (rawId === undefined) {
      return usage(app, t(locale, 'cli.scheduleRemoveUsage'))
    }

    const result = await app.resolve('schedulerCommands').removeAny(rawId)

    if (result.kind !== 'job') {
      app.err(
        fail(
          formatJobFailure({
            result,
            id: rawId,
            locale,
            usageKey: 'cli.scheduleRemoveUsage',
            rejectedKey: 'cli.scheduleCouldNotRemove',
          })
        )
      )

      return 1
    }

    app.out(success(t(locale, 'cli.scheduleRemoved', { id: result.job.id })))

    return 0
  },
})

export const schedulePauseCommand: Command = createCommand({
  name: 'pause',
  summary: { key: 'cliHelp.schedulePauseSummary' },
  spec: { positional: ['id'] },
  run: (args, app): Promise<number> => setEnabled(app, args, PAUSED_STATE),
})

export const scheduleResumeCommand: Command = createCommand({
  name: 'resume',
  summary: { key: 'cliHelp.scheduleResumeSummary' },
  spec: { positional: ['id'] },
  run: (args, app): Promise<number> => setEnabled(app, args, RESUMED_STATE),
})

async function setEnabled(app: CliApp, args: ParsedArgs, state: EnabledState): Promise<number> {
  const locale = app.config.locale.language
  const rawId = flagString(args, 'id')

  if (rawId === undefined) {
    return usage(app, t(locale, 'cli.scheduleStateUsage', { action: state.action }))
  }

  const commands = app.resolve('schedulerCommands')
  const result =
    state.action === 'pause' ? await commands.pauseAny(rawId) : await commands.resumeAny(rawId)

  if (result.kind !== 'job') {
    app.err(
      fail(
        formatJobFailure({
          result,
          id: rawId,
          locale,
          usageKey: 'cli.scheduleStateInvalid',
          rejectedKey: 'cli.scheduleCouldNotChangeState',
        })
      )
    )

    return 1
  }

  app.out(
    success(
      t(locale, 'cli.scheduleStateChanged', {
        action: t(locale, state.completedKey),
        id: result.job.id,
      })
    )
  )

  return 0
}
