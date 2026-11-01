import type { MarketRef } from '@/trading/kernel/instrument'
import type { NewsItem } from '@/trading/kernel/market/market-data'
import type { MarketDataOverview } from '@/trading/kernel/market/market-overview'
import type {
  BriefSectionKind,
  BriefSectionResult,
  OverviewSectionKind,
} from '@/trading/kernel/operator/brief-section'
import type { MarketNews, SourceResult } from '@/trading/kernel/source/source-result'
import type { BriefContext } from '@/trading/markets/brief-context'
import type { SectionBuilder } from '@/trading/markets/brief-sections'
import { isAbortError } from '@/core/errors'
import {
  BRIEF_SECTION_ORDER,
  OVERVIEW_SECTION_KINDS,
} from '@/trading/kernel/operator/brief-section'
import { unavailable } from '@/trading/kernel/source/source-result'
import { buildSessionDelta } from '@/trading/markets/brief-delta'
import { toHeadlineSection } from '@/trading/markets/brief-headlines'
import { absent, omitted } from '@/trading/markets/brief-sections'
import { NEWS_ITEMS_PER_SECTION, normalizeTitle } from '@/trading/markets/news'
import { overviewSections } from '@/trading/markets/overview-sections'

/** The two suggestion sections are the expensive ones and run after everything else, so a screen
 *  that produced nothing or a budget already spent costs only them. `next-actions` runs last of
 *  all because it reads what the other twenty-five actually produced. */
const SUGGESTION_KINDS = Object.freeze(['suggestions', 'cross-asset-suggestions'] as const)

/** The sections whose rows state a price for a named instrument. What the quoteBoard must not
 *  repeat. */
const PRICED_KINDS: ReadonlySet<BriefSectionKind> = new Set([
  'market-prices',
  'market-quotes',
  'market-board',
])

/** The blocks that read before any market: a story one of them stated is not restated under a
 *  market, where it would read as a second event at a greater distance from its driver. */
const STORY_TAKING_KINDS: ReadonlySet<BriefSectionKind> = new Set([
  'macro-headlines',
  'economy-headlines',
])

/** The sections that close the brief, in the order they close it. They describe the whole read
 *  rather than any one market, so no block may claim them. */
const TAIL_KINDS = Object.freeze([
  'cost',
  'suggestions',
  'cross-asset-suggestions',
  'next-actions',
  'discipline',
] as const satisfies readonly BriefSectionKind[])

/** Every kind a home market's builders can produce: not the one composed from the others, not the
 *  kinds each market's overview converter emits, and not `headlines` - `toHeadlinesSection` builds
 *  it directly from `marketNews`, one per market, so no single-region builder can own it - nor
 *  `economy-headlines`, which waits on the macro block whose stories it must not repeat. Excluding
 *  them from the record type is what keeps a record exhaustive without builders that exist only to
 *  throw. */
export type ProducingSectionKind = Exclude<
  BriefSectionKind,
  | OverviewSectionKind
  | 'next-actions'
  | 'session-delta'
  | 'headlines'
  | 'economy-headlines'
  | 'thesis-review'
  | 'story'
>

export type SectionBuilders<Board> = Readonly<
  Partial<Record<ProducingSectionKind, SectionBuilder<Board>>>
>

/** What differs between the home markets' briefs, and nothing else. A kind without a builder is
 *  not run: a market reads the sections it has, and the rest are not its to report as absent. */
export interface BriefComposition<Board> {
  readonly home: MarketRef
  readonly builders: SectionBuilders<Board>
  /** Which kinds describe the home market rather than the operator's own book or the region it
   *  sits in. Stamped so the renderer can group a flat list into per-market blocks; the overview
   *  converter stamps its own. */
  readonly homeKinds: ReadonlySet<BriefSectionKind>
  buildNextActions(
    context: BriefContext<Board>,
    sections: readonly BriefSectionResult[],
    overviews: readonly BriefSectionResult[]
  ): Promise<BriefSectionResult>
}

interface ComposedBrief {
  readonly sections: readonly BriefSectionResult[]
  /** The home market's own overview read, absent when it failed. */
  readonly homeOverview: MarketDataOverview | undefined
}

/** Section content lives in the market modules that own it; this file orders, isolates, and bounds
 *  them. Every section is attempted, one failure cannot lose the rest, and the result comes back
 *  grouped: the operator's own sections, then one contiguous block per market, then the tail. */
