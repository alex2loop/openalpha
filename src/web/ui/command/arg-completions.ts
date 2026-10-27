import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

import type { CommandCompletion } from '@/app/server/wire/system'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { commands } from '@/web/state/estimates'

const COMPLETION_DEBOUNCE_MS = 120
// The completers read what the daemon holds now (agents, schedules), so an answer is not kept long.
const COMPLETION_TTL_MS = 30_000
const MAX_CACHED_POSITIONS = 50
const MAX_USAGE_LINES = 5
const COMMAND_PREFIX = '/'
const WORD_BREAK = /\s+/
const PARAGRAPH_BREAK = '\n\n'

interface ArgCompletions {
  /** What the position being typed accepts and starts with the partial token. */
  readonly candidates: readonly string[]
  /** The command's syntax lines, narrowed to the sub-command being typed. */
  readonly usage: readonly string[]
}

interface Position {
  /** The line up to the token being typed, which is what the daemon completes from. */
  readonly context: string
  readonly partial: string
}

interface Answer {
  readonly context: string
  readonly completion: CommandCompletion
}

interface CachedCompletion {
  readonly at: number
  readonly completion: CommandCompletion
}

const NOTHING: ArgCompletions = Object.freeze({ candidates: [], usage: [] })
// One entry per command and position, for the session.
const cache = new Map<string, CachedCompletion>()

/** What the daemon's completer offers for the word being typed after a command name. It waits out
 *  the typing, asks once per position (the daemon returns every candidate there and the page
 *  narrows them), and aborts a request in flight when the position changes or the box goes. */
export function useArgCompletions(text: string): ArgCompletions {
  const position = readPosition(text)
  const context =
    position !== undefined && isKnownCommand(position.context) ? position.context : undefined
  const answer = useSignal<Answer | undefined>(undefined)

  useEffect(() => {
    if (context === undefined) {
      return undefined
    }

    const cached = readCache(context)

    if (cached !== undefined) {
      answer.value = { context, completion: cached }

      return undefined
    }

    const controller = new AbortController()
    const timer = setTimeout(() => {
      getJson(ROUTES.commandComplete, {
        query: { line: context },
        signal: controller.signal,
      }).then(
        (completion) => {
          writeCache(context, completion)
          answer.value = { context, completion }
        },
        // A failed read shows no arguments, and an abort is this effect's own; the box still sends.
        () => undefined
      )
    }, COMPLETION_DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [context])

  const current = answer.value

  if (position === undefined || current === undefined || current.context !== context) {
    return NOTHING
  }

  return narrow(current.completion, position.partial, text)
}

function narrow(completion: CommandCompletion, partial: string, text: string): ArgCompletions {
  const typed = partial.toLowerCase()

  return {
    candidates: completion.candidates.filter((candidate) =>
      candidate.toLowerCase().startsWith(typed)
    ),
    usage: completion.usage === undefined ? [] : readSyntaxLines(completion.usage, text),
  }
}

// After a command name and a space; null for a line still on its first word or not a command.
function readPosition(text: string): Position | undefined {
  const words = text.trimStart().split(WORD_BREAK)
  const partial = words.pop() ?? ''

  return words[0]?.startsWith(COMMAND_PREFIX) === true
    ? { context: `${words.join(' ')} `, partial }
    : undefined
}

function isKnownCommand(context: string): boolean {
  const name = context.trim().split(WORD_BREAK, 1)[0]?.toLowerCase()

  return commands.value.some((command) => command.name === name)
}

// The usage's first paragraph is its syntax lines, under a heading; the rest is examples and notes.
function readSyntaxLines(usage: string, text: string): readonly string[] {
  const lines = (usage.split(PARAGRAPH_BREAK)[0] ?? '')
    .split('\n')
    .filter((line) => line.startsWith(COMMAND_PREFIX))
  const sub = text.trim().split(WORD_BREAK)[1]?.toLowerCase() ?? ''
  const narrowed = lines.filter((line) => line.split(' ')[1]?.toLowerCase().startsWith(sub))

  return (sub !== '' && narrowed.length > 0 ? narrowed : lines).slice(0, MAX_USAGE_LINES)
}

function readCache(context: string): CommandCompletion | undefined {
  const hit = cache.get(context)

  if (hit === undefined || Date.now() - hit.at > COMPLETION_TTL_MS) {
    cache.delete(context)

    return undefined
  }

  return hit.completion
}

function writeCache(context: string, completion: CommandCompletion): void {
  cache.delete(context)
  cache.set(context, { at: Date.now(), completion })

  if (cache.size > MAX_CACHED_POSITIONS) {
    const oldest = cache.keys().next().value

    if (oldest !== undefined) {
      cache.delete(oldest)
    }
  }
}
