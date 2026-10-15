import { type Command, createCommand } from '@/cli/command'
import { usage } from '@/cli/error-output'
import { CLI_FLAG_DESCRIPTIONS } from '@/cli/metadata'
import { flagBool, flagString } from '@/cli/parsing/args'
import { success } from '@/cli/ui/colors'
import { confirm, declined, defaultPrompt } from '@/cli/ui/prompt'
import { t } from '@/i18n'

export const socialLeaveCommand: Command = createCommand({
  name: 'leave',
  summary: { key: 'cliHelp.socialLeaveSummary' },
  spec: {
    positional: ['agent', 'network'],
    flags: { yes: { type: 'boolean', describe: CLI_FLAG_DESCRIPTIONS.skipConfirmation } },
  },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const agent = flagString(args, 'agent')
    const network = flagString(args, 'network')

    if (agent === undefined || network === undefined) {
      return usage(app, t(locale, 'cli.socialLeaveUsage'))
    }

    const asked = t(locale, 'cli.socialLeaveConfirm', { agent, network })

    if (!(flagBool(args, 'yes') || (await confirm(defaultPrompt(), asked, locale)))) {
      return declined(app)
    }

    await app.resolve('socialService').leave(agent, network)
    app.out(success(t(locale, 'cli.socialLeft', { agent, network })))

    return 0
  },
})
