import { type Command, createCommand } from '@/cli/command'
import { usage } from '@/cli/error-output'
import { CLI_FLAG_DESCRIPTIONS } from '@/cli/metadata'
import { flagBool, flagString } from '@/cli/parsing/args'
import { fail, success } from '@/cli/ui/colors'
import { confirm, declined, defaultPrompt } from '@/cli/ui/prompt'
import { t } from '@/i18n'
import { renderApproveOutcome, renderDraftView } from '@/social/api'

export const socialDraftsCommand: Command = createCommand({
  name: 'drafts',
  summary: { key: 'cliHelp.socialDraftsSummary' },
  async run(_args, app): Promise<number> {
    const locale = app.config.locale.language
    const drafts = await app.resolve('socialService').listDrafts()

    if (drafts.length === 0) {
      app.out(t(locale, 'cli.socialNoDrafts'))
      return 0
    }

    drafts.forEach((draft, index) => {
      if (index > 0) {
        app.out('')
      }

      for (const line of renderDraftView({ locale }, draft)) {
        app.out(line)
      }
    })

    return 0
  },
})

export const socialApproveCommand: Command = createCommand({
  name: 'approve',
  summary: { key: 'cliHelp.socialApproveSummary' },
  spec: {
    positional: ['id'],
    flags: { yes: { type: 'boolean', describe: CLI_FLAG_DESCRIPTIONS.skipConfirmation } },
  },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const id = flagString(args, 'id')

    if (id === undefined) {
      return usage(app, t(locale, 'cli.socialDraftIdUsage'))
    }

    const service = app.resolve('socialService')

    // The operator approves what they just read.
    for (const line of renderDraftView({ locale }, await service.findDraft(id))) {
      app.out(line)
    }

    const asked = t(locale, 'cli.socialApproveConfirm', { id })

    if (!(flagBool(args, 'yes') || (await confirm(defaultPrompt(), asked, locale)))) {
      return declined(app)
    }

    const outcome = renderApproveOutcome({ locale }, id, await service.approveDraft(id, app.signal))
    const [first = '', ...rest] = outcome.lines

    app.out(outcome.ok ? success(first) : fail(first))

    for (const line of rest) {
      app.out(line)
    }

    return outcome.ok ? 0 : 1
  },
})

export const socialDiscardCommand: Command = createCommand({
  name: 'discard',
  summary: { key: 'cliHelp.socialDiscardSummary' },
  spec: { positional: ['id'] },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const id = flagString(args, 'id')

    if (id === undefined) {
      return usage(app, t(locale, 'cli.socialDraftIdUsage'))
    }

    await app.resolve('socialService').discardDraft(id)
    app.out(success(t(locale, 'cli.socialDiscarded', { id })))

    return 0
  },
})
