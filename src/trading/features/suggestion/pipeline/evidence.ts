import type { ProviderChain } from '@/core/llm'
import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { AttemptRecorder } from '@/engine/api'
import type { HeadlinesRead } from '@/trading/features/suggestion/citation'
import type { HeadlineReads } from '@/trading/features/suggestion/pipeline/headline-reads'
import type { DebateInput } from '@/trading/features/suggestion/pipeline/types'
import type { SuggestionDirection } from '@/trading/features/suggestion/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { FactorResult, FactorScore, TradeLevels } from '@/trading/kernel/factor'
import type { PriceDisplay, Ticker } from '@/trading/kernel/instrument'
import type { AccountsHistory } from '@/trading/kernel/market/annual-accounts'
import type {
  AnalystRecommendation,
  MarketEvent,
  MarketEventKind,
  NewsItem,
} from '@/trading/kernel/market/market-data'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { Market } from '@/trading/markets/types'
import { t } from '@/i18n'
import { bankedShareOf } from '@/trading/features/suggestion/exit-plan/first-exit'
import { accountsSection } from '@/trading/features/suggestion/pipeline/accounts-evidence'
import { readHeadlines } from '@/trading/features/suggestion/pipeline/headline-reads'
import {
  type PromptMetricInput,
  renderPromptMetricLine,
} from '@/trading/features/suggestion/pipeline/metric-lines'
import { portfolioSection } from '@/trading/features/suggestion/pipeline/portfolio-evidence'
import { framedDirectionOf } from '@/trading/features/suggestion/types'
import { dedupeCaveats } from '@/trading/kernel/caveat'
import { normalizeTitle, rankHeadlines } from '@/trading/markets/news'
import { promptWholePercent } from '@/trading/prompt-text'
import { renderScoreBand } from '@/trading/render/format'
import { formatPrice } from '@/trading/render/money'
import { utcDayOf } from '@/trading/sources/rows/normalization'

const MAXIMUM_NEWS_ITEMS = 8
const MAXIMUM_HEADLINE_CHARS = 200
const MAXIMUM_SUMMARY_CHARS = 320

/** An event that moves no price, told as such: a bare ex-date reads as a reset worth waiting out. */
const EVENT_NOTES: Partial<Record<MarketEventKind, string>> = Object.freeze({
  'meeting-ex-date': 'no price adjustment: it carries only the right to attend the meeting',
})

interface DecisionFraming {
  readonly question: string
  readonly entry: string
  readonly stop: string
  readonly target: string
}

/** What the run is deciding, and what each level is for once it has been decided. `buildRoundedLevels`
 *  mirrors the triple on a reduce — stop above entry, target below — so the two sides need different
 *  words for the same three fields. Keyed on `framedDirectionOf`, the same function the research
 *  sides are framed by, so the levels and the cases can never describe opposite trades. */
const FRAMINGS = Object.freeze({
  buy: {
    question: 'whether to buy this name.',
    entry: 'where the buy goes on',
    stop: 'below entry: where the idea is wrong and the position closes',
    target: 'above entry: where the idea has paid off',
  },
  reduce: {
    question:
      'whether to sell down a position the operator already holds. Every level below prices that sale, so "entry" means entering the sale, and the triple is the mirror of a buy: a stop above entry is correct here, not an error.',
    entry: 'where the sale goes on',
    stop: 'above entry: where selling proves to have been the wrong call',
    target: 'below entry: where the sale has paid off',
  },
} as const satisfies Record<SuggestionDirection, DecisionFraming>)

const RUNNER_TARGET =
  'above entry: the far level the reward is measured to, which few entries reach; nothing is sold there'

/** Enough to tell two multiples apart, few enough that no persona reads spurious precision. A
 *  count and a đồng figure carry none, and a rank carries none it earned. Prices ignore this and
 *  follow the board instead. */
export interface EvidenceBundle {
  /** Already normalized, attributed, and sanitized: the rendered text every persona reasons over. */
  readonly text: string
  /** A verdict about the evidence rather than evidence, so only the roles that decide read it: an
   *  advocate handed it argues the system's caution instead of its own side. */
  readonly adjudication: string
  /** Where the book already stands, on the same terms. Empty when no ledger was valued. Read by
   *  the deciding roles only, for the same reason. */
  readonly portfolio: string
  /** The headlines behind that text, by URL: what a persona's citation resolves against. */
  readonly sources: ReadonlyMap<string, NewsItem>
  readonly headlinesRead: HeadlinesRead
  readonly caveats: readonly Caveat[]
}

/** Assembled once, before any persona runs. No role performs retrieval: giving six personas web
 *  access would make cost unbounded, provenance unattributable, and two roles able to argue from
 *  different facts. The market read is a second request rather than a widened one: most names have
 *  no coverage of their own on a given day, and the two travel to the personas separately. */
