import type { ProviderChain } from '@/core/llm'
import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { AttemptRecorder } from '@/engine/api'
import type { HeadlinesRead } from '@/trading/features/suggestion/citation'
import type { HeadlineReads } from '@/trading/features/suggestion/pipeline/headline-reads'
import type { DebateInput } from '@/trading/features/suggestion/pipeline/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { FactorResult } from '@/trading/kernel/factor'
import type { InstrumentRef, PriceDisplay, Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { AccountsHistory } from '@/trading/kernel/market/annual-accounts'
import type { AnalystRecommendation, NewsItem } from '@/trading/kernel/market/market-data'
import type { MarketEvent, MarketEventKind } from '@/trading/kernel/market/market-event'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { Market } from '@/trading/markets/types'
import { t } from '@/i18n'
import { bankedShareOf } from '@/trading/features/suggestion/exit-plan/first-exit'
import { accountsSection } from '@/trading/features/suggestion/pipeline/accounts-evidence'
import {
  adjudicationSection,
  decisionLine,
  levelSection,
} from '@/trading/features/suggestion/pipeline/decision-evidence'
import { readHeadlines } from '@/trading/features/suggestion/pipeline/headline-reads'
import {
  type PromptMetricInput,
  renderPromptMetricLine,
} from '@/trading/features/suggestion/pipeline/metric-lines'
import {
  consensusSection,
  headlines,
  MAXIMUM_EVIDENCE_NEWS_ITEMS,
  MAXIMUM_SUMMARY_CHARS,
  marketNewsSection,
  newsSection,
  withoutStories,
} from '@/trading/features/suggestion/pipeline/news-evidence'
import { portfolioSection } from '@/trading/features/suggestion/pipeline/portfolio-evidence'
import { framedDirectionOf } from '@/trading/features/suggestion/types'
import { dedupeCaveats } from '@/trading/kernel/caveat'
import { renderDeclaredValue, renderProvidedValue, renderScoreBand } from '@/trading/render/format'

/** An event that moves no price, told as such: a bare ex-date reads as a reset worth waiting out. */
const EVENT_NOTES: Partial<Record<MarketEventKind, string>> = Object.freeze({
  'meeting-ex-date': 'no price adjustment: it carries only the right to attend the meeting',
})

const MAXIMUM_INSTRUMENT_NAME_CHARS = 120
const WHITESPACE_RE = /\s+/g

const EVENTS_UNAVAILABLE =
  'UPCOMING EVENTS: unavailable - the corporate calendar failed this run; never assume nothing is scheduled.'

const FACTORS_HEADING =
  'FACTORS (each band is the verdict for BUYING, not the level of the thing named - a bearish band on a factor whose name is a quantity means that quantity argues against the buy; an abstained factor is not a zero). A price level is printed with how far the current price sits from it; a window in sessions is a span, never a price:'

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

/** What the evidence is read about, and nothing a drafted decision adds. The debate fills it from its
 *  draft; the analysis has no draft, so it states each of these itself. */
export interface CaseSubject
  extends Pick<
    DebateInput,
    'request' | 'factors' | 'name' | 'sector' | 'upcomingEvents' | 'recentEvents' | 'calendarFailed'
  > {
  readonly instrument: InstrumentRef
  /** The day every source is asked as of. */
  readonly asOf: TradingDay
  /** The newest settled session the readings stand on; absent reads as `asOf`. */
  readonly evidenceThrough?: TradingDay
  readonly indexTier?: string
  /** The price a factor's price level is stated against. Absent prints the bare level. */
  readonly referencePrice?: number
  /** What the factor rows are said to mean, which the question being argued decides. */
  readonly factorsHeading: string
  /** Leaves out the analysts' ratings and target prices, which are not read at all: a case that is
   *  published must not republish a third party's rating or price level. */
  readonly withoutAnalystCoverage?: true
}

/** Every section a case reads, in the order they print. The debate slots its own sections between
 *  the groups, so they travel apart and `caseText` is the one place that joins them alone. */
export interface CaseEvidence {
  readonly instrument: string
  /** The measured readings: factors, then annual accounts. */
  readonly readings: readonly string[]
  /** What was reported: events, filings, headlines, analyst coverage. */
  readonly reports: readonly string[]
  readonly sources: ReadonlyMap<string, NewsItem>
  readonly headlinesRead: HeadlinesRead
  readonly caveats: readonly Caveat[]
}

interface CaseEvidenceOptions {
  readonly market: Market
  readonly subject: CaseSubject
  readonly decisionsChain?: ProviderChain
  readonly recordAttempt: AttemptRecorder
  readonly logger: Logger
}

interface EvidenceReads {
  readonly news: SourceResult<readonly NewsItem[]> | undefined
  readonly marketNews: SourceResult<readonly NewsItem[]> | undefined
  readonly recommendations: SourceResult<readonly AnalystRecommendation[]> | undefined
  readonly accounts: SourceResult<AccountsHistory> | undefined
}

/** What names the instrument beyond its ticker, shared by the evidence line and the headline read. */
interface InstrumentFacts {
  readonly name?: string
  readonly sectorLabel?: string
}

export async function buildEvidenceBundle(options: EvidenceBundleOptions): Promise<EvidenceBundle> {
  const { market, input } = options
  const { draft } = input
  const evidence = await buildCaseEvidence({
    market,
    subject: caseSubjectOf(input),
    ...(options.decisionsChain === undefined ? {} : { decisionsChain: options.decisionsChain }),
    recordAttempt: options.recordAttempt,
    logger: options.logger,
  })
  const levels = levelSection({
    levels: input.proposedLevels,
    direction: framedDirectionOf(draft),
    banked: bankedShareOf(draft, market.trail !== undefined),
    locale: input.request.locale,
    display: market.manifest.priceDisplay,
  })

  return {
    caveats: evidence.caveats,
    sources: evidence.sources,
    headlinesRead: evidence.headlinesRead,
    adjudication: adjudicationSection(input),
    portfolio: portfolioSection(input.exposure),
    text: joinSections([
      `${evidence.instrument}\n${decisionLine(draft)}`,
      ...evidence.readings,
      levels,
      ...evidence.reports,
    ]),
  }
}

/** The debate's reference is the price the draft was made at: the live quote, else its entry. */
function caseSubjectOf(input: DebateInput): CaseSubject {
  const { draft } = input
  const referencePrice = draft.quote?.price ?? draft.entry

  return {
    ...input,
    instrument: draft.instrument,
    asOf: draft.at,
    factorsHeading: FACTORS_HEADING,
    ...(draft.evidenceThrough === undefined ? {} : { evidenceThrough: draft.evidenceThrough }),
    ...(draft.indexTier === undefined ? {} : { indexTier: draft.indexTier }),
    ...(referencePrice === undefined ? {} : { referencePrice }),
  }
}

/** Everything the personas read about one instrument that does not depend on a decision having been
 *  drafted. */
export async function buildCaseEvidence(options: CaseEvidenceOptions): Promise<CaseEvidence> {
  const { market, subject } = options
  const { instrument } = subject
  const { now, signal } = subject.request
  const reads = await readEvidenceSources(market, subject)
  const { news, marketNews, recommendations, accounts } = reads
  const ownRanked = headlines(news, now)
  const facts = instrumentFactsOf(subject)
  const read = await readHeadlines({
    ...facts,
    ...(options.decisionsChain === undefined ? {} : { chain: options.decisionsChain }),
    recordAttempt: options.recordAttempt,
    logger: options.logger,
    request: subject.request,
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
    instrument: instrumentSection(subject, facts),
    readings: [
      factorSection(subject, market.manifest.priceDisplay),
      accountsSection(reads.accounts, {
        locale: subject.request.locale,
        currency: market.manifest.currency,
      }),
    ],
    reports: reportSections(subject, market, { read, reads }),
  }
}

/** The shared sections alone, as an analysis reads them. */
export function caseText(evidence: CaseEvidence): string {
  return joinSections([evidence.instrument, ...evidence.readings, ...evidence.reports])
}

function joinSections(sections: readonly string[]): string {
  return sections.filter((section) => section.length > 0).join('\n\n')
}

function readEvidenceSources(market: Market, subject: CaseSubject): Promise<EvidenceReads> {
  const { instrument, asOf } = subject
  const { now, signal } = subject.request

  return Promise.all([
    market.capabilities.news?.run({
      instrument,
      asOf,
      now,
      limit: MAXIMUM_EVIDENCE_NEWS_ITEMS,
      signal,
    }),
    market.capabilities.news?.run({ asOf, now, limit: MAXIMUM_EVIDENCE_NEWS_ITEMS, signal }),
    subject.withoutAnalystCoverage === true
      ? undefined
      : market.capabilities.recommendations?.run({ instrument, asOf, now, signal }),
    market.capabilities.accounts?.run({ instrument, asOf, now, signal }),
  ]).then(([news, marketNews, recommendations, accounts]) => ({
    news,
    marketNews,
    recommendations,
    accounts,
  }))
}

interface ReportReads {
  readonly read: HeadlineReads
  readonly reads: EvidenceReads
}

function reportSections(
  subject: CaseSubject,
  market: Market,
  { read, reads }: ReportReads
): readonly string[] {
  const display = market.manifest.priceDisplay
  const consensus = reads.recommendations?.kind === 'available' ? reads.recommendations.value : []

  return [
    eventsSection(subject),
    recentEventsSection(subject),
    newsSection(read.own, reads.news, market.manifest.calendar),
    marketNewsSection({
      items: read.market,
      subject: subject.instrument.ticker,
      read: reads.marketNews,
      calendar: market.manifest.calendar,
    }),
    consensusSection({
      rows: consensus,
      locale: subject.request.locale,
      display,
      read: reads.recommendations,
    }),
  ]
}

/** These sections are optional narrative, so a provider that answered with nothing is a fact about
 *  the name, not a degradation: a quiet company files nothing for weeks and a thinly-covered one has
 *  no analyst view. One that failed to answer carries a different code and still travels. Deduped
 *  because the three reads share a failover chain. */
function reportableCaveats(caveats: readonly Caveat[]): readonly Caveat[] {
  return dedupeCaveats(caveats.filter((caveat) => caveat.code !== 'source.empty-window'))
}

/** The name is a provider's string: one line and a bounded length, so it can never break the prompt
 *  layout. A name that is only the ticker adds nothing. */
function instrumentName(name: string | undefined, ticker: Ticker): string | undefined {
  const line = name
    ?.replace(WHITESPACE_RE, ' ')
    .trim()
    .slice(0, MAXIMUM_INSTRUMENT_NAME_CHARS)
    .trim()

  return line === undefined || line === '' || line.toLowerCase() === ticker.toLowerCase()
    ? undefined
    : line
}

function instrumentFactsOf(subject: CaseSubject): InstrumentFacts {
  const name = instrumentName(subject.name, subject.instrument.ticker)
  const { sector } = subject

  return {
    ...(name === undefined ? {} : { name }),
    ...(sector === undefined
      ? {}
      : {
          sectorLabel: renderProvidedValue(
            subject.request.locale,
            `trading.sector.${sector}`,
            sector
          ),
        }),
  }
}

function instrumentSection(subject: CaseSubject, facts: InstrumentFacts): string {
  const { locale } = subject.request
  const { ticker, market } = subject.instrument
  const tier = subject.indexTier
  const basket = tier === undefined ? '' : ` (${tier} constituent)`
  const marketLabel = renderDeclaredValue(locale, `trading.market.${market}`)
  const label = [ticker, facts.name, facts.sectorLabel, `on ${marketLabel}${basket}`]
    .filter((part) => part !== undefined)
    .join(' - ')

  return [
    `INSTRUMENT: ${label}`,
    'Every claim is about this instrument; never substitute another company, coin, or ticker.',
    `AS OF: ${subject.evidenceThrough ?? subject.asOf}`,
  ].join('\n')
}

function factorSection(subject: CaseSubject, display: PriceDisplay | undefined): string {
  const { factors, request, referencePrice } = subject

  if (factors.results.length === 0) {
    return ''
  }

  const context: FactorRowContext = { locale: request.locale, display, referencePrice }

  return [
    subject.factorsHeading,
    ...factors.results.map((factor) => factorRow(factor, context)),
  ].join('\n')
}

interface FactorRowContext {
  readonly locale: Locale
  readonly display: PriceDisplay | undefined
  readonly referencePrice: number | undefined
}

/** The name is the catalog's, in the operator's own language, and the bare id no longer travels
 *  beside it: it was carried so a persona would not invent a name, and instead the persona copied
 *  the id itself into its prose. No role output references one, so nothing downstream reads it.
 *
 *  The measured quantities go through the surface's own renderer, so a value the persona republishes
 *  cannot be scaled differently from the one the operator reads. Unlike the deterministic conviction,
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

/** Dated facts, not forecasts: a persona weighs when the tape resets, it does not guess the size of
 *  the dividend or the market's reaction to it. */
function eventsSection(subject: CaseSubject): string {
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
function recentEventsSection(subject: CaseSubject): string {
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

  return `- ${event.at} ${event.kind}: ${event.title}${suffix}`
}
