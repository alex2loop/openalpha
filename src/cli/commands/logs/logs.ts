import type { CliApp } from '@/cli/types'
import type { Locale } from '@/core/types/locale'
import { type Command, createCommand, createGroup, type Group } from '@/cli/command'
import { terminalErrorMessage, usage } from '@/cli/error-output'
import { renderLocalized } from '@/cli/help'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'
import { flagBool, flagString, parseIntFlagStrict } from '@/cli/parsing/args'
import { fail, style } from '@/cli/ui/colors'
import { BRAND } from '@/core/brand'
import { agentId } from '@/core/ids'
import { resolveAgentLogFile } from '@/core/logging/paths'
import { t } from '@/i18n'

import { logsClearCommand } from './clear'
import { followLog } from './follow'
import { MAX_TAIL_LINES, printLogTail } from './reader'

const DEFAULT_LINES = 50
const MAX_SINCE_TEXT_LENGTH = 64
const MAX_SINCE_DURATION_MS = 365 * 24 * 60 * 60 * 1000
const SINCE_DURATION = /^([1-9]\d*)(ms|s|m|h|d)$/
const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/

const DURATION_MULTIPLIERS: Readonly<Record<string, number>> = Object.freeze({
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
})

type SinceResult =
  | { readonly kind: 'value'; readonly value?: number }
  | { readonly kind: 'error'; readonly error: string }

const tailCommand: Command = createCommand({
  name: 'tail',
  summary: { key: 'cliHelp.logsShowSummary', params: { brand: BRAND.display } },
  spec: {
    flags: {
      lines: { type: 'string', describe: { key: 'cliHelp.flagLogsLines' } },
      follow: { type: 'boolean', alias: 'f', describe: { key: 'cliHelp.flagLogsFollow' } },
      agent: { type: 'string', describe: { key: 'cliHelp.flagLogsAgent' } },
      since: {
        type: 'string',
        describe: { key: 'cliHelp.flagLogsSince' },
      },
    },
  },
  needs: { boot: false, configFile: 'optional' },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language

    if (app.signal.aborted) {
      return 0
    }

    const options = resolveOptions(args, app, locale)

    if (options.kind === 'error') {
      return usage(app, options.error)
    }

    try {
      const cursor = await printLogTail({
        file: options.file,
        lines: options.lines,
        ...(options.since === undefined ? {} : { since: options.since }),
        output: app.out,
        signal: app.signal,
      })

      if (app.signal.aborted) {
        return 0
      }

      if (cursor === undefined && !options.follow) {
        app.out(t(locale, 'cli.logsNoSegmentsFound'))
        return 0
      }

      if (options.follow) {
        await followWithProcessSignals(app, {
          file: options.file,
          ...(cursor === undefined ? {} : { initial: cursor }),
          ...(options.since === undefined ? {} : { since: options.since }),
        })
      }

      return 0
    } catch (err: unknown) {
      app.err(fail(t(locale, 'cli.logsCannotRead', { path: options.file })))
      app.err(style.muted(terminalErrorMessage(err, locale)))
      return 1
    }
  },
})

async function followWithProcessSignals(
  app: CliApp,
  options: Parameters<typeof followLog>[1]
): Promise<void> {
  const controller = new AbortController()
  const onSignal = (): void => controller.abort()
  const signal = AbortSignal.any([app.signal, controller.signal])

  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  try {
    await followLog({ ...app, signal }, options)
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  }
}

function resolveOptions(
  args: Parameters<typeof flagString>[0],
  app: CliApp,
  locale: Locale
):
  | {
      readonly kind: 'value'
      readonly file: string
      readonly lines: number
      readonly follow: boolean
      readonly since?: number
    }
  | { readonly kind: 'error'; readonly error: string } {
  const file = resolveLogSelection(flagString(args, 'agent'), app, locale)

  if (file.kind === 'error') {
    return file
  }

  const lines = resolveLines(flagString(args, 'lines'), locale)

  if (lines.kind === 'error') {
    return lines
  }

  const since = parseSince(flagString(args, 'since'), Date.now(), locale)

  if (since.kind === 'error') {
    return since
  }

  return {
    kind: 'value',
    file: file.value,
    lines: lines.value,
    follow: flagBool(args, 'follow'),
    ...(since.value === undefined ? {} : { since: since.value }),
  }
}

function resolveLogSelection(
  rawAgent: string | undefined,
  app: CliApp,
  locale: Locale
):
  | { readonly kind: 'value'; readonly value: string }
  | { readonly kind: 'error'; readonly error: string } {
  if (rawAgent !== undefined) {
    try {
      return {
        kind: 'value',
        value: resolveAgentLogFile(app.config.paths.dataDir, agentId(rawAgent)),
      }
    } catch {
      return { kind: 'error', error: t(locale, 'cli.logsInvalidAgent') }
    }
  }

  return { kind: 'value', value: app.config.log.file }
}

function resolveLines(
  raw: string | undefined,
  locale: Locale
):
  | { readonly kind: 'value'; readonly value: number }
  | { readonly kind: 'error'; readonly error: string } {
  const parsed = parseIntFlagStrict(raw, '--lines')

  if (parsed.kind === 'error') {
    return { kind: 'error', error: renderLocalized(locale, parsed.error) }
  }

  const value = parsed.kind === 'value' ? parsed.value : DEFAULT_LINES

  return value > 0 && value <= MAX_TAIL_LINES
    ? { kind: 'value', value }
    : { kind: 'error', error: t(locale, 'cli.logsLinesRange', { max: MAX_TAIL_LINES }) }
}

function parseSince(raw: string | undefined, now: number, locale: Locale): SinceResult {
  if (raw === undefined) {
    return { kind: 'value' }
  }
  if (raw.length > MAX_SINCE_TEXT_LENGTH) {
    return { kind: 'error', error: t(locale, 'cli.logsSinceTooLong') }
  }

  const duration = SINCE_DURATION.exec(raw)

  if (duration?.[1] !== undefined && duration[2] !== undefined) {
    const multiplier = DURATION_MULTIPLIERS[duration[2]]
    const amount = Number(duration[1])
    const milliseconds = multiplier === undefined ? Number.NaN : amount * multiplier

    return Number.isSafeInteger(milliseconds) && milliseconds <= MAX_SINCE_DURATION_MS
      ? { kind: 'value', value: now - milliseconds }
      : { kind: 'error', error: t(locale, 'cli.logsSinceDurationExceeded') }
  }

  const iso = ISO_INSTANT.exec(raw)

  if (iso !== null && isValidCalendarInstant(iso)) {
    const instant = Date.parse(raw)

    if (Number.isFinite(instant)) {
      return { kind: 'value', value: instant }
    }
  }

  return { kind: 'error', error: t(locale, 'cli.logsSinceExpected') }
}

function isValidCalendarInstant(match: RegExpExecArray): boolean {
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6] ?? 0)

  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 59
  )
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    return leap ? 29 : 28
  }

  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31
}

export const logsCommand: Group = createGroup({
  ...CLI_COMMAND_METADATA.logs,
  subcommands: [tailCommand, logsClearCommand],
  default: 'tail',
})