interface EvidenceBundleOptions {
  readonly market: Market
  readonly input: DebateInput
  readonly decisionsChain?: ProviderChain
  readonly recordAttempt: AttemptRecorder
  readonly logger: Logger
}

export async function buildEvidenceBundle(options: EvidenceBundleOptions): Promise<EvidenceBundle> {
  const { market, input } = options
  const { instrument } = input.draft
  const asOf = input.draft.at
  const now = input.request.now
  const signal = input.request.signal
  const [news, marketNews, recommendations, accounts] = await Promise.all([
    market.capabilities.news?.run({ instrument, asOf, now, limit: MAXIMUM_NEWS_ITEMS, signal }),
    market.capabilities.news?.run({ asOf, now, limit: MAXIMUM_NEWS_ITEMS, signal }),
    market.capabilities.recommendations?.run({ instrument, asOf, now, signal }),
    market.capabilities.accounts?.run({ instrument, asOf, now, signal }),
  ])
  const consensus = recommendations?.kind === 'available' ? recommendations.value : []
  const ownRanked = headlines(news, now)
  const read = await readHeadlines({
    ...(options.decisionsChain === undefined ? {} : { chain: options.decisionsChain }),
    recordAttempt: options.recordAttempt,
    logger: options.logger,
    request: input.request,
    instrument,
    assetClass: market.manifest.assetClass,
    own: ownRanked,
    market: withoutStories(headlines(marketNews, now), ownRanked),
    signal,
  })

  return {
    caveats: reportableCaveats([
      ...(news?.caveats ?? []),
      ...(marketNews?.caveats ?? []),
      ...(recommendations?.caveats ?? []),
      ...(accounts?.caveats ?? []),
      ...read.caveats,
    ]),
    sources: new Map([...read.own, ...read.market].map((item) => [item.url, item])),
    headlinesRead: { own: read.own.length, market: read.market.length, costUsd: read.costUsd },
    adjudication: adjudicationSection(input),
    portfolio: portfolioSection(input.exposure),
    text: evidenceText(input, market, { read, consensus, accounts }),
  }
}

function evidenceText(
  input: DebateInput,
  market: Market,
  sections: {
    readonly read: HeadlineReads
    readonly consensus: readonly AnalystRecommendation[]
    readonly accounts: SourceResult<AccountsHistory> | undefined
  }
): string {
  const display = market.manifest.priceDisplay

  return [
    instrumentSection(input),
    factorSection(input, display),
    accountsSection(sections.accounts, {
      locale: input.request.locale,
      currency: market.manifest.currency,
    }),
    levelSection({
      levels: input.proposedLevels,
      direction: framedDirectionOf(input.draft),
      banked: bankedShareOf(input.draft, market.trail !== undefined),
      locale: input.request.locale,
      display,
    }),
    eventsSection(input.upcomingEvents),
    newsSection(sections.read.own),
    marketNewsSection(sections.read.market, input.draft.instrument.ticker),
    consensusSection(sections.consensus, input.request.locale, display),
  ]
    .filter((section) => section.length > 0)
    .join('\n\n')
}

/** These sections are optional narrative, so a provider that answered with nothing is a fact about
 *  the name, not a degradation: a quiet company files nothing for weeks and a thinly-covered one has
 *  no analyst view. One that failed to answer carries a different code and still travels. Deduped
 *  because the three reads share a failover chain. */
function reportableCaveats(caveats: readonly Caveat[]): readonly Caveat[] {
  return dedupeCaveats(caveats.filter((caveat) => caveat.code !== 'source.empty-window'))
}

function instrumentSection(input: DebateInput): string {
  const tier = input.draft.indexTier
  const basket = tier === undefined ? '' : ` (${tier} constituent)`

  return [
    `INSTRUMENT: ${input.draft.instrument.ticker} on ${input.draft.instrument.market}${basket}`,
    `AS OF: ${input.draft.evidenceThrough ?? input.draft.at}`,
    `DECISION: ${FRAMINGS[framedDirectionOf(input.draft)].question}`,
  ].join('\n')
}

function factorSection(input: DebateInput, display: PriceDisplay | undefined): string {
  const { factors, request, draft } = input

  if (factors.results.length === 0) {
    return ''
  }

  const referencePrice = draft.quote?.price ?? entryOf(draft)
  const context: FactorRowContext = { locale: request.locale, display, referencePrice }

  return [
    'FACTORS (each band is the verdict for BUYING, not the level of the thing named - a bearish band on a factor whose name is a quantity means that quantity argues against the buy; an abstained factor is not a zero). A price level is printed with how far the current price sits from it; a window in sessions is a span, never a price:',
    ...factors.results.map((factor) => factorRow(factor, context)),
  ].join('\n')
}

