import type { CliApp, Writer } from '@/cli/types'
import type { HaltCode } from '@/core/errors'
import type { Locale } from '@/core/types/locale'
import type { RunResultReason } from '@/core/types/run'
import { haltDetailOf } from '@/ai/api'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'
import { fail, hint, style } from '@/cli/ui/colors'
import { BRAND } from '@/core/brand'
import {
  ChannelError,
  ConfigError,
  ConflictError,
  failureSpecOf,
  HALT_SPEC,
  LLMError,
  operatorMessageOf,
  RunHalted,
  StorageError,
  ToolError,
  ValidationError,
} from '@/core/errors'
import { failureHintParams } from '@/core/limits'
import { formatErrForLog, scrubCredentials } from '@/core/security/credentials'
import { bindLocale, t } from '@/i18n'

const EXIT_FAILURE = 1
const EXIT_USAGE = 2
const EXIT_STORAGE = 11
const EXIT_TIMEOUT = 12
const EXIT_CHANNEL = 13
const EXIT_TOOL = 14
/** 128 + SIGTERM: a command asked to terminate while nothing in it listened. */
export const EXIT_TERMINATED = 143
/** The daemon went away while a forwarded command ran in it; the command was not run again here. */
const EXIT_DAEMON_LOST = 17
/** A write refused because another edit landed first; 15 is the `loop` halt. */
const EXIT_CONFLICT = 18
const TERMINAL_CAUSE_LIMIT = 4
const TERMINAL_TEXT_LIMIT = 32_000

const REASON_EXIT = {
  completed: 0,
  aborted: HALT_SPEC.abort.exitCode,
  budget: HALT_SPEC.budget.exitCode,
  turn_limit: HALT_SPEC.turn_limit.exitCode,
  loop: HALT_SPEC.loop.exitCode,
  timeout: EXIT_TIMEOUT,
  error: EXIT_FAILURE,
} as const satisfies Record<RunResultReason, number>

interface ErrorOutput {
  readonly write: Writer
  readonly verbose: boolean
  readonly locale?: Locale
}

/** The reason's code, except a paused agent, which has its own so a script can tell "switched off"
 *  from an ordinary failure. */
export function exitCodeForResult(result: {
  readonly reason: RunResultReason
  readonly haltCode?: HaltCode
}): number {
  return result.haltCode === 'agent_paused'
    ? HALT_SPEC.agent_paused.exitCode
    : REASON_EXIT[result.reason]
}

export function terminalErrorMessage(error: unknown, locale: Locale = 'en'): string {
  if (!(error instanceof Error)) {
    return t(locale, 'cli.errorsUnexpected')
  }

  // The operator's own sentence wins, as it does in `describe`: `message` is a lowercase clause
  // written for a log line and other text to wrap, and it is only ever in English.
  const operator = operatorText(error, locale)

  if (operator !== undefined) {
    return operator
  }

  return error instanceof ConfigError
    ? t(locale, 'cli.errorsSetupInternal')
    : formatErrForLog(error).message || t(locale, 'cli.errorsUnexpected')
}

export function printError(err: unknown, options: ErrorOutput): number {
  const locale = options.locale ?? 'en'

  if (err instanceof RunHalted) {
    return printHalt(err, options, locale)
  }

  const { code } = describe(err, locale)
  const lines = formatTerminalError(err, { verbose: options.verbose, locale })
  options.write(fail(lines[0] ?? t(locale, 'cli.errorsUnexpected')))

  if (options.verbose) {
    for (const line of lines.slice(1)) {
      options.write(style.muted(line))
    }
  } else if (operatorMessageOf(err) === undefined) {
    options.write(hint(failureHintOf(err, locale) ?? t(locale, 'cli.errorsVerboseHint')))
  }

  return code
}

/** The fix for a provider failure the operator can act on, in place of the --verbose pointer. */
function failureHintOf(err: unknown, locale: Locale): string | undefined {
  const spec = err instanceof LLMError ? providerFailureSpecOf(err) : undefined

  return spec === undefined || !('hintKey' in spec)
    ? undefined
    : t(locale, spec.hintKey, failureHintParams(BRAND.name))
}

export function formatTerminalError(
  err: unknown,
  options: { readonly verbose: boolean; readonly locale?: Locale }
): readonly string[] {
  const lines = [scrubTerminalText(describe(err, options.locale).text)]

  if (!options.verbose) {
    return lines
  }

  if (err instanceof Error && err.stack !== undefined) {
    lines.push(scrubTerminalText(err.stack))
  }

  appendCauses(lines, err)
  return lines
}

