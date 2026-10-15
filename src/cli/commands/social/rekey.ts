import { type Command, createCommand } from '@/cli/command'
import { getEnv } from '@/cli/env'
import { usage } from '@/cli/error-output'
import { flagString } from '@/cli/parsing/args'
import { success } from '@/cli/ui/colors'
import { resolveCredential } from '@/core/security/credentials'
import { t } from '@/i18n'

export const socialRekeyCommand: Command = createCommand({
  name: 'rekey',
  summary: { key: 'cliHelp.socialRekeySummary' },
  spec: {
    positional: ['agent', 'network'],
    flags: { keyEnv: { type: 'string', describe: { key: 'cliHelp.flagSocialKeyEnv' } } },
  },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const agent = flagString(args, 'agent')
    const network = flagString(args, 'network')
    const keyEnv = flagString(args, 'keyEnv')

    if (agent === undefined || network === undefined || keyEnv === undefined) {
      return usage(app, t(locale, 'cli.socialRekeyUsage'))
    }

    const apiKey = resolveCredential(getEnv(), keyEnv)

    if (apiKey === undefined) {
      return usage(app, t(locale, 'cli.socialKeyEnvMissing', { name: keyEnv }))
    }

    await app.resolve('socialService').rekey(agent, network, apiKey)
    app.out(success(t(locale, 'cli.socialRekeyed', { agent, network })))

    return 0
  },
})
