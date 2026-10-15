import { type Command, createCommand } from '@/cli/command'
import { usage } from '@/cli/error-output'
import { CLI_FLAG_DESCRIPTIONS } from '@/cli/metadata'
import { flagBool, flagList, flagString } from '@/cli/parsing/args'
import { success, warn } from '@/cli/ui/colors'
import { confirm, declined, defaultPrompt } from '@/cli/ui/prompt'
import { BRAND } from '@/core/brand'
import { t } from '@/i18n'
import { withLabels } from '@/social/api'

import { changeLines, parseLabelFlags, previewLines } from './format'

export const socialUpdateCommand: Command = createCommand({
  name: 'update',
  summary: { key: 'cliHelp.socialUpdateSummary' },
  spec: {
    positional: ['network'],
    flags: {
      label: { type: 'string', multi: true, describe: { key: 'cliHelp.flagSocialLabel' } },
      yes: { type: 'boolean', describe: CLI_FLAG_DESCRIPTIONS.skipConfirmation },
    },
  },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const network = flagString(args, 'network')

    if (network === undefined) {
      return usage(app, t(locale, 'cli.socialUpdateUsage'))
    }

    const labels = parseLabelFlags(flagList(args, 'label'))
    const service = app.resolve('socialService')
    const preview = await service.stageUpdate(network, app.signal)

    if (preview === undefined) {
      app.out(t(locale, 'cli.socialUpToDate', { network }))
      return 0
    }

    for (const line of changeLines(locale, preview.changes)) {
      app.out(line)
    }

    // A wrong `--label` is refused here, before the OK, and a right one shows in the preview.
    const shown = { ...preview, pin: withLabels(preview.pin, labels) }

    for (const line of previewLines(locale, shown, preview.newFindings)) {
      app.out(line)
    }

    const asked = t(locale, 'cli.socialUpdateConfirm', { network })

    if (!(flagBool(args, 'yes') || (await confirm(defaultPrompt(), asked, locale)))) {
      return declined(app)
    }

    await service.approveUpdate({ network, pinId: preview.pinId, labels })
    app.out(success(t(locale, 'cli.socialUpdated', { network })))

    if (preview.changes.apiBaseChanged) {
      app.out(warn(t(locale, 'cli.socialApiHostChanged', { brand: BRAND.name })))
    }

    return 0
  },
})
