import type { SessionId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { SessionActivity } from '@/core/types/session'
import { formatErrForLog } from '@/core/security/credentials'
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from '@/core/utils/time'
import { pluralKey, t } from '@/i18n'

// How the operator would say it: whole minutes under an hour, whole hours under two days, whole
// days beyond.
const HOURS_FROM_MS = MS_PER_HOUR
const DAYS_FROM_MS = 2 * MS_PER_DAY

interface GapNoteInput {
  readonly text: string
  readonly sessionId: SessionId
  readonly sessions: SessionActivity
  /** Zero turns the note off. */
  readonly gapNoteMs: number
  readonly locale: Locale
  readonly logger: Logger
}

/** The run's message, led by how long the chat sat quiet when that is long enough for the prices
 *  quoted earlier to have gone stale. Measured from the newest transcript row, not the session's
 *  activity stamp, which a slash command moves without saying anything to the model. A failed read
 *  skips the note: it must never fail the turn. */
export async function withGapNote(input: GapNoteInput): Promise<string> {
  const { text, gapNoteMs, locale } = input

  if (gapNoteMs === 0) {
    return text
  }

  const lastAt = await readLastMessageAt(input)

  if (lastAt === null) {
    return text
  }

  const gapMs = Date.now() - lastAt

  if (gapMs < gapNoteMs) {
    return text
  }

  const lead = t(locale, 'channel.gapNote.lead', { elapsed: formatElapsed(locale, gapMs) })

  return `${lead}\n\n${text}`
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
  if (gapMs < HOURS_FROM_MS) {
    const count = Math.floor(gapMs / MS_PER_MINUTE)

    return t(locale, pluralKey(count, 'channel.gapNote.minutesOne', 'channel.gapNote.minutes'), {
      count,
    })
  }

  if (gapMs < DAYS_FROM_MS) {
    const count = Math.floor(gapMs / MS_PER_HOUR)

    return t(locale, pluralKey(count, 'channel.gapNote.hoursOne', 'channel.gapNote.hours'), {
      count,
    })
  }

  const count = Math.floor(gapMs / MS_PER_DAY)

  return t(locale, pluralKey(count, 'channel.gapNote.daysOne', 'channel.gapNote.days'), { count })
}
