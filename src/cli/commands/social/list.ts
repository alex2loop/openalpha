import type { Locale } from '@/core/types/locale'
import type { SocialPauseReason } from '@/core/types/social'
import type { SocialMemberView, SocialNetworkView } from '@/social/api'
import { type Command, createCommand } from '@/cli/command'
import { hint, warn } from '@/cli/ui/colors'
import { BRAND } from '@/core/brand'
import { formatLongDuration } from '@/core/utils/duration'
import { stripControls } from '@/core/utils/text'
import { type MessageKey, pluralKey, t } from '@/i18n'
import { formatInstant } from '@/trading/api'

import { STATE_KEYS } from './format'

const PAUSE_REASON_KEYS: Readonly<Record<SocialPauseReason, MessageKey>> = Object.freeze({
  operator: 'cli.socialPausedByOperator',
  'pin-mismatch': 'cli.socialPausedPinMismatch',
})

export const socialListCommand: Command = createCommand({
  name: 'list',
  summary: { key: 'cliHelp.socialListSummary' },
  async run(_args, app): Promise<number> {
    const locale = app.config.locale.language
    const service = app.resolve('socialService')
    const networks = await service.listNetworks()

    if (networks.length === 0) {
      app.out(t(locale, 'cli.socialNoNetworks', { brand: BRAND.name }))
      return 0
    }

    const members = await service.listMembers()
    const now = Date.now()

    for (const network of networks) {
      const mine = members.filter((member) => member.network === network.name)

      for (const line of networkLines(locale, {
        network,
        members: mine,
        now,
        timezone: app.config.locale.timezone,
      })) {
        app.out(line)
      }
    }

    return 0
  },
})

interface NetworkBlock {
  readonly network: SocialNetworkView
  readonly members: readonly SocialMemberView[]
  readonly now: number
  readonly timezone: string
}

function networkLines(locale: Locale, block: NetworkBlock): readonly string[] {
  const { network, members, now, timezone } = block
  const extras = [
    ...(network.updateWaiting ? [t(locale, 'cli.socialUpdateWaiting')] : []),
    ...(network.pauseReason === undefined
      ? []
      : [t(locale, PAUSE_REASON_KEYS[network.pauseReason])]),
  ]
  const head = t(locale, 'cli.socialNetworkLine', {
    network: network.name,
    state: t(locale, STATE_KEYS[network.state]),
    version:
      network.version === undefined
        ? t(locale, 'cli.socialVersionUnknown')
        : stripControls(network.version),
    apiBase: network.apiBase === undefined ? '-' : stripControls(network.apiBase),
  })

  return [
    [head, ...extras].join(' · '),
    ...members.map((member) => memberLine(locale, member, { now, timezone })),
    ...(network.unlabelled > 0
      ? [
          hint(
            t(
              locale,
              pluralKey(network.unlabelled, 'cli.socialUnlabelledOne', 'cli.socialUnlabelled'),
              {
                count: network.unlabelled,
              }
            )
          ),
        ]
      : []),
    ...(network.apiBase === undefined
      ? [warn(t(locale, 'cli.socialFilesMissing', { network: network.name, brand: BRAND.name }))]
      : []),
  ]
}

interface MemberClock {
  readonly now: number
  readonly timezone: string
}

function memberLine(locale: Locale, member: SocialMemberView, clock: MemberClock): string {
  const line = t(locale, 'cli.socialMemberLine', {
    agent: member.agentId,
    publicName: stripControls(member.publicName),
    state: t(locale, STATE_KEYS[member.state]),
    every: formatLongDuration(locale, member.intervalMs),
    review: member.reviewAll ? t(locale, 'cli.socialReviewMark') : '',
    drafts:
      member.drafts === 0
        ? ''
        : t(
            locale,
            pluralKey(member.drafts, 'cli.socialDraftCountOne', 'cli.socialDraftCountMany'),
            {
              count: member.drafts,
            }
          ),
  })
  const cooling =
    member.cooldownUntil !== undefined && member.cooldownUntil > clock.now
      ? t(locale, 'cli.socialCoolingUntil', {
          time: formatInstant(locale, member.cooldownUntil, clock.timezone),
        })
      : ''

  return [line, cooling].filter((part) => part !== '').join(' · ')
}
