import type { CliApp } from '@/cli/types'
import type { DegradedEntry } from '@/core/container'
import type { Locale } from '@/core/types/locale'
import type { SessionSummary } from '@/persistence/api'
import { type Command, createCommand } from '@/cli/command'
import { liveDaemon, type RunningDaemon, readDaemonDegraded } from '@/cli/daemon-guard'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'
import { hint, style, success, warn } from '@/cli/ui/colors'
import { formatSessionRow } from '@/cli/ui/format'
import { BRAND } from '@/core/brand'
import { formatSpend } from '@/core/utils/cost'
import { pluralKey, t } from '@/i18n'

const RECENT_SESSIONS_LIMIT = 5

export const statusCommand: Command = createCommand({
  ...CLI_COMMAND_METADATA.status,
  async run(_args, app): Promise<number> {
    const locale = app.config.locale.language
    app.out(style.heading(t(locale, 'cli.statusTitle', { brand: BRAND.display })))
    const daemon = await liveDaemon(app)

    printDaemon(app, daemon, locale)
    app.out('')

    const degraded = daemon === null ? [] : await readDaemonDegraded(app, daemon.pid)

    await printChannels(app, locale, degraded)
    app.out('')
    printDegraded(app, degraded, locale)

    const sessions = await app.resolve('sessionStore').listRecent(RECENT_SESSIONS_LIMIT)
    printRecentSessions(app, sessions, locale)
    app.out('')

    await printSpend(app, locale)

    return 0
  },
})

function printDaemon(app: CliApp, daemon: RunningDaemon | null, locale: Locale): void {
  if (daemon === null) {
    app.out(warn(t(locale, 'cli.statusDaemonNotRunning')))
    return
  }

  const { pid, version } = daemon

  app.out(
    success(
      version === undefined
        ? t(locale, 'cli.statusDaemonRunningUnversioned', { pid })
        : t(locale, 'cli.statusDaemonRunning', { pid, version })
    )
  )

  if (version !== BRAND.version) {
    app.out(
      hint(
        t(locale, 'cli.statusDaemonVersionMismatch', {
          installed: BRAND.version,
          brand: BRAND.name,
        })
      )
    )
  }
}

// The configured channel list `/health` reports, with the ones the running daemon left down marked.
async function printChannels(
  app: CliApp,
  locale: Locale,
  degraded: readonly DegradedEntry[]
): Promise<void> {
  const { channels } = await app.resolve('healthSummary').read()

  app.out(style.heading(t(locale, 'cli.statusChannelsHeading', { count: channels.length })))

  if (channels.length === 0) {
    app.out(hint(t(locale, 'cli.statusNoChannelsPlaceholder')))
    return
  }

  const skipped = new Set(
    degraded.filter(({ kind }) => kind === 'channel').map(({ subject }) => subject)
  )
  const pairings = app.resolve('pairingStore')
  const now = Date.now()
  const pending = await Promise.all(
    channels.map((entry) => pairings.listPending(entry.channel, now))
  )

  for (const [index, entry] of channels.entries()) {
    const count = pending[index]?.length ?? 0
    const state = skipped.has(entry.channel)
      ? warn(t(locale, 'cli.statusChannelSkipped'))
      : t(locale, pluralKey(count, 'cli.statusChannelPendingOne', 'cli.statusChannelPending'), {
          count,
        })

    app.out(`  ${entry.channel}  ${state}`)
  }
}

// Silent when nothing is left down, so a healthy daemon prints what it always did.
function printDegraded(app: CliApp, degraded: readonly DegradedEntry[], locale: Locale): void {
  const needed = degraded.filter(({ kind }) => kind !== 'optional-key')
  const optional = degraded.filter(({ kind }) => kind === 'optional-key')

  if (needed.length > 0) {
    app.out(style.heading(t(locale, 'cli.statusDegradedHeading', { count: needed.length })))

    for (const entry of needed) {
      app.out(`  ${warn(entry.message)}`)
    }

    app.out('')
  }

  if (optional.length > 0) {
    app.out(style.heading(t(locale, 'cli.statusOptionalHeading', { count: optional.length })))

    for (const entry of optional) {
      app.out(`  ${hint(entry.message)}`)
    }

    app.out('')
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
