import { type Command, createCommand } from '@/cli/command'
import { usage } from '@/cli/error-output'
import { CLI_FLAG_DESCRIPTIONS } from '@/cli/metadata'
import { flagBool, flagString } from '@/cli/parsing/args'
import { hint, success } from '@/cli/ui/colors'
import { confirm, declined, defaultPrompt } from '@/cli/ui/prompt'
import { t } from '@/i18n'

export const socialRemoveCommand: Command = createCommand({
  name: 'remove',
  summary: { key: 'cliHelp.socialRemoveSummary' },
  spec: {
    positional: ['network'],
    flags: { yes: { type: 'boolean', describe: CLI_FLAG_DESCRIPTIONS.skipConfirmation } },
  },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const network = flagString(args, 'network')

    if (network === undefined) {
      return usage(app, t(locale, 'cli.socialRemoveUsage'))
    }

    const asked = t(locale, 'cli.socialRemoveConfirm', { network })

    if (!(flagBool(args, 'yes') || (await confirm(defaultPrompt(), asked, locale)))) {
      return declined(app)
    }

    await app.resolve('socialService').remove(network)
    app.out(success(t(locale, 'cli.socialRemoved', { network })))
    app.out(hint(t(locale, 'cli.socialRemovedAccountHint', { network })))

    return 0
  },
})
