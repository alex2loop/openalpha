import { createInterface } from 'node:readline/promises'

import type { CliApp, CompletionSource } from '@/cli/types'
import type { Locale } from '@/core/types/locale'
import { ask } from '@/cli/ui/colors'
import {
  completionToken,
  createGhostSuggestions,
  isInteractiveTerminal,
} from '@/cli/ui/ghost-prompt'
import { t } from '@/i18n'

// Accepted "yes" words come from the locale (cli.promptAffirmative, comma-separated) so adding a
// language needs no code change here. The fallback covers any locale that omits the key.
const AFFIRMATIVE_FALLBACK = new Set(['y', 'yes'])

interface PromptOptions {
  readonly signal?: AbortSignal
  readonly suggestions?: boolean
  /** Free-input line rather than a real question: skip the '?' marker (the chat REPL input). */
  readonly bare?: true
}

export type PromptFn = (question: string, options?: PromptOptions) => Promise<string>

interface MultiPrompt {
  readonly prompt: PromptFn
  close(): void
  lineOutput(write: () => void): void
  rawOutput(chunk: string, write: () => void): void
}

interface MultiPromptOptions {
  readonly completion?: CompletionSource
  readonly onSigint?: () => void
  /** A line typed while no question is open. Readline drops it; this lets the caller say so. */
  readonly onUnasked?: (line: string) => void
}

export function declined(app: CliApp, locale: Locale = app.config.locale.language): number {
  app.out(t(locale, 'cli.promptCancelled'))
  return 1
}

export function defaultPrompt(): PromptFn {
  return async (question, options) => {
    const rl = createInterface(readlineOptions())

    try {
      // question() never settles at EOF (closed pipe, /dev/null), so race it: no answer is a no.
      const eof = new Promise<string>((resolve) => {
        rl.once('close', () => resolve(''))
      })
      const answer = await Promise.race([
        rl.question(toQuery(question, options), { signal: options?.signal }),
        eof,
      ])

      return answer.trim()
    } finally {
      rl.close()
    }
  }
}

export function multiPrompt(config: MultiPromptOptions = {}): MultiPrompt {
  const rl = createInterface(readlineOptions(config.completion))
  const suggestions = createGhostSuggestions(rl, config.completion)
  const lifetime = new AbortController()
  const onSigint = config.onSigint
  let closed = false

  if (onSigint !== undefined) {
    rl.on('SIGINT', onSigint)
  }

  if (config.onUnasked !== undefined) {
    rl.on('line', config.onUnasked)
  }

  rl.once('close', () => lifetime.abort())

  const close = (): void => {
    if (closed) {
      return
    }

    closed = true
    lifetime.abort()

    if (onSigint !== undefined) {
      rl.off('SIGINT', onSigint)
    }

    if (config.onUnasked !== undefined) {
      rl.off('line', config.onUnasked)
    }

    suggestions.close()
    rl.close()
  }

  return {
    prompt: createMultiPromptFn(rl, suggestions, lifetime.signal),
    close,
    lineOutput: (write) => suggestions.lineOutput(write),
    rawOutput: (chunk, write) => suggestions.rawOutput(chunk, write),
  }
}

function createMultiPromptFn(
  rl: ReturnType<typeof createInterface>,
  suggestions: ReturnType<typeof createGhostSuggestions>,
  lifetimeSignal: AbortSignal
): PromptFn {
  return async (question, options) => {
    const query = toQuery(question, options)
    const signal =
      options?.signal === undefined
        ? lifetimeSignal
        : AbortSignal.any([lifetimeSignal, options.signal])

    if (signal.aborted) {
      return Promise.reject(signal.reason)
    }

    if (options?.suggestions === true) {
      suggestions.beginSuggestedQuestion(query)
    } else {
      suggestions.beginPlainQuestion(query)
    }

    try {
      return (await rl.question(query, { signal })).trim()
    } finally {
      suggestions.finishQuestion()
    }
  }
}

export async function confirm(
  promptFn: PromptFn,
  message: string,
  locale: Locale
): Promise<boolean> {
  const answer = await promptFn(`${message} ${t(locale, 'cli.promptConfirmHint')}`)
  return isAffirmative(answer, locale)
}

/** For a step the operator came to take: Enter means yes. */
export async function confirmDefaultYes(
  promptFn: PromptFn,
  message: string,
  locale: Locale
): Promise<boolean> {
  const answer = await promptFn(`${message} ${t(locale, 'cli.promptConfirmHintYes')}`)
  return answer === '' || isAffirmative(answer, locale)
}

// Matches case-insensitively against the locale's affirmative words (cli.promptAffirmative,
// comma-separated). Locales with non-ASCII forms should list each accepted spelling — e.g.
// Vietnamese lists "co,có" so users typing without tone marks still confirm.
function isAffirmative(answer: string, locale: Locale): boolean {
  const accepted = t(locale, 'cli.promptAffirmative')
    .split(',')
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word.length > 0)
  const set = accepted.length > 0 ? new Set(accepted) : AFFIRMATIVE_FALLBACK

  return set.has(answer.trim().toLowerCase())
}

function toQuery(question: string, options?: PromptOptions): string {
  return options?.bare === true ? `${question} ` : ask(`${question} `)
}

function readlineOptions(completion?: CompletionSource): Parameters<typeof createInterface>[0] {
  return {
    input: process.stdin,
    output: process.stdout,
    terminal: isInteractiveTerminal(),
    ...(completion === undefined
      ? {}
      : {
          completer: (line: string): [string[], string] => [
            [...completion.complete(line)],
            completionToken(line),
          ],
        }),
  }
}
