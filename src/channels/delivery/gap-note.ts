import type { SessionId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { SessionActivity } from '@/core/types/session'
import { formatErrForLog } from '@/core/security/credentials'
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from '@/core/utils/time'
import { pluralKey, t } from '@/i18n'

// Minutes under an hour, hours under two days, days beyond.
const HOURS_AFTER_MS = MS_PER_HOUR
const DAYS_AFTER_MS = 2 * MS_PER_DAY

interface GapNoteInput {
  readonly sessionId: SessionId
  readonly sessions: SessionActivity
  readonly gapNoteMs: number
  readonly locale: Locale
  readonly logger: Logger
}

/** Measured from the newest transcript row, not the session's activity stamp, which a slash command
 *  moves without telling the model. A failed read skips the note rather than failing the turn. */
export async function resolveGapNote(input: GapNoteInput): Promise<string | undefined> {
  const { gapNoteMs, locale } = input

  if (gapNoteMs === 0) {
    return undefined
  }

  const lastAt = await readLastMessageAt(input)

  if (lastAt === null) {
    return undefined
  }

  const gapMs = Date.now() - lastAt

  if (gapMs < gapNoteMs) {
    return undefined
  }

  return t(locale, 'channel.gapNote.lead', { elapsed: formatElapsed(locale, gapMs) })
}

async function readLastMessageAt(input: GapNoteInput): Promise<number | null> {
  try {
    return await input.sessions.lastMessageAt(input.sessionId)
  } catch (err: unknown) {
    input.logger.warn('channel.gap_note_lookup_failed', { err: formatErrForLog(err) })

    return null
  }
}

function formatElapsed(locale: Locale, gapMs: number): string {
  if (gapMs < HOURS_AFTER_MS) {
    const count = Math.floor(gapMs / MS_PER_MINUTE)

    return t(locale, pluralKey(count, 'channel.gapNote.minutesOne', 'channel.gapNote.minutes'), {
      count,
    })
  }

  if (gapMs < DAYS_AFTER_MS) {
    const count = Math.floor(gapMs / MS_PER_HOUR)

    return t(locale, pluralKey(count, 'channel.gapNote.hoursOne', 'channel.gapNote.hours'), {
      count,
    })
  }

  const count = Math.floor(gapMs / MS_PER_DAY)

  return t(locale, pluralKey(count, 'channel.gapNote.daysOne', 'channel.gapNote.days'), { count })
}
