import { type Command, createCommand } from '@/cli/command'
import { usage } from '@/cli/error-output'
import { flagString } from '@/cli/parsing/args'
import { stripControls, toSingleLine } from '@/core/utils/text'
import { t } from '@/i18n'
import { formatInstant } from '@/trading/api'

export const socialLogCommand: Command = createCommand({
  name: 'log',
  summary: { key: 'cliHelp.socialLogSummary' },
  // Every positional is optional, so a missing agent gets its own usage branch below.
  spec: { positional: ['agent', 'network'], positionalOptional: true },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const agent = flagString(args, 'agent')
    const network = flagString(args, 'network')

    if (agent === undefined) {
      return usage(app, t(locale, 'cli.socialLogUsage'))
    }

    const writes = await app.resolve('socialService').listWrites(agent, network)

    if (writes.length === 0) {
      app.out(t(locale, 'cli.socialNoWrites', { agent }))
      return 0
    }

    for (const write of writes) {
      app.out(
        t(locale, 'cli.socialWriteLine', {
          when: formatInstant(locale, write.at, app.config.locale.timezone),
          network: write.network,
          label: write.label,
          id: write.returnedId === undefined ? '' : stripControls(write.returnedId),
          // One write, one line: a newline in the agent's text must not forge a second entry.
          excerpt: toSingleLine(stripControls(write.excerpt)),
        })
      )
    }

    return 0
  },
})
