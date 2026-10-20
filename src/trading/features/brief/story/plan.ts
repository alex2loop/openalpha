import type { TrackedStory } from '@/trading/features/brief/story/review'
import type { MarketRef } from '@/trading/kernel/instrument'
import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { StoryCandidate, StoryRead } from '@/trading/kernel/operator/brief-story'
import type { TradingCalendar } from '@/trading/markets/types'
import { scoreStory, trackedStories } from '@/trading/features/brief/story/review'
import {
  buildReviewSection,
  buildStorySection,
  runKeyOf,
  type SectionStamp,
} from '@/trading/features/brief/story/sections'
import { FIRST_RUN_SESSION, STORY_CODES } from '@/trading/kernel/operator/brief-story'

type ReadStory = Extract<StoryRead, { readonly kind: 'read' }>
type ReadySection = Extract<BriefSectionResult, { readonly status: 'ready' }>

interface StoryInput {
  readonly read: StoryRead
  readonly market: MarketRef
  /** Today's sections, which the open stories are scored against. */
  readonly sections: readonly BriefSectionResult[]
  /** The previous snapshot's sections, or null where there is none or it cannot be read. */
  readonly previous: readonly BriefSectionResult[] | null
  readonly calendar: TradingCalendar
  /** Most stories reviewed at once. */
  readonly limit: number
}

/** `[...thesis-review, story]`, or nothing when the session could not be read. Pure: the previous
 *  snapshot is the only memory, so a missing one means no review and every candidate an onset. */
export function planStory(input: StoryInput): readonly BriefSectionResult[] {
  const { read, previous } = input

  if (read.kind !== 'read') {
    return []
  }

  const stamp: SectionStamp = {
    asOf: read.session,
    provenance: read.provenance,
    currency: read.currency,
  }
  const reviewed = reviewedStories(input, read)
  const tracked = new Set(reviewed.map(runKeyOf))
  const continuing = continuingRuns(read, previous, input.calendar)
  const story = pickStory(
    read.candidates.filter(
      (candidate) => continuing[candidate.runKey] === undefined && !tracked.has(candidate.runKey)
    )
  )
  const runs = toldRuns(read.candidates, { continuing, tracked, story })

  return [
    ...reviewed.map((entry) => buildReviewSection(entry, ongoingLength(runs, entry), stamp)),
    buildStorySection(story, runs, stamp),
  ]
}

/** How long a reviewed story's run has gone on, only once it has outlived the session it was told:
 *  a run that restarted after a gap has no length worth saying. */
function ongoingLength(
  runs: Readonly<Record<string, number>>,
  story: TrackedStory
): number | undefined {
  const length = runs[runKeyOf(story)]

  return length !== undefined && length > FIRST_RUN_SESSION ? length : undefined
}

/** The stories yesterday's brief left open, scored against today and newest first. One told for the
 *  session being read has nothing new to say about it, so it is left out. */
function reviewedStories(input: StoryInput, read: ReadStory): readonly TrackedStory[] {
  const scored = trackedStories(input.previous ?? []).map((story) =>
    scoreStory(story, {
      market: input.market,
      session: read.session,
      sections: input.sections,
      calendar: input.calendar,
      ...(read.levels === undefined ? {} : { levels: read.levels }),
    })
  )

  return scored
    .filter((story) => story.toldIn < read.session)
    .sort((left, right) => right.toldIn.localeCompare(left.toldIn))
    .slice(0, input.limit)
}

/** The told runs that go on today, with their length. Only a story that was told leaves a run
 *  behind, so a candidate that lost on its first day can still be told later. A previous story
 *  section for the session just before extends a run; a rebuild of the same session keeps its
 *  lengths, except the story first told there, which is told again. A gap of unbriefed sessions
 *  ends every run. */
function continuingRuns(
  read: ReadStory,
  previous: readonly BriefSectionResult[] | null,
  calendar: TradingCalendar
): Readonly<Record<string, number>> {
  const section = previous?.find((candidate) => candidate.kind === 'story')
  const held = section?.status === 'ready' ? priorRuns(section) : {}
  const followsOn = section?.asOf === calendar.addTradingDays(read.session, -1)
  const same = section?.asOf === read.session
  const runs: Record<string, number> = {}

  for (const candidate of read.candidates) {
    const prior = held[candidate.runKey]

    if (prior !== undefined && followsOn) {
      runs[candidate.runKey] = prior + 1
    }

    if (prior !== undefined && same && prior > FIRST_RUN_SESSION) {
      runs[candidate.runKey] = prior
    }
  }

  return runs
}

interface RunState {
  readonly continuing: Readonly<Record<string, number>>
  /** Run keys of stories the review is still carrying. */
  readonly tracked: ReadonlySet<string>
  readonly story: StoryCandidate | undefined
}

/** What tomorrow reads: every told run that went on today, today's story as a new run, and a story
 *  still under review that fires after a gap, which restarts at one so it is not told twice. */
function toldRuns(
  candidates: readonly StoryCandidate[],
  { continuing, tracked, story }: RunState
): Readonly<Record<string, number>> {
  const runs: Record<string, number> = { ...continuing }

  for (const candidate of candidates) {
    if (runs[candidate.runKey] === undefined && tracked.has(candidate.runKey)) {
      runs[candidate.runKey] = FIRST_RUN_SESSION
    }
  }

  return story === undefined ? runs : { ...runs, [story.runKey]: FIRST_RUN_SESSION }
}

function priorRuns(section: ReadySection): Readonly<Record<string, number>> {
  const runs: Record<string, number> = {}

  for (const row of section.rows) {
    if (typeof row.runKey === 'string' && typeof row.sessions === 'number') {
      runs[row.runKey] = row.sessions
    }
  }

  return runs
}

/** The most salient onset wins, and a tie goes to the code listed first. */
function pickStory(onsets: readonly StoryCandidate[]): StoryCandidate | undefined {
  return [...onsets].sort(
    (left, right) =>
      right.salience - left.salience ||
      STORY_CODES.indexOf(left.code) - STORY_CODES.indexOf(right.code)
  )[0]
}
