import type { MarketRef, TradingDay } from '@/trading/kernel/instrument'
import type { BriefSectionResult, BriefSectionRow } from '@/trading/kernel/operator/brief-section'
import type {
  SettledLevels,
  StoryCode,
  StoryWatch,
  ThesisStatus,
  WatchMark,
} from '@/trading/kernel/operator/brief-story'
import type { TradingCalendar } from '@/trading/markets/types'
import { tradingDay } from '@/trading/kernel/instrument'
import {
  STORY_CODES,
  THESIS_STATUSES,
  WATCH_EFFECTS,
  WATCH_FIELDS,
  WATCH_MARKS,
  WATCH_SECTIONS,
  WATCH_SHAPES,
} from '@/trading/kernel/operator/brief-story'

const ABOVE_SUFFIX = '-above'
/** A row naming one side of a list (a name the desks bought or sold) is never a section's total. */
const LIST_SIDE_FIELD = 'direction'

type TrackedWatch = StoryWatch & { readonly mark?: WatchMark; readonly value?: number }

/** A story still being watched, read back from the previous snapshot. */
export interface TrackedStory {
  readonly code: StoryCode
  /** The session the story was told for. */
  readonly toldIn: TradingDay
  readonly sector?: string
  readonly watches: readonly TrackedWatch[]
  readonly status: ThesisStatus
}

interface ScoreInput {
  readonly market: MarketRef
  readonly session: TradingDay
  readonly sections: readonly BriefSectionResult[]
  readonly calendar: TradingCalendar
  /** The level distances from the settled close; absent when the session placed no range. */
  readonly levels?: SettledLevels
}

type ReadySection = Extract<BriefSectionResult, { readonly status: 'ready' }>

/** What yesterday's brief left open: the story it told, with no marks yet, and every earlier story
 *  it was still tracking, with the marks so far. A section that does not parse is skipped: it came
 *  from a render version this build no longer speaks, and those are filtered out upstream. */
export function trackedStories(previous: readonly BriefSectionResult[]): readonly TrackedStory[] {
  return previous.flatMap(readTracked).filter((story) => story.watches.length > 0)
}

function readTracked(section: BriefSectionResult): readonly TrackedStory[] {
  if (section.status !== 'ready') {
    return []
  }

  if (section.kind === 'story') {
    return toldStory(section)
  }

  return section.kind === 'thesis-review' ? carriedStory(section) : []
}

/** Scores one story against today's sections. A story is never scored against the session it was
 *  told for, and a watch met once stays met. An absent read is `unobserved`, never a miss. */
export function scoreStory(story: TrackedStory, input: ScoreInput): TrackedStory {
  if (story.toldIn >= input.session) {
    return story
  }

  const watches = story.watches.map((watch) => scoreWatch(watch, input))

  return { ...story, watches, status: statusOf(story, watches, input) }
}

function toldStory(section: ReadySection): readonly TrackedStory[] {
  const [head, ...rest] = section.rows
  const code = memberOf(STORY_CODES, head?.story)

  if (code === undefined || section.asOf === undefined) {
    return []
  }

  return [
    {
      code,
      toldIn: section.asOf,
      ...sectorOf(head),
      watches: rest.flatMap(watchOf),
      status: 'open',
    },
  ]
}

function carriedStory(section: ReadySection): readonly TrackedStory[] {
  const [head, ...rest] = section.rows
  const code = memberOf(STORY_CODES, head?.story)
  const status = memberOf(THESIS_STATUSES, head?.thesisStatus)

  if (code === undefined || status !== 'open' || typeof head?.at !== 'string') {
    return []
  }

  return [
    {
      code,
      toldIn: tradingDay(head.at),
      ...sectorOf(head),
      watches: rest.flatMap(watchOf),
      status,
    },
  ]
}

function sectorOf(row: BriefSectionRow | undefined): { readonly sector?: string } {
  return typeof row?.sector === 'string' ? { sector: row.sector } : {}
}

