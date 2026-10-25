import { computed, effect, type ReadonlySignal, signal } from '@preact/signals'

import type { DigestWire } from '@/app/server/wire/digest'
import type { BoardEntryWire, NoticeWire } from '@/app/server/wire/notices'
import type { SuggestionWire } from '@/app/server/wire/trading'
import { getJson } from '@/web/api/client'
import { startPoll } from '@/web/api/poll'
import { ROUTES } from '@/web/api/routes'
import { createSingleFlight } from '@/web/api/single-flight'
import { pageMinute, sceneZone } from '@/web/scene/clock/clock'
import { homeMarket } from '@/web/scene/data/home'
import { zoneParts } from '@/web/state/clock'
import { onWireEvent } from '@/web/state/events'
import { notices } from '@/web/state/notices'
import { state } from '@/web/state/session'
import { buildDayKey } from '@/web/text/time'

/** A command that lands, and every minute, the boards read again. */
const BOARD_POLL_MS = 60_000
/** Held-news headlines the library board pins at most. */
const MAX_PINS = 5
// The newest calls the results board reads; a day's calls fit well inside it.
const SUGGESTIONS_LIMIT = 30
const HELD_NEWS_KIND = 'held-news'
const INDEX_DROP_KIND = 'index-drop'
const MS_PER_DAY = 86_400_000
// The phases a session's index move happens in.
const IN_SESSION_PHASES: ReadonlySet<string> = new Set(['open', 'break'])

interface DigestPair {
  readonly today?: DigestWire
  readonly yesterday?: DigestWire
}

/** The lobby's index-drop glow: the session move it came with, and the phase it was seen in. */
interface IndexDrop {
  readonly noticeId: string
  readonly movePct: number
  readonly phase: string
}

// The last answers of long-running commands, newest first; only their landing is shown yet.
const entries = signal<readonly BoardEntryWire[]>([])
const digests = signal<DigestPair>({})
const calls = signal<readonly SuggestionWire[] | undefined>(undefined)
const drop = signal<IndexDrop | undefined>(undefined)
const landed = signal(0)
let endedDropId: string | undefined

/** The day the lobby digest shows: today once it holds a call or a report, else yesterday. */
export const digest = computed(() => {
  const { today, yesterday } = digests.value

  if (today !== undefined && today.suggestions + today.reports > 0) {
    return { wire: today, isToday: true }
  }

  return yesterday === undefined ? undefined : { wire: yesterday, isToday: false }
})
/** The page clock's day's calls (it rolls over at the scene's midnight), newest first; absent until `/v1/suggestions` answers. */
export const todayCalls: ReadonlySignal<readonly SuggestionWire[] | undefined> = computed(() => {
  const day = pageMinute.value.day

  return calls.value?.filter((call) => call.at === day)
})
/** Held-news headlines pinned on the library board, newest first; a new day clears them. */
export const heldNewsPins: ReadonlySignal<readonly NoticeWire[]> = computed(() =>
  notices.value.filter((notice) => isTodaysNotice(notice, HELD_NEWS_KIND)).slice(0, MAX_PINS)
)
/** The newest index drop, until the home market's session phase moves on. */
export const indexDrop: ReadonlySignal<IndexDrop | undefined> = drop
/** Counts results landing on the board while the page is open: a new answer or a new call. */
export const resultsLanded: ReadonlySignal<number> = landed

/** Reads the boards now, when a run finishes or a call is stored, and every `BOARD_POLL_MS`; keeps
 *  the index-drop glow in step with the notices and the session. The returned stop is idempotent. */
export function startBoard(): () => void {
  const lifetime = new AbortController()
  const refetch = createSingleFlight(loadBoard, lifetime.signal)
  // `refetch` never rejects: `loadBoard` keeps the last good reads on a failure.
  const onChange = (): void => {
    refetch().catch(() => undefined)
  }
  const offs = [onWireEvent('run_finished', onChange), onWireEvent('idea', onChange)]
  const stopPoll = startPoll(() => refetch(), BOARD_POLL_MS)
  const stopDrop = effect(syncIndexDrop)

  return () => {
    lifetime.abort()
    stopPoll()
    stopDrop()

    for (const off of offs) {
      off()
    }
  }
}

async function loadBoard(abortSignal: AbortSignal): Promise<void> {
  const today = operatorDay(Date.now())
  const yesterday = operatorDay(Date.now() - MS_PER_DAY)
  const [board, todayDigest, yesterdayDigest, suggestions] = await Promise.allSettled([
    getJson(ROUTES.board, { signal: abortSignal }),
    getJson(ROUTES.digest, { query: { day: today }, signal: abortSignal }),
    getJson(ROUTES.digest, { query: { day: yesterday }, signal: abortSignal }),
    getJson(ROUTES.suggestions, {
      query: { status: 'all', limit: SUGGESTIONS_LIMIT },
      signal: abortSignal,
    }),
  ])

  if (board.status === 'fulfilled') {
    countLanded(entries.value[0]?.runId, board.value.entries[0]?.runId)
    entries.value = board.value.entries
  }

  if (suggestions.status === 'fulfilled') {
    countLanded(calls.value?.[0]?.id, suggestions.value.suggestions[0]?.id)
    calls.value = suggestions.value.suggestions
  }

  digests.value = {
    ...(todayDigest.status === 'fulfilled' ? { today: todayDigest.value } : {}),
    ...(yesterdayDigest.status === 'fulfilled' ? { yesterday: yesterdayDigest.value } : {}),
  }
}

// Only a change after the first read is a landing; the first read is what was already there.
function countLanded(held: string | undefined, next: string | undefined): void {
  if (held !== undefined && next !== undefined && held !== next) {
    landed.value++
  }
}

// An index drop happens in a session: a notice of today lights the lobby only while the home
// market's session is open, and the next known phase ends it. While the phase is unknown (before
// the first `/v1/markets` read) nothing is armed and nothing ends, so a morning notice opened after
// the close never glows out of its session.
function syncIndexDrop(): void {
  const phase = homeMarket.value?.session?.phase
  const held = drop.peek()

  if (phase === undefined) {
    return
  }

  if (held !== undefined) {
    if (phase !== held.phase) {
      endedDropId = held.noticeId
      drop.value = undefined
    }
    return
  }

  const newest = notices.value.find((notice) => isTodaysNotice(notice, INDEX_DROP_KIND))
  const movePct = newest?.event.movePct

  if (
    newest === undefined ||
    movePct === undefined ||
    newest.id === endedDropId ||
    !IN_SESSION_PHASES.has(phase)
  ) {
    return
  }

  drop.value = { noticeId: newest.id, movePct, phase }
}

// A notice of `kind` filed on the scene's day.
function isTodaysNotice(notice: NoticeWire, kind: string): boolean {
  return (
    notice.event.noticeKind === kind &&
    zoneParts(notice.createdAt, sceneZone.value).day === pageMinute.value.day
  )
}

function operatorDay(atMs: number): string {
  return buildDayKey(atMs, timeZoneOf())
}

function timeZoneOf(): string {
  return state.value?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
}
