import type { CliApp } from '@/cli/types'
import type { DegradedEntry, DegradedItem } from '@/core/container'
import { hint, warn } from '@/cli/ui/colors'
import { BRAND } from '@/core/brand'
import { isPlainRecord } from '@/core/utils/collections'
import { bindLocale, t } from '@/i18n'

/** What this daemon will run with, so a background start says more than its pid. */
export function printDaemonSummary(app: CliApp, degraded: readonly DegradedEntry[]): void {
  printModel(app)
  printServed(app, degraded)
  printLogFile(app)
}

/** A foreground start prints this before boot; the channels and API follow at ready. */
export function printStartSetup(app: CliApp): void {
  printModel(app)
  printLogFile(app)
}

/** A channel or the API the daemon reported down is left out: its own warning says so. */
export function printServed(app: CliApp, degraded: readonly DegradedEntry[]): void {
  const { config } = app
  const locale = config.locale.language
  const configured = configuredChannels(app)
  const down = new Set(
    degraded.filter((entry) => entry.kind === 'channel').map((entry) => entry.subject)
  )
  const listed =
    configured.length === 0
      ? t(locale, 'cli.daemonNoChannels', { brand: BRAND.name })
      : configured.filter((channel) => !down.has(channel)).join(', ')

  if (listed !== '') {
    app.out(hint(t(locale, 'cli.daemonChannels', { channels: listed })))
  }

  if (config.api.enabled && !degraded.some((entry) => entry.kind === 'api')) {
    app.out(hint(t(locale, 'cli.daemonApi', { port: config.api.port })))
  }
}

function printModel(app: CliApp): void {
  const [model] = app.config.models

  if (model !== undefined) {
    app.out(hint(t(app.config.locale.language, 'cli.daemonModel', { model: model.selector })))
  }
}

function printLogFile(app: CliApp): void {
  const { config } = app

  app.out(
    hint(
      t(config.locale.language, 'cli.daemonLogFile', { path: config.log.file, brand: BRAND.name })
    )
  )
}

/** The daemon starts without these keys; each line says which feature waits for it. */
export function reportMissingKeys(app: CliApp, keyless: readonly DegradedItem[]): void {
  for (const item of keyless.filter((entry) => entry.kind === 'key')) {
    app.err(warn(renderDegraded(app, item).message))
  }
}

export function renderDegraded(app: CliApp, item: DegradedItem): DegradedEntry {
  const { key, params } = item.message

  return {
    kind: item.kind,
    subject: item.subject,
    message: bindLocale(app.config.locale.language).translate(key, params),
  }
}

export function configuredChannels(app: CliApp): readonly string[] {
  return Object.entries(app.config.channels)
    .filter(([, channel]) => !isPlainRecord(channel) || channel.enabled !== false)
    .map(([id]) => id)
}