function printHalt(err: RunHalted, options: ErrorOutput, locale: Locale): number {
  const spec = HALT_SPEC[err.code]
  // The ceiling that refused a budget halt words its own text; the code still owns emoji and exit.
  const text =
    failureSpecOf({
      haltCode: err.code,
      ...(err.detail === undefined ? {} : { haltDetail: err.detail }),
    }) ?? spec

  options.write(`${spec.emoji} ${t(locale, text.messageKey, { brand: BRAND.name })}`)

  if ('hintKey' in text) {
    options.write(hint(t(locale, text.hintKey, failureHintParams(BRAND.name))))
  }

  return spec.exitCode
}

function describe(
  err: unknown,
  locale: Locale = 'en'
): { readonly text: string; readonly code: number } {
  // A config failure with no operator wording is an internal one: its English diagnostic is for
  // --verbose, where the stack prints it.
  if (err instanceof ConfigError) {
    return {
      text: operatorText(err, locale) ?? t(locale, 'cli.errorsSetupInternal'),
      code: EXIT_USAGE,
    }
  }

  if (err instanceof ValidationError) {
    return { text: operatorText(err, locale) ?? err.message, code: EXIT_USAGE }
  }

  // The expected outcome of an optimistically-concurrent write, not a crash: the message carries
  // the version the operator needs to retry with, so hiding it behind --verbose strands them.
  if (err instanceof ConflictError) {
    return { text: err.message, code: EXIT_CONFLICT }
  }

  if (err instanceof StorageError) {
    return { text: err.message, code: EXIT_STORAGE }
  }

  if (err instanceof ChannelError) {
    return { text: err.message, code: EXIT_CHANNEL }
  }

  if (err instanceof ToolError) {
    return { text: operatorText(err, locale) ?? err.message, code: EXIT_TOOL }
  }

  // A provider's refusal the operator can act on reads in their language; any other keeps the
  // diagnostic, the only clue to what failed.
  if (err instanceof LLMError) {
    const spec = providerFailureSpecOf(err)
    const text =
      spec === undefined ? err.message : t(locale, spec.messageKey, { brand: BRAND.name })

    return { text, code: HALT_SPEC.llm_error.exitCode }
  }

  if (err instanceof Error) {
    return { text: t(locale, 'cli.errorsUnexpected'), code: EXIT_FAILURE }
  }

  return { text: safeUnknownText(err, locale), code: EXIT_FAILURE }
}

export function providerFailureSpecOf(err: LLMError): ReturnType<typeof failureSpecOf> {
  const haltDetail = haltDetailOf(err)

  return haltDetail === undefined ? undefined : failureSpecOf({ haltDetail })
}

/** The line an error was written for the operator to read, in their language. Absent means the
 *  message is a diagnostic and the caller falls back to it, which on a terminal is still better
 *  than a generic line. */
function operatorText(err: unknown, locale: Locale): string | undefined {
  const operator = operatorMessageOf(err)

  return operator === undefined
    ? undefined
    : bindLocale(locale).translate(operator.key, operator.params)
}

function appendCauses(lines: string[], err: unknown): void {
  let current = errorCause(err)

  for (let depth = 0; current !== undefined && depth < TERMINAL_CAUSE_LIMIT; depth += 1) {
    if (current instanceof Error) {
      lines.push(`Caused by: ${scrubTerminalText(current.message)}`)

      if (current.stack !== undefined) {
        lines.push(scrubTerminalText(current.stack))
      }
    } else {
      lines.push(`Caused by: ${scrubTerminalText(safeUnknownText(current))}`)
    }

    current = errorCause(current)
  }
}

function errorCause(err: unknown): unknown {
  if (!(err instanceof Error && 'cause' in err)) {
    return undefined
  }

  return err.cause
}

function safeUnknownText(_value: unknown, locale: Locale = 'en'): string {
  return t(locale, 'cli.errorsUnexpectedRejection')
}

function scrubTerminalText(text: string): string {
  return scrubCredentials(text).slice(0, TERMINAL_TEXT_LIMIT)
}

/** The command may have run, in part or in full, so the line says what to check before a rerun. */
export function printDaemonLost(
  app: Pick<CliApp, 'err' | 'config'>,
  path: readonly string[]
): number {
  const locale = app.config.locale.language
  const command = [BRAND.name, ...path].join(' ')

  app.err(fail(t(locale, 'cli.execDaemonLost', { command })))
  app.err(
    hint(
      path[0] === CLI_COMMAND_METADATA.chat.name
        ? t(locale, 'cli.execDaemonLostChat', { brand: BRAND.name })
        : t(locale, 'cli.execDaemonLostCheck')
    )
  )

  return EXIT_DAEMON_LOST
}

// A usage error is the operator's typo, not a crash: it prints the correction and exits 2.
export function usage(app: { readonly err: Writer }, text: string): number {
  app.err(fail(text))

  return EXIT_USAGE
}
