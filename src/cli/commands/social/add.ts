import { type Command, createCommand } from '@/cli/command'
import { usage } from '@/cli/error-output'
import { CLI_FLAG_DESCRIPTIONS } from '@/cli/metadata'
import { flagBool, flagList, flagString } from '@/cli/parsing/args'
import { success } from '@/cli/ui/colors'
import { confirm, declined, defaultPrompt } from '@/cli/ui/prompt'
import { BRAND } from '@/core/brand'
import { t } from '@/i18n'

import { parseLabelFlags, previewLines } from './format'

export const socialAddCommand: Command = createCommand({
  name: 'add',
  summary: { key: 'cliHelp.socialAddSummary' },
  spec: {
    positional: ['url'],
    flags: {
      name: { type: 'string', describe: { key: 'cliHelp.flagSocialName' } },
      apiBase: { type: 'string', describe: { key: 'cliHelp.flagSocialApiBase' } },
      label: { type: 'string', multi: true, describe: { key: 'cliHelp.flagSocialLabel' } },
      yes: { type: 'boolean', describe: CLI_FLAG_DESCRIPTIONS.skipConfirmation },
    },
  },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const url = flagString(args, 'url')

    if (url === undefined) {
      return usage(app, t(locale, 'cli.socialAddUsage'))
    }

    const name = flagString(args, 'name')
    const apiBase = flagString(args, 'apiBase')
    const service = app.resolve('socialService')
    const preview = await service.previewAdd(
      {
        url,
        labels: parseLabelFlags(flagList(args, 'label')),
        ...(name === undefined ? {} : { name }),
        ...(apiBase === undefined ? {} : { apiBase }),
      },
      app.signal
    )

    for (const line of previewLines(locale, preview)) {
      app.out(line)
    }

    const network = preview.pin.name
    const asked = t(locale, 'cli.socialAddConfirm', { network })

    if (!(flagBool(args, 'yes') || (await confirm(defaultPrompt(), asked, locale)))) {
      return declined(app)
    }

    await service.add(preview)
    app.out(success(t(locale, 'cli.socialAdded', { network, brand: BRAND.name })))

    return 0
  },
})