export async function composeBrief<Board>(
  context: BriefContext<Board>,
  composition: BriefComposition<Board>
): Promise<ComposedBrief> {
  const producingKinds = BRIEF_SECTION_ORDER.filter(isEarlyKind).filter(
    (kind) => composition.builders[kind] !== undefined
  )
  const [producing, suggestions, overviews, news, economyNews] = await Promise.all([
    Promise.all(producingKinds.map((kind) => runSection(kind, context, composition))),
    Promise.all(SUGGESTION_KINDS.map((kind) => runSection(kind, context, composition))),
    readOrEmpty(
      context.services.overview({ now: context.request.now, signal: context.request.signal })
    ),
    readOrEmpty(
      context.services.marketNews({
        now: context.request.now,
        limit: NEWS_ITEMS_PER_SECTION,
        signal: context.request.signal,
      })
    ),
    readEconomyNews(context),
  ])
  // Converted only once the macro block exists: an economy story it already stated stays out, the
  // way both blocks' stories stay out of every market's headlines below.
  const economy = toHeadlineSection('economy-headlines', economyNews, takenStoryKeys(producing))
  const finished = [...producing, economy, ...suggestions]
  // Every market including this one: the converter's kinds are the ones no builder produces, so
  // the home block gains its prices, range, and leaders from the same path gold and crypto use.
  const fromOverviews = overviews.flatMap((overview) => overviewSections(overview))
  const fromNews = headlinesPerMarket(news, overviews, takenStoryKeys(finished))
  const homeOverview = overviews.find((overview) => overview.market === composition.home)

  const sections = withoutPricedNames(finished, fromOverviews)
  // The delta reads the last brief beside this one, so it runs once its sections exist: a failed
  // read costs the section, never the morning.
  const delta = await readDelta(context, sections)
  const composed = [...sections, delta]
  const nextActions = await composition.buildNextActions(context, composed, fromOverviews)

  return {
    sections: [
      ...operatorSections(composed),
      ...marketSections(
        withMarketStamps(composed, homeOverview, composition.home),
        [...fromOverviews, ...fromNews],
        composition.home
      ),
      ...tailSections(composed, nextActions),
    ],
    homeOverview,
  }
}

const orderIndex = (kind: BriefSectionKind): number => BRIEF_SECTION_ORDER.indexOf(kind)

function byOrder(sections: readonly BriefSectionResult[]): readonly BriefSectionResult[] {
  return [...sections].sort((left, right) => orderIndex(left.kind) - orderIndex(right.kind))
}

function isTail(kind: BriefSectionKind): boolean {
  return TAIL_KINDS.some((tail) => tail === kind)
}

/** What the brief says about the operator rather than about any market. */
function operatorSections(finished: readonly BriefSectionResult[]): readonly BriefSectionResult[] {
  return byOrder(
    finished.filter((section) => section.market === undefined && !isTail(section.kind))
  )
}

/** One contiguous block per market, each internally in `BRIEF_SECTION_ORDER`. The home block leads
 *  because it is the market this brief is scheduled by; the rest follow their overviews' order. */
function marketSections(
  finished: readonly BriefSectionResult[],
  fromOverviews: readonly BriefSectionResult[],
  home: MarketRef
): readonly BriefSectionResult[] {
  const owned = [...finished.filter((section) => section.market !== undefined), ...fromOverviews]
  const blocks = [home, ...owned.map((section) => section.market ?? home)]

  return [...new Set(blocks)].flatMap((market) =>
    byOrder(owned.filter((section) => section.market === market))
  )
}

function tailSections(
  finished: readonly BriefSectionResult[],
  nextActions: BriefSectionResult
): readonly BriefSectionResult[] {
  const tail = [...finished.filter((section) => isTail(section.kind)), nextActions]

  return TAIL_KINDS.flatMap((kind) => tail.filter((section) => section.kind === kind))
}

async function runSection<Board>(
  kind: ProducingSectionKind,
  context: BriefContext<Board>,
  composition: BriefComposition<Board>
): Promise<BriefSectionResult> {
  const build = composition.builders[kind]

  if (build === undefined) {
    return omitted(kind)
  }

  try {
    return stamped(await build(context), composition)
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    // One failing section must not lose the other twenty-five. The brief is the product's daily
    // surface; degrading it to a partial is strictly better than not delivering it.
    return stamped(
      absent(kind, [{ code: 'brief.section-unavailable', detail: { section: kind } }]),
      composition
    )
  }
}

/** The same isolation `runSection` gives a builder: the brief is the product's daily surface, so a
 *  read that throws costs its own sections, never the whole morning. Abort still propagates. */
async function readDelta(
  context: BriefContext,
  sections: readonly BriefSectionResult[]
): Promise<BriefSectionResult> {
  try {
    return await buildSessionDelta(context, sections)
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    return absent('session-delta', [
      { code: 'brief.section-unavailable', detail: { section: 'session-delta' } },
    ])
  }
}

/** The economy feed, read in the same batch as every builder and isolated the same way: a throw
 *  becomes the section's own absence, never the morning's. */
async function readEconomyNews(context: BriefContext): Promise<SourceResult<readonly NewsItem[]>> {
  try {
    return await context.services.economyNews({
      now: context.request.now,
      limit: NEWS_ITEMS_PER_SECTION,
      signal: context.request.signal,
    })
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    return unavailable(
      'failed',
      [],
      [{ code: 'brief.section-unavailable', detail: { section: 'economy-headlines' } }]
    )
  }
}