interface FactorRowContext {
  readonly locale: Locale
  readonly display: PriceDisplay | undefined
  readonly referencePrice: number | undefined
}

function entryOf(draft: DebateInput['draft']): number | undefined {
  return draft.action === 'hold' ? draft.entry : draft.entry
}

/** The name is the catalog's, in the operator's own language, and the bare id no longer travels
 *  beside it: it was carried so a persona would not invent a name, and instead the persona copied
 *  the id itself into its prose. No role output references one, so nothing downstream reads it.
 *
 *  The measured quantities go through the surface's own renderer, so a value the persona republishes
 *  cannot be scaled differently from the one the operator reads. Unlike the composite score below,
 *  they are inputs rather than a verdict: a persona arguing from the multiple is arguing from
 *  evidence the reader can check, not talking the system's own conclusion upward. */
function factorRow(factor: FactorResult, context: FactorRowContext): string {
  const { locale, display, referencePrice } = context
  const label = t(locale, `trading.factor.${factor.id}`)

  if (factor.weight === undefined) {
    return `- ${label}: unavailable (abstained)`
  }

  const band = renderScoreBand(locale, factor.score)
  const promptInput: PromptMetricInput = {
    locale,
    metrics: factor.metrics,
    display,
    referencePrice,
  }
  const measured = renderPromptMetricLine(promptInput)

  return measured === undefined
    ? `- ${label}: ${band}`
    : `- ${label}: ${band} (measured: ${measured})`
}

function adjudicationSection(input: DebateInput): string {
  const conviction = `DETERMINISTIC CONVICTION: ${input.draft.conviction}`

  return [conviction, confidenceRow(input.factors)].join('\n')
}

/** Stated against the market's floors, not as numbers: the conviction already drops a band for a
 *  shortfall, and a bare ratio below one invites a role to cut it again. */
function confidenceRow(factors: FactorScore): string {
  return factors.coverageBelowMinimum || factors.agreementBelowMinimum
    ? 'CONFIDENCE: the factors cover too little of the model or disagree too much, and the conviction above is already one band lower for it. Do not lower it again for this.'
    : 'CONFIDENCE: the factors cover enough of the model and agree enough for this market. That is already in the conviction above, so it is no reason to raise or lower it.'
}

interface LevelSectionInput {
  readonly levels: TradeLevels | undefined
  readonly direction: SuggestionDirection
  /** The share sold at the take-profit; below one, the rest rides the trail with no fixed exit. */
  readonly banked: number
  readonly locale: Locale
  readonly display: PriceDisplay | undefined
}

/** The levels are stated as fixed. A persona reasons about timing and conditions around them; it
 *  cannot move them, and its schema has nowhere to return one. Each one says what it is for on the
 *  framed side, because the triple alone is ambiguous: a sale's stop sits above its entry, and a
 *  role reading the bare field names against the buy convention reports the plan as inverted. */
function levelSection(input: LevelSectionInput): string {
  const { levels, locale, display } = input

  if (levels === undefined) {
    return 'LEVELS: unavailable — no entry, stop, or target has been computed.'
  }

  const { banked } = input
  const framing = FRAMINGS[input.direction]
  const runner = banked < 1

  return [
    'LEVELS (fixed, computed deterministically — quote them as they stand, never alter them):',
    `- entry ${formatPrice(locale, levels.entry, display)} — ${entryPurpose(levels, framing)}`,
    `- stop ${formatPrice(locale, levels.stop, display)} — ${framing.stop}`,
    ...(runner
      ? [
          `- take-profit ${formatPrice(locale, levels.takeProfit, display)} — ${promptWholePercent(banked)} of the position is sold here; the rest has no fixed exit and rides a rising stop`,
        ]
      : []),
    `- target ${formatPrice(locale, levels.target, display)} — ${runner ? RUNNER_TARGET : framing.target}`,
  ].join('\n')
}

/** A resting entry is said to be one, or every role reads the limit as the price trading now. */
function entryPurpose(levels: TradeLevels, framing: DecisionFraming): string {
  const { resting } = levels

  if (resting === undefined) {
    return framing.entry
  }

  return (
    `a buy limit resting below the live price for ${resting.validSessions} sessions, because ` +
    `the name ran ${promptWholePercent(resting.run)} over its last ${resting.runSessions}; ` +
    'it fills only on a dip to it'
  )
}

/** Dated facts, not forecasts: a persona weighs when the tape resets, it does not guess the size of
 *  the dividend or the market's reaction to it. */
