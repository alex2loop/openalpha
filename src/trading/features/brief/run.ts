import type { Logger } from '@/core/logging/logger'
import type { BriefSnapshot } from '@/trading/features/brief/types'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { BriefSectionKind, BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { MarketBrief, StoryCode, StoryRead } from '@/trading/kernel/operator/brief-story'
import type { MarketBriefRun } from '@/trading/markets/deps'
import type { Market } from '@/trading/markets/types'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { planStory } from '@/trading/features/brief/story/plan'
import { withoutOmitted } from '@/trading/markets/brief-sections'

export interface MarketBriefDeps {
  readonly logger: Logger
  readonly omitSections?: ReadonlySet<BriefSectionKind>
  readonly omitStories?: ReadonlySet<StoryCode>
  /** The most rows a section or the story carries. */
  readonly limit: number
}

interface MarketBriefInput {
  readonly market: Market
  readonly request: MarketBriefRun
  /** What the reader saw before this day: the stories still open are carried from it. */
  readonly previous: BriefSnapshot | null
  readonly asOf: TradingDay
}

/** The market's sections with the story ahead of them, whatever reads the request carries: the
 *  owner's brief and any other build run these same steps. A market with no brief capability has no
 *  sections. */
export async function runMarketBrief(
  deps: MarketBriefDeps,
  input: MarketBriefInput
): Promise<readonly BriefSectionResult[]> {
  const capability = input.market.capabilities.brief

  if (capability === undefined) {
    return []
  }

  const built = await capability.run(input.request)

  logDegradedSections(deps, input, withoutOmitted(built.sections, deps.omitSections))

  return [...tryPlanStory(deps, input, built), ...built.sections]
}

/** The story is garnish: a throw costs the brief its two sections, never the brief. An abort is
 *  the caller's. A failed detection and a failed step share one log line, so a reader sees one
 *  boundary. */
function tryPlanStory(
  deps: MarketBriefDeps,
  input: MarketBriefInput,
  brief: MarketBrief
): readonly BriefSectionResult[] {
  const { stories } = brief

  try {
    if (stories.kind === 'failed') {
      logStoryFailed(deps, input, stories.err)

      return []
    }

    return planStory({
      read: withoutOmittedStories(stories, deps.omitStories),
      market: input.market.manifest.id,
      sections: brief.sections,
      previous: input.previous?.sections ?? null,
      calendar: input.market.manifest.calendar,
      limit: deps.limit,
    })
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    logStoryFailed(deps, input, err)

    return []
  }
}

/** The read with the stories an edition never tells left out, as if their detectors never fired. */
function withoutOmittedStories(
  read: StoryRead,
  omit: ReadonlySet<StoryCode> | undefined
): StoryRead {
  if (omit === undefined || read.kind !== 'read') {
    return read
  }

  return { ...read, candidates: read.candidates.filter((candidate) => !omit.has(candidate.code)) }
}

function logStoryFailed(deps: MarketBriefDeps, input: MarketBriefInput, err: unknown): void {
  deps.logger.warn('trading.brief_story_failed', { asOf: input.asOf, err: formatErrForLog(err) })
}

/** One line per build, not per section: a builder that throws throws for every name it would have
 *  reported, and the snapshot already carries the caveat a reader sees. */
function logDegradedSections(
  deps: MarketBriefDeps,
  input: MarketBriefInput,
  sections: readonly BriefSectionResult[]
): void {
  const degraded = sections.filter(
    (section) => section.status === 'unavailable' && section.caveats.length > 0
  )

  if (degraded.length > 0) {
    // The codes travel with the section names: the brief runs unattended, and which sections were
    // thin is only half the answer a reader needs the next morning.
    deps.logger.warn('trading.brief_sections_degraded', {
      asOf: input.asOf,
      sections: degraded.map((section) => section.kind),
      codes: [...new Set(degraded.flatMap((section) => section.caveats.map(codeOf)))],
    })
  }
}

function codeOf(caveat: BriefSectionResult['caveats'][number]): string {
  return caveat.code
}
