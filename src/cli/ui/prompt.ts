import type { Interface } from 'node:readline/promises'
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'

import type { Terminal, TerminalInput } from '@/cli/terminal'
import type { CliApp, CompletionSource } from '@/cli/types'
import type { Locale } from '@/core/types/locale'
import { currentTerminal } from '@/cli/terminal'
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
// Readline echoes what is typed to its output; a sink that drops every chunk keeps a secret off the
// screen while readline still handles editing, paste and multi-byte input.
const SILENT_OUTPUT = new Writable({
  write: (_chunk, _encoding, done) => {
    done()
  },
})

interface ReadlineOptions {
  readonly completion?: CompletionSource
  /** Echoes nothing, so what is typed at a terminal stays off the screen. */
  readonly silent?: true
}

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
  const terminal = currentTerminal()

  return async (question, options) => {
    const rl = openReadline(terminal)

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

/** One line typed hidden, trimmed. Cancel (Ctrl-C, the signal) rejects with the same abort the other
 *  prompts raise; with no terminal it reads one line from stdin. A prompt another readline holds
 *  open (the onboard wizard's) hears no keys meanwhile, or it would echo them. */
export async function promptSecret(question: string, signal?: AbortSignal): Promise<string> {
  const terminal = currentTerminal()
  const interactive = isInteractiveTerminal(terminal)
  const cancel = new AbortController()
  const restoreKeys = interactive ? suspendKeypressListeners(terminal.stdin) : undefined
  // Closing a readline pauses stdin; a prompt held open elsewhere needs it flowing again.
  const wasFlowing = terminal.stdin.readableFlowing === true
  // Closing a terminal readline also leaves raw mode, which the held-open prompt needs back.
  const wasRaw = terminal.stdin.isTTY && terminal.stdin.isRaw
  const rl = openReadline(terminal, { silent: true })

  rl.once('SIGINT', () => cancel.abort())

  try {
    if (interactive) {
      terminal.stdout.write(ask(`${question} `))
    }

    const eof = new Promise<string>((resolve) => {
      rl.once('close', () => resolve(''))
    })
    const answered = rl.question('', {
      signal: signal === undefined ? cancel.signal : AbortSignal.any([cancel.signal, signal]),
    })

    return (await Promise.race([answered, eof])).trim()
  } finally {
    rl.close()
    restoreKeys?.()

    if (wasRaw) {
      terminal.stdin.setRawMode(true)
    }

    if (wasFlowing) {
      terminal.stdin.resume()
    }

    if (interactive) {
      terminal.stdout.write('\n')
    }
  }
}

/** Detaches every keypress listener but returns the way back, so a second reader on the same
 *  stream is the only one that sees the keys. */
export function suspendKeypressListeners(input: TerminalInput): () => void {
  const held = input.rawListeners('keypress')

  for (const listener of held) {
    // why-safe: an emitter only ever stores functions in its listener list.
    input.off('keypress', listener as (...args: unknown[]) => void)
  }

  return () => {
    for (const listener of held) {
      input.on('keypress', listener as (...args: unknown[]) => void)
    }
  }
}

export function multiPrompt(config: MultiPromptOptions = {}): MultiPrompt {
  const terminal = currentTerminal()
  const rl = openReadline(terminal, config)
  const suggestions = createGhostSuggestions(terminal, rl, config.completion)
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
  rl: Interface,
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

// Every readline interface is made here, on the terminal it was asked for.
function openReadline(terminal: Terminal, options: ReadlineOptions = {}): Interface {
  const { completion } = options
  const interactive = isInteractiveTerminal(terminal)
  const rl = createInterface({
    input: terminal.stdin,
    output: toReadlineOutput(terminal, options),
    terminal: interactive,
    ...(completion === undefined
      ? {}
      : {
          completer: (line: string): [string[], string] => [
            [...completion.complete(line)],
            completionToken(line),
          ],
        }),
  })

  if (!terminal.suspendable) {
    // Readline's default for Ctrl-Z stops this whole process, and this terminal is not the process's.
    rl.on('SIGTSTP', () => undefined)
  }

  return rl
}

function toReadlineOutput(terminal: Terminal, options: ReadlineOptions): Writable | undefined {
  if (options.silent !== true) {
    return terminal.stdout
  }

  return isInteractiveTerminal(terminal) ? SILENT_OUTPUT : undefined
}
