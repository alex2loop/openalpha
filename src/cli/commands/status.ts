import type { CliApp } from '@/cli/types'
import type { Locale } from '@/core/types/locale'
import type { SessionSummary } from '@/persistence/api'
import { type Command, createCommand } from '@/cli/command'
import { liveDaemonPid } from '@/cli/daemon-guard'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'
import { hint, style, success, warn } from '@/cli/ui/colors'
import { formatSessionRow } from '@/cli/ui/format'
import { BRAND } from '@/core/brand'
import { formatSpend } from '@/core/utils/cost'
import { t } from '@/i18n'

const RECENT_SESSIONS_LIMIT = 5

export const statusCommand: Command = createCommand({
  ...CLI_COMMAND_METADATA.status,
  async run(_args, app): Promise<number> {
    const locale = app.config.locale.language
    app.out(style.heading(t(locale, 'cli.statusTitle', { brand: BRAND.display })))
    app.out(await daemonLine(app, locale))
    app.out('')

    await printChannels(app, locale)
    app.out('')

    const sessions = await app.resolve('sessionStore').listRecent(RECENT_SESSIONS_LIMIT)
    printRecentSessions(app, sessions, locale)
    app.out('')

    await printSpend(app, locale)

    return 0
  },
})

async function daemonLine(app: CliApp, locale: Locale): Promise<string> {
  const pid = await liveDaemonPid(app)

  return pid === null
    ? warn(t(locale, 'cli.statusDaemonNotRunning'))
    : success(t(locale, 'cli.statusDaemonRunning', { pid }))
}

// The same configured channel list `/health` reports; liveness is the daemon's to observe, and this
// process already says whether one is running.
async function printChannels(app: CliApp, locale: Locale): Promise<void> {
  const { channels } = await app.resolve('healthSummary').read()

  app.out(style.heading(t(locale, 'cli.statusChannelsHeading', { count: channels.length })))

  if (channels.length === 0) {
    app.out(hint(t(locale, 'cli.statusNoChannelsPlaceholder')))
    return
  }

  const pairings = app.resolve('pairingStore')
  const now = Date.now()
  const pending = await Promise.all(
    channels.map((entry) => pairings.listPending(entry.channel, now))
  )

  for (const [index, entry] of channels.entries()) {
    const count = pending[index]?.length ?? 0
    app.out(`  ${entry.channel}  ${t(locale, 'cli.statusChannelPending', { count })}`)
  }
}

function printRecentSessions(
  app: CliApp,
  sessions: readonly SessionSummary[],
  locale: Locale
): void {
  app.out(style.heading(t(locale, 'cli.statusRecentSessionsHeading', { count: sessions.length })))

  if (sessions.length === 0) {
    app.out(hint(t(locale, 'cli.statusNoSessionsPlaceholder')))
    return
  }

  for (const session of sessions) {
    app.out(`  ${formatSessionRow(locale, session, app.config.locale.timezone)}`)
  }
}

async function printSpend(app: CliApp, locale: Locale): Promise<void> {
  const today = await app.resolve('spendReader').forPeriod('day', Date.now())

  app.out(style.heading(t(locale, 'cli.statusSpendTodayHeading')))
  app.out(`  ${formatSpend(today, app.config.budget.maxDailyUsd)}`)
}
