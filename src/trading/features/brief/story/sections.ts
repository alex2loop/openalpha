import type { TrackedStory } from '@/trading/features/brief/story/review'
import type { CurrencyCode, TradingDay } from '@/trading/kernel/instrument'
import type { BriefSectionResult, BriefSectionRow } from '@/trading/kernel/operator/brief-section'
import type { StoryCandidate, StoryWatch } from '@/trading/kernel/operator/brief-story'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'
import { toRunKey } from '@/trading/kernel/operator/brief-story'

/** What both sections share. Neither carries a market stamp: the block is the brief's lead, above
 *  every market's own, and a stamped section would be filed under a market and vanish. */
export interface SectionStamp {
  readonly asOf: TradingDay
  readonly provenance: readonly SourceProvenance[]
  readonly currency: CurrencyCode
}

/** The run key a story is told under: its code, plus the sector the sector codes are about. */
export function runKeyOf(story: TrackedStory): string {
  return toRunKey(story.code, story.sector)
}

/** One section per story still being tracked: a head row, then one row per watch. The head carries
 *  the session the story was told, which is how tomorrow's brief knows how old it is. */
export function buildReviewSection(
  story: TrackedStory,
  runLength: number | undefined,
  stamp: SectionStamp
): BriefSectionResult {
  const head: BriefSectionRow = {
    story: story.code,
    thesisStatus: story.status,
    at: story.toldIn,
    ...(story.sector === undefined ? {} : { sector: story.sector }),
    ...(runLength === undefined ? {} : { sessions: runLength }),
  }
  const watches = story.watches.map((watch) => ({
    ...watchRow(watch),
    mark: watch.mark ?? 'unobserved',
    ...(watch.value === undefined ? {} : { value: watch.value }),
  }))

  return readySection('thesis-review', [head, ...watches], stamp)
}

/** The told candidate, or an empty first row when none was. Either way the rows end with every told
 *  run that went on today and for how many sessions: tomorrow's onset rule reads them, and with no
 *  new story they are what the reader is told is still going on. */
export function buildStorySection(
  story: StoryCandidate | undefined,
  runs: Readonly<Record<string, number>>,
  stamp: SectionStamp
): BriefSectionResult {
  const runRows = Object.entries(runs).map(([runKey, sessions]) => ({ runKey, sessions }))

  if (story === undefined) {
    return readySection('story', [{}, ...runRows], stamp)
  }

  return readySection(
    'story',
    [
      { story: story.code, ...sectorOfFacts(story) },
      ...story.facts.map((fact) => ({ ...fact.row, storyRole: fact.role })),
      ...story.watches.map((watch) => watchRow(watch)),
      ...runRows,
    ],
    stamp
  )
}

function readySection(
  kind: 'thesis-review' | 'story',
  rows: readonly BriefSectionRow[],
  stamp: SectionStamp
): BriefSectionResult {
  return {
    kind,
    status: 'ready',
    asOf: stamp.asOf,
    rows,
    currency: stamp.currency,
    provenance: stamp.provenance,
    caveats: [],
  }
}

/** `sessions` on a watch is its horizon, the window its sentence names. */
function watchRow(watch: StoryWatch): BriefSectionRow {
  return {
    watch: watch.shape,
    threshold: watch.threshold,
    effect: watch.effect,
    sessions: watch.horizonSessions,
    ...scopeOf(watch.row),
  }
}

function scopeOf(row: StoryWatch['row']): BriefSectionRow {
  if (row === undefined) {
    return {}
  }

  return row.field === 'sector' ? { sector: row.value } : { ticker: row.value }
}

function sectorOfFacts(story: StoryCandidate): { readonly sector?: string } {
  for (const fact of story.facts) {
    if (typeof fact.row.sector === 'string') {
      return { sector: fact.row.sector }
    }
  }

  return {}
}