function eventsSection(events: readonly MarketEvent[] | undefined): string {
  if (events === undefined || events.length === 0) {
    return ''
  }

  return [
    'UPCOMING EVENTS (dated facts; weigh timing, do not invent outcomes):',
    ...events.map(eventRow),
  ].join('\n')
}

/** The provider's note is what tells an extraordinary meeting from the annual one. */
function eventRow(event: MarketEvent): string {
  const detail = event.detail?.slice(0, MAXIMUM_SUMMARY_CHARS)
  const notes = [detail, EVENT_NOTES[event.kind]].filter((note) => note !== undefined)
  const suffix = notes.length === 0 ? '' : ` (${notes.join('; ')})`

  return `- ${event.at} ${event.kind}: ${event.title}${suffix}`
}

function newsSection(items: readonly NewsItem[]): string {
  if (items.length === 0) {
    return ''
  }

  return [
    'HEADLINES (cite by url; do not assert anything they do not say):',
    ...items.map(evidenceRow),
  ].join('\n')
}

/** Held apart from the instrument's own headlines. Most names have no coverage on a given day, so
 *  the market's is what a persona would otherwise reason without — but it names other companies,
 *  and folding it into the section above is how it gets attributed to this one. */
function marketNewsSection(items: readonly NewsItem[], subject: Ticker): string {
  if (items.length === 0) {
    return ''
  }

  return [
    'MARKET HEADLINES (background only; never attribute these to this instrument):',
    ...items.map((item) => `- (background, not ${subject}) ${headlineText(item)}`),
  ].join('\n')
}

/** Analyst coverage is evidence to weigh, exactly like a headline — never a factor or a conviction
 *  input. The positivity-bias note travels with it because sell-side coverage skews bullish. */
function consensusSection(
  rows: readonly AnalystRecommendation[],
  locale: Locale,
  display: PriceDisplay | undefined
): string {
  if (rows.length === 0) {
    return ''
  }

  const totals = rows.reduce(
    (sum, row) => ({
      buy: sum.buy + row.buyCount,
      hold: sum.hold + row.holdCount,
      sell: sum.sell + row.sellCount,
    }),
    { buy: 0, hold: 0, sell: 0 }
  )

  const target = meanTargetPrice(rows)

  return [
    'ANALYST COVERAGE (sell-side coverage skews bullish; weigh accordingly):',
    `- buy ${totals.buy}, hold ${totals.hold}, sell ${totals.sell}`,
    ...(target === undefined
      ? []
      : [`- mean target price ${formatPrice(locale, target, display)}`]),
  ].join('\n')
}

/** The reports that named a target, averaged. A report without one is coverage, not a price view,
 *  so it counts toward the ratings above and not toward this. */
function meanTargetPrice(rows: readonly AnalystRecommendation[]): number | undefined {
  const targets = rows.flatMap((row) => (row.targetPrice === undefined ? [] : [row.targetPrice]))

  if (targets.length === 0) {
    return undefined
  }

  return Math.round(targets.reduce((sum, price) => sum + price, 0) / targets.length)
}

/** Ranked rather than sliced: a scope reads several feeds, merged in feed order, so taking the
 *  first rows hands every slot to whichever publisher files most often. */
/** A story the instrument's own read already carried is not background: printed in both sections it
 *  would arrive once inviting citation and once forbidding it. Keyed by title, because an
 *  aggregator and the publisher it carries give one story two urls. */
function withoutStories(
  items: readonly NewsItem[],
  carried: readonly NewsItem[]
): readonly NewsItem[] {
  const titles = new Set(carried.map((item) => normalizeTitle(item.title)))

  return items.filter((item) => !titles.has(normalizeTitle(item.title)))
}

function headlines(
  result: SourceResult<readonly NewsItem[]> | undefined,
  now: number
): readonly NewsItem[] {
  return result?.kind === 'available'
    ? rankHeadlines(result.value, { now, limit: MAXIMUM_NEWS_ITEMS })
    : []
}

function headlineRow(item: NewsItem): string {
  return `- ${headlineText(item)}`
}

function headlineText(item: NewsItem): string {
  const day = utcDayOf(item.publishedAt)

  return `${item.title.slice(0, MAXIMUM_HEADLINE_CHARS)} (${day}) ${item.url}`
}

/** The instrument's own coverage carries its abstract, because this is the text a claim is verified
 *  against and a headline often cannot settle one. Market background stays headline-only: the
 *  personas are told not to reason from it about this name, so paying tokens to expand it buys
 *  nothing. */
function evidenceRow(item: NewsItem): string {
  const head = headlineRow(item)
  const summary = item.summary?.trim() ?? ''

  return summary === '' ? head : `${head}\n    ${summary.slice(0, MAXIMUM_SUMMARY_CHARS)}`
}
