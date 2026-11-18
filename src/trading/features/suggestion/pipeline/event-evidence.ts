import type { DebateInput } from '@/trading/features/suggestion/pipeline/types'
import type { MarketEvent, MarketEventKind } from '@/trading/kernel/market/market-event'
import { toSingleLine } from '@/core/utils/text'
import { MAXIMUM_SUMMARY_CHARS } from '@/trading/features/suggestion/pipeline/news-evidence'

/** What a kind means where its name alone misleads: an ex-date that moves no price reads as a reset
 *  worth waiting out, and a filed 8-K item reads as whatever its name suggests. The title carries
 *  only the item number, so the note is the only plain words a persona has. */
const EVENT_NOTES: Partial<Record<MarketEventKind, string>> = Object.freeze({
  'meeting-ex-date': 'no price adjustment: it carries only the right to attend the meeting',
  'bankruptcy-filing': 'the company or a subsidiary filed for bankruptcy or receivership',
  impairment: 'the company concluded an asset is materially impaired, a non-cash write-down',
  'listing-notice':
    'covers a missed listing rule or a voluntary transfer of listing to another exchange; the row does not say which, so it is no evidence of a deficiency',
  'auditor-change': 'the auditor was dismissed or resigned; the row does not state why',
  'non-reliance':
    'the company states its previously issued financial statements should no longer be relied on',
})

const EVENTS_UNAVAILABLE =
  'UPCOMING EVENTS: unavailable - the corporate calendar failed this run; never assume nothing is scheduled.'

type EventSubject = Pick<DebateInput, 'upcomingEvents' | 'recentEvents' | 'calendarFailed'>

/** The upcoming events, then the recently filed ones; each is empty when it has nothing to say. */
export function eventSections(subject: EventSubject): readonly string[] {
  return [upcomingSection(subject), recentSection(subject)]
}

/** Dated facts, not forecasts: a persona weighs when the tape resets, it does not guess the size of
 *  the dividend or the market's reaction to it. */
function upcomingSection(subject: EventSubject): string {
  const events = subject.upcomingEvents ?? []

  if (events.length === 0) {
    return subject.calendarFailed === true ? EVENTS_UNAVAILABLE : ''
  }

  return [
    'UPCOMING EVENTS (dated facts; weigh timing, do not invent outcomes):',
    ...events.map(eventRow),
  ].join('\n')
}

/** Already public: a persona may weigh that a release landed or an insider bought, and may not
 *  read an outcome into it that the row does not state. */
function recentSection(subject: EventSubject): string {
  const events = subject.recentEvents ?? []

  if (events.length === 0) {
    return ''
  }

  return [
    'RECENTLY FILED (dated facts already public; weigh them, do not invent what they mean):',
    ...events.map(eventRow),
  ].join('\n')
}

/** The provider's note is what tells an extraordinary meeting from the annual one. */
function eventRow(event: MarketEvent): string {
  const detail = event.detail?.slice(0, MAXIMUM_SUMMARY_CHARS)
  const notes = [detail, EVENT_NOTES[event.kind]].filter((note) => note !== undefined)
  const suffix = notes.length === 0 ? '' : ` (${notes.join('; ')})`

  // A provider line break would forge a line of the prompt.
  return toSingleLine(`- ${event.at} ${event.kind}: ${event.title}${suffix}`)
}
