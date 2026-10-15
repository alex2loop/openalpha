import { type Command, createCommand } from '@/cli/command'
import { usage } from '@/cli/error-output'
import { flagString } from '@/cli/parsing/args'
import { success, warn } from '@/cli/ui/colors'
import { t } from '@/i18n'

const REVIEW_MODES = ['on', 'off'] as const

export const socialReviewCommand: Command = createCommand({
  name: 'review',
  summary: { key: 'cliHelp.socialReviewSummary' },
  spec: { positional: ['agent', 'network', 'mode'] },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const agent = flagString(args, 'agent')
    const network = flagString(args, 'network')
    const mode = flagString(args, 'mode')

    if (agent === undefined || network === undefined || !REVIEW_MODES.some((m) => m === mode)) {
      return usage(app, t(locale, 'cli.socialReviewUsage'))
    }

    const on = mode === 'on'
    const service = app.resolve('socialService')

    await service.setReview(agent, network, on)
    app.out(
      success(t(locale, on ? 'cli.socialReviewOn' : 'cli.socialReviewOff', { agent, network }))
    )

    if (on && (await service.hasVerifyEndpoint(network))) {
      app.out(warn(t(locale, 'cli.socialReviewChallenge', { network })))
    }

    return 0
  },
})
