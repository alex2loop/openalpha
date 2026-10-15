import type { SocialNetworkState } from '@/core/types/social'
import { type Command, createCommand } from '@/cli/command'
import { usage } from '@/cli/error-output'
import { flagString } from '@/cli/parsing/args'
import { success } from '@/cli/ui/colors'
import { t } from '@/i18n'

function stateCommand(name: 'pause' | 'resume', state: SocialNetworkState): Command {
  return createCommand({
    name,
    summary: {
      key: name === 'pause' ? 'cliHelp.socialPauseSummary' : 'cliHelp.socialResumeSummary',
    },
    // Every positional is optional, so a missing network gets its own usage branch below.
    spec: { positional: ['network', 'agent'], positionalOptional: true },
    async run(args, app): Promise<number> {
      const locale = app.config.locale.language
      const network = flagString(args, 'network')
      const agent = flagString(args, 'agent')

      if (network === undefined) {
        return usage(app, t(locale, 'cli.socialStateUsage', { command: name }))
      }

      const service = app.resolve('socialService')

      if (agent !== undefined) {
        await service.setMemberState(agent, network, state)
        const key = state === 'paused' ? 'cli.socialMemberPaused' : 'cli.socialMemberResumed'

        app.out(success(t(locale, key, { agent, network })))

        return 0
      }

      if (!(await service.setNetworkState(network, state))) {
        app.out(t(locale, 'cli.socialNetworkUnchanged', { network }))
        return 0
      }

      const key = state === 'paused' ? 'cli.socialNetworkPaused' : 'cli.socialNetworkResumed'

      app.out(success(t(locale, key, { network })))

      return 0
    },
  })
}

export const socialPauseCommand: Command = stateCommand('pause', 'paused')
export const socialResumeCommand: Command = stateCommand('resume', 'active')
