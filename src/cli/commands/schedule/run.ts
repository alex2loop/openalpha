import { randomUUID } from 'node:crypto'

import { type Command, createCommand } from '@/cli/command'
import { usage } from '@/cli/error-output'
import { flagString } from '@/cli/parsing/args'
import { fail, success } from '@/cli/ui/colors'
import { t } from '@/i18n'

import { formatJobFailure } from './result'

export const scheduleRunNowCommand: Command = createCommand({
  name: 'run-now',
  summary: { key: 'cliHelp.scheduleRunSummary' },
  spec: { positional: ['id'] },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const rawId = flagString(args, 'id')

    if (rawId === undefined) {
      return usage(app, t(locale, 'cli.scheduleRunUsage'))
    }

    app.out(t(locale, 'cli.scheduleRunStarted', { id: rawId }))

    // No owner: the local console runs a job whoever created it, as `schedule remove` already does.
    const result = await app.resolve('schedulerCommands').runNow({
      idOrPrefix: rawId,
      requestId: randomUUID(),
      signal: app.signal,
    })

    if (result.kind !== 'job') {
      app.err(
        fail(
          formatJobFailure({
            result,
            id: rawId,
            locale,
            usageKey: 'cli.scheduleRunUsage',
            rejectedKey: 'cli.scheduleRunRejected',
          })
        )
      )

      return 1
    }

    app.out(success(t(locale, 'cli.scheduleRunDone', { id: result.job.id })))

    return 0
  },
})