/** A watch row is a row with a `watch` field; any other row is a fact or a run length. */
function watchOf(row: BriefSectionRow): readonly TrackedWatch[] {
  const shape = memberOf(WATCH_SHAPES, row.watch)
  const effect = memberOf(WATCH_EFFECTS, row.effect)

  if (
    shape === undefined ||
    effect === undefined ||
    typeof row.threshold !== 'number' ||
    typeof row.sessions !== 'number'
  ) {
    return []
  }

  const mark = memberOf(WATCH_MARKS, row.mark)

  return [
    {
      shape,
      ...scopeOf(row),
      threshold: row.threshold,
      horizonSessions: row.sessions,
      effect,
      ...(mark === undefined ? {} : { mark }),
    },
  ]
}

function scopeOf(row: BriefSectionRow): Pick<StoryWatch, 'row'> {
  if (typeof row.sector === 'string') {
    return { row: { field: 'sector', value: row.sector } }
  }

  return typeof row.ticker === 'string' ? { row: { field: 'ticker', value: row.ticker } } : {}
}

function scoreWatch(watch: TrackedWatch, input: ScoreInput): TrackedWatch {
  const value = readWatch(watch, input)
  const held = watch.mark === 'met'
  const base: StoryWatch = {
    shape: watch.shape,
    ...(watch.row === undefined ? {} : { row: watch.row }),
    threshold: watch.threshold,
    horizonSessions: watch.horizonSessions,
    effect: watch.effect,
  }

  if (value === undefined) {
    return { ...base, mark: held ? 'met' : 'unobserved' }
  }

  return { ...base, value, mark: held || isOnSide(watch, value) ? 'met' : 'unmet' }
}

function isOnSide(watch: StoryWatch, value: number): boolean {
  return watch.shape.endsWith(ABOVE_SUFFIX) ? value >= watch.threshold : value <= watch.threshold
}

function statusOf(
  story: TrackedStory,
  watches: readonly TrackedWatch[],
  input: ScoreInput
): ThesisStatus {
  const met = (watch: TrackedWatch): boolean => watch.mark === 'met'
  const confirms = watches.filter((watch) => watch.effect === 'confirms')

  if (watches.some((watch) => watch.effect === 'refutes' && met(watch))) {
    return 'refuted'
  }

  if (confirms.length > 0 && confirms.every(met)) {
    return 'confirmed'
  }

  const horizon = Math.max(...watches.map((watch) => watch.horizonSessions))

  return input.calendar.addTradingDays(story.toldIn, horizon) <= input.session ? 'expired' : 'open'
}

/** Today's value of a watch: the first ready section of its kind for this market that carries the
 *  shape's field, in the named row when the watch names one. A level distance comes from the
 *  settled close instead, so a brief read mid-session never marks a level on a live price. */
function readWatch(watch: StoryWatch, input: ScoreInput): number | undefined {
  const field = WATCH_FIELDS[watch.shape]

  if (field === 'supportPct' || field === 'resistancePct') {
    return input.levels?.[field]
  }

  const [section] = input.sections.flatMap((candidate) =>
    candidate.kind === WATCH_SECTIONS[watch.shape] &&
    candidate.market === input.market &&
    candidate.status === 'ready'
      ? [candidate]
      : []
  )

  return section === undefined ? undefined : valueIn(section.rows, watch)
}

function valueIn(rows: readonly BriefSectionRow[], watch: StoryWatch): number | undefined {
  const field = WATCH_FIELDS[watch.shape]

  for (const row of rows) {
    const skipped =
      watch.row === undefined
        ? row[LIST_SIDE_FIELD] !== undefined
        : row[watch.row.field] !== watch.row.value

    if (skipped) {
      continue
    }

    const value = row[field]

    if (typeof value === 'number') {
      return value
    }
  }

  return undefined
}

/** Narrows a stored string to its closed tuple without an assertion. */
function memberOf<T extends string>(members: readonly T[], value: unknown): T | undefined {
  return members.find((member) => member === value)
}
