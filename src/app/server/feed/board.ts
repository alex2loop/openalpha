import type { BoardEntryWire } from '@/app/server/wire/notices'
import type { SlashResult } from '@/core/types/command'
import type { Locale } from '@/core/types/locale'
import { renderMessages } from '@/commands/api'
import { scrubCredentials } from '@/core/security/credentials'
import { bindLocale } from '@/i18n'

export const BOARD_SIZE = 8
const BOARD_TEXT_MAX_CHARS = 4000
const TRUNCATION_MARK = '...'

export interface ResultBoard {
  add(entry: BoardEntryWire): void
  /** Newest first. */
  list(): readonly BoardEntryWire[]
}

/** The last `size` command answers, in memory: a restart empties it. */
export function createResultBoard(size: number): ResultBoard {
  let entries: readonly BoardEntryWire[] = []

  return {
    add(entry) {
      entries = [entry, ...entries].slice(0, size)
    },
    list: () => entries,
  }
}

/** The text a chat got for the result, or undefined when it has none to show: an agent result is
 *  answered by the agent's own run, and a handled one printed itself. */
export function toBoardText(result: SlashResult, locale: Locale): string | undefined {
  const text =
    result.kind === 'message' ? renderMessages(bindLocale(locale), result) : toPlain(result)

  if (text === undefined || text.trim() === '') {
    return undefined
  }

  const safe = scrubCredentials(text)

  return safe.length > BOARD_TEXT_MAX_CHARS
    ? `${safe.slice(0, BOARD_TEXT_MAX_CHARS - TRUNCATION_MARK.length)}${TRUNCATION_MARK}`
    : safe
}

function toPlain(result: SlashResult): string | undefined {
  return result.kind === 'text' ? result.text : undefined
}
