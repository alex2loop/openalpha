import { type Command, createCommand } from '@/cli/command'
import { usage } from '@/cli/error-output'
import { flagString } from '@/cli/parsing/args'
import { success } from '@/cli/ui/colors'
import { t } from '@/i18n'

export const socialRollbackCommand: Command = createCommand({
  name: 'rollback',
  summary: { key: 'cliHelp.socialRollbackSummary' },
  spec: { positional: ['network'] },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const network = flagString(args, 'network')

    if (network === undefined) {
      return usage(app, t(locale, 'cli.socialRollbackUsage'))
    }

    await app.resolve('socialService').rollback(network)
    app.out(success(t(locale, 'cli.socialRolledBack', { network })))

    return 0
  },
})