/** The same isolation `runSection` gives a builder: the brief is the product's daily surface, so a
 *  read that throws costs its own sections, never the whole morning. Abort still propagates. */
async function readOrEmpty<T>(read: Promise<readonly T[]>): Promise<readonly T[]> {
  try {
    return await read
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    return []
  }
}

/** A home section says so on itself, so the renderer groups blocks from the flat list without a
 *  second table of which kind belongs where. */
function stamped<Board>(
  section: BriefSectionResult,
  composition: BriefComposition<Board>
): BriefSectionResult {
  return composition.homeKinds.has(section.kind)
    ? { ...section, market: composition.home }
    : section
}

/** The market read names which market this is; the matching overview supplies the glyph and the
 *  session its block is dated by, so the header never depends on where `headlines` sorts. `taken`
 *  excludes stories the macro and economy blocks already stated, ahead of the per-section bound. */
function toHeadlinesSection(
  entry: MarketNews,
  overview: MarketDataOverview | undefined,
  taken: ReadonlySet<string>
): BriefSectionResult {
  const section = { ...toHeadlineSection('headlines', entry.result, taken), market: entry.market }

  return overview === undefined ? section : { ...section, icon: overview.icon, asOf: overview.asOf }
}

/** One block per market, each excluding every story the blocks before it already stated. A single
 *  wire item syndicated across desks answers several markets' feeds, and printing it under each
 *  reads as one event per market. */
function headlinesPerMarket(
  news: readonly MarketNews[],
  overviews: readonly MarketDataOverview[],
  taken: ReadonlySet<string>
): readonly BriefSectionResult[] {
  const stated = new Set(taken)
  const sections: BriefSectionResult[] = []

  for (const entry of news) {
    const section = toHeadlinesSection(
      entry,
      overviews.find((overview) => overview.market === entry.market),
      stated
    )

    for (const key of storyKeysOf(section)) {
      stated.add(key)
    }

    sections.push(section)
  }

  return sections
}

/** The stories the macro and economy blocks took. */
function takenStoryKeys(sections: readonly BriefSectionResult[]): ReadonlySet<string> {
  return new Set(
    sections.flatMap((section) =>
      STORY_TAKING_KINDS.has(section.kind) ? storyKeysOf(section) : []
    )
  )
}

function storyKeysOf(section: BriefSectionResult): readonly string[] {
  return section.status === 'ready'
    ? section.rows.map((row) => normalizeTitle(String(row.title)))
    : []
}

/** The block glyph, the session, and the currency this market's money is quoted in reach
 *  builder-made sections from the home overview, which is the one place manifest values are already
 *  carried into the brief. All absent when that read failed, which is why a turnover then prints
 *  without its unit and its block without a date. */
function withMarketStamps(
  sections: readonly BriefSectionResult[],
  overview: MarketDataOverview | undefined,
  home: MarketRef
): readonly BriefSectionResult[] {
  if (overview === undefined) {
    return sections
  }

  const { icon, asOf, currency } = overview

  return sections.map((section) => {
    if (section.market !== home) {
      return section
    }

    return section.status === 'ready'
      ? { ...section, icon, asOf, currency }
      : { ...section, icon, asOf }
  })
}

/** The quoteBoard exists to price the operator's own names that no market block listed. One a block
 *  already priced would appear twice at two prices, because the two reads are taken moments
 *  apart. */
function withoutPricedNames(
  sections: readonly BriefSectionResult[],
  fromOverviews: readonly BriefSectionResult[]
): readonly BriefSectionResult[] {
  const priced = new Set(
    fromOverviews.filter((section) => PRICED_KINDS.has(section.kind)).flatMap(tickersOf)
  )

  return sections.map((section) => {
    if (section.kind !== 'cross-asset-pulse' || section.status !== 'ready') {
      return section
    }

    const rows = section.rows.filter((row) => !priced.has(String(row.ticker)))

    return rows.length === 0 ? omitted('cross-asset-pulse') : { ...section, rows }
  })
}

function tickersOf(section: BriefSectionResult): readonly string[] {
  return section.status !== 'ready'
    ? []
    : section.rows.flatMap((row) => (typeof row.ticker === 'string' ? [row.ticker] : []))
}

/** The kinds this pass builds: not the deferred ones, not `headlines` - built from `marketNews`
 *  above, one per market - and not the kinds each market's overview converter emits: those have no
 *  builder, and asking for one produces a section that reports its own absence under a market
 *  nobody stamped. */
function isEarlyKind(kind: BriefSectionKind): kind is ProducingSectionKind {
  return (
    kind !== 'next-actions' &&
    kind !== 'session-delta' &&
    kind !== 'headlines' &&
    kind !== 'economy-headlines' &&
    kind !== 'thesis-review' &&
    kind !== 'story' &&
    !SUGGESTION_KINDS.some((deferred) => deferred === kind) &&
    !OVERVIEW_SECTION_KINDS.some((converted) => converted === kind)
  )
}
