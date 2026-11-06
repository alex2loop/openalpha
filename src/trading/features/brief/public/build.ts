import type { Locale } from '@/core/types/locale'
import type { BuiltPublicBriefRow, PublicBriefDeps } from '@/trading/features/brief/public/types'
import type { BriefSnapshot } from '@/trading/features/brief/types'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { SourceId } from '@/trading/kernel/source/source-id'
import type { MarketBriefRun } from '@/trading/markets/deps'
import { LOCAL_CHANNEL_ID } from '@/core/channels'
import { createBudget } from '@/engine/api'
import { PUBLIC_BRIEF_MARKETS } from '@/trading/features/brief/public/reads'
import { toPublicSnapshot } from '@/trading/features/brief/public/render'
import {
  carriedSections,
  PUBLIC_CORE_SECTIONS,
  PUBLIC_SESSION_KIND,
  publicSectionKinds,
  publicStoryOmits,
} from '@/trading/features/brief/public/scope'
import { runMarketBrief } from '@/trading/features/brief/run'
import { sourceId } from '@/trading/kernel/source/source-id'
import { isDeliverable } from '@/trading/markets/brief-deliverability'
import { resolveSettledDay } from '@/trading/markets/calendar'

/** What a section may cite and still be published. A section naming any other source is left out,
 *  whole. Taken from the provenance of a dry run on a copy of the data, news included. */
const PUBLIC_BRIEF_SOURCES: ReadonlySet<SourceId> = new Set(
  [
    'alternative-me',
    'binance',
    'binance-futures',
    'bls',
    'cftc',
    'coinmarketcap',
    'coinpaprika',
    'fred',
    'giavang',
    'pnj',
    'rss',
    'treasury',
    'vndirect',
    'vndirect-index',
    'yahoo',
  ].map(sourceId)
)

/** Sections carry no wording; the language only names what a suggestion run would be written in,
 *  and this build runs none. */
const BUILD_LOCALE: Locale = 'en'

interface PublicBriefInput {
  readonly day: TradingDay
  readonly now: number
  readonly signal: AbortSignal
}

/** The day's public brief, saved: the market sections the toggles allow, read from an empty book.
 *  Null when what the build found is not worth publishing: no core section, or a tape that is not
 *  the last settled session's. */
export async function buildPublicBrief(
  deps: PublicBriefDeps,
  input: PublicBriefInput
): Promise<BuiltPublicBriefRow | null> {
  const { signal } = input

  await deps.refresh({ markets: PUBLIC_BRIEF_MARKETS, signal })

  const built = await runMarketBrief(
    { logger: deps.logger, limit: deps.limit, omitStories: publicStoryOmits(deps.toggles) },
    {
      market: deps.market,
      request: buildRequest(deps, input),
      previous: await readPrevious(deps, input),
      asOf: input.day,
    }
  )
  const kept = keptSections(deps, built)

  if (!(isDeliverable(kept, PUBLIC_CORE_SECTIONS) && isSettledSession(deps, kept, input.now))) {
    return null
  }

  return deps.store.saveBuilt({ day: input.day, sections: kept, builtAt: input.now }, signal)
}

function buildRequest(deps: PublicBriefDeps, input: PublicBriefInput): MarketBriefRun {
  return {
    region: deps.market.manifest.region,
    locale: BUILD_LOCALE,
    asOf: input.day,
    now: input.now,
    signal: input.signal,
    watchlist: [],
    limit: deps.limit,
    // No book activity to report, and no scorecard to show.
    activitySince: input.now,
    scorecardShownThisMonth: true,
    channel: LOCAL_CHANNEL_ID,
    billingSessionId: null,
    budget: createBudget(0),
    reads: deps.reads,
  }
}

async function readPrevious(
  deps: PublicBriefDeps,
  input: PublicBriefInput
): Promise<BriefSnapshot | null> {
  const row = await deps.store.findPrevious(input.day, input.signal)

  return row === null
    ? null
    : toPublicSnapshot(
        { ...row, sections: carriedSections(row.sections, deps.toggles) },
        BUILD_LOCALE
      )
}

function keptSections(
  deps: PublicBriefDeps,
  sections: readonly BriefSectionResult[]
): readonly BriefSectionResult[] {
  const kinds = publicSectionKinds(deps.toggles)
  const allowed = sections.filter((section) => kinds.has(section.kind))
  const kept = allowed.filter(isPublishable)
  const dropped = allowed.filter((section) => !isPublishable(section))

  if (dropped.length > 0) {
    deps.logger.warn('trading.public_brief_sources_dropped', {
      sections: dropped.map((section) => section.kind),
      sources: [...new Set(dropped.flatMap(sourcesOf))],
    })
  }

  return kept
}

function isPublishable(section: BriefSectionResult): boolean {
  return sourcesOf(section).every((source) => PUBLIC_BRIEF_SOURCES.has(source))
}

function sourcesOf(section: BriefSectionResult): readonly SourceId[] {
  return section.status === 'ready' ? section.provenance.map((entry) => entry.sourceId) : []
}

/** The tape has no date of its own; the section that states the session its market's roll-ups were
 *  measured at must name the last settled one, or the day's numbers are an older session's. */
function isSettledSession(
  deps: PublicBriefDeps,
  sections: readonly BriefSectionResult[],
  now: number
): boolean {
  const { id, calendar } = deps.market.manifest
  const settled = resolveSettledDay(calendar, now)

  return sections.some(
    (section) =>
      section.kind === PUBLIC_SESSION_KIND &&
      section.market === id &&
      section.status === 'ready' &&
      section.asOf === settled
  )
}
