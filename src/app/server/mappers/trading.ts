// One mapper per wire shape. A handler calls its service, then its mapper — it never assembles a
// wire object inline, so a projection can only be wrong in one place. `toSuggestionWire` in
// particular has two call sites (/v1/suggestions and /v1/track-record) and one definition.
import type {
  AbsolutePositionWire,
  InstrumentRefWire,
  MarketEventWire,
  NavBenchmarkWire,
  SuggestionCardWire,
  SuggestionWire,
  TradingCandleWire,
  TradingNavResponse,
  TradingNewsItemWire,
  TradingPortfolioResponse,
  TradingProfileResponse,
  TradingQuotesResponse,
  TradingQuoteWire,
  TradingWireCaveat,
  TradingWireProvenance,
} from '@/app/server/wire/trading'
import type { Locale } from '@/core/types/locale'
import type {
  Candle,
  Caveat,
  InstrumentRef,
  MarketEvent,
  NavBenchmark,
  NavHistory,
  NewsItem,
  PortfolioView,
  QuoteBoard,
  QuoteBoardItem,
  SourceProvenance,
  StoredSuggestion,
  SuggestionCard,
  UserProfile,
  ValuedPosition,
} from '@/trading/api'
import {
  buildInstrumentKey,
  describeCaveat,
  isBelowMinimumSize,
  isRecordedPlan,
  isUndecidedHold,
  shownCall,
} from '@/trading/api'

const PERCENT_PER_UNIT = 100

/** The CLI's own sentence and severity ride with the code, so a client never guesses which caveat
 *  is a degradation. A caveat whose stored detail no longer fills its sentence is dropped, as the
 *  CLI drops it. */
function toCaveatWire(caveat: Caveat, locale: Locale): TradingWireCaveat[] {
  const described = describeCaveat(locale, caveat)

  if (described === undefined) {
    return []
  }

  return [
    {
      code: caveat.code,
      ...(caveat.detail === undefined ? {} : { data: caveat.detail }),
      severity: described.severity,
      text: described.message,
    },
  ]
}

/** A runtime share (0.015) as the wire's percent (1.5). */
export function percent(fraction: number): number {
  return fraction * PERCENT_PER_UNIT
}

export function toCaveatWires(
  caveats: readonly Caveat[],
  locale: Locale
): readonly TradingWireCaveat[] {
  return caveats.flatMap((caveat) => toCaveatWire(caveat, locale))
}

function toProvenanceWire(provenance: SourceProvenance): TradingWireProvenance {
  return {
    sourceId: provenance.sourceId,
    fetchedAt: provenance.fetchedAt,
    freshness: provenance.freshness,
    ...(provenance.observedAt === undefined ? {} : { observedAt: provenance.observedAt }),
  }
}

export function toProvenanceWires(
  provenance: readonly SourceProvenance[]
): readonly TradingWireProvenance[] {
  return provenance.map(toProvenanceWire)
}

export function toInstrumentWire(instrument: InstrumentRef): InstrumentRefWire {
  return { market: instrument.market, ticker: instrument.ticker }
}

export function toQuotesResponse(quoteBoard: QuoteBoard, locale: Locale): TradingQuotesResponse {
  return {
    quotes: quoteBoard.items.map((item) => toQuoteWire(item, locale)),
    caveats: toCaveatWires(quoteBoard.caveats, locale),
  }
}

/** Neither live nor a settled close: an old print from a session that is still trading. */
function isStale(item: QuoteBoardItem): boolean {
  return item.observed.kind === 'close' && item.closedOn === undefined
}

function toQuoteWire(item: QuoteBoardItem, locale: Locale): TradingQuoteWire {
  return {
    ticker: item.ticker,
    // The wire's own label: the instrument key the two fields below spell out.
    label: buildInstrumentKey({ market: item.market, ticker: item.ticker }),
    region: item.region,
    currency: item.currency,
    last: item.last,
    ...(item.changePct === undefined ? {} : { changePct: item.changePct }),
    ...(item.closedOn === undefined ? {} : { closedOn: item.closedOn }),
    ...(isStale(item) ? { staleAt: item.observed.observedAt } : {}),
    provenance: toProvenanceWires(item.provenance),
    caveats: toCaveatWires(item.caveats, locale),
    kind: item.kind,
    market: item.market,
    assetClass: item.assetClass,
  }
}

export function toCandleWire(candle: Candle): TradingCandleWire {
  return {
    at: candle.at,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  }
}

export function toMarketEventWire(event: MarketEvent): MarketEventWire {
  return {
    at: event.at,
    kind: event.kind,
    title: event.title,
    ...(event.detail === undefined ? {} : { detail: event.detail }),
    ...(event.cashPerShare === undefined ? {} : { cashPerShare: event.cashPerShare }),
    ...(event.paysOn === undefined ? {} : { paysOn: event.paysOn }),
    ...(event.shareRatio === undefined ? {} : { shareRatio: event.shareRatio }),
    ...(event.subscriptionPrice === undefined
      ? {}
      : { subscriptionPrice: event.subscriptionPrice }),
  }
}

export function toNewsItemWire(item: NewsItem): TradingNewsItemWire {
  return {
    title: item.title,
    url: item.url,
    sourceIds: [...item.sourceIds],
    publishedAt: item.publishedAt,
    ...(item.summary === undefined ? {} : { summary: item.summary }),
  }
}

/** `preferredLocale` is the one language every reply is written in, `[locale] language`: the
 *  profile carries none of its own. */
export function toProfileWire(profile: UserProfile, locale: Locale): TradingProfileResponse {
  return {
    preferredLocale: locale,
    baseCurrency: profile.baseCurrency,
    riskLevel: profile.riskLevel,
    riskCapacity: profile.riskCapacity,
    riskWillingness: profile.riskWillingness,
    horizons: { ...profile.horizons },
    goal: profile.goal,
    watchlist: profile.watchlist.map(toInstrumentWire),
    exclusions: profile.exclusions.map(toInstrumentWire),
    segmentTargets: { ...profile.segmentTargets },
    caps: Object.fromEntries(
      Object.entries(profile.caps).map(([segment, cap]) => [
        segment,
        {
          maximumPositionPctNav: cap.maximumPositionPctNav,
          maximumSegmentPctNav: cap.maximumSegmentPctNav,
        },
      ])
    ),
    maximumSectorPctNav: profile.maximumSectorPctNav,
    reservePctNav: profile.reservePctNav,
    regimeScale: profile.regimeScale,
    riskPerTradePctNav: profile.riskPerTradePctNav,
  }
}

export function toPortfolioWire(sized: PortfolioView, locale: Locale): TradingPortfolioResponse {
  const book = sized.valued
  const context = { navBase: book.navBase, minimumSizes: sized.minimumSizes, locale }

  return {
    asOf: book.book.asOf,
    baseCurrency: book.book.baseCurrency,
    ...(book.navBase === undefined ? {} : { navBase: book.navBase }),
    cashBase: book.book.cashBase,
    availableCashBase: book.book.availableCashBase,
    positions: book.positions.map((position) => toPositionWire(position, context)),
    shares: { segments: sized.shares },
    caveats: toCaveatWires(book.caveats, locale),
  }
}

function toNavBenchmarkWire(benchmark: NavBenchmark): NavBenchmarkWire {
  return {
    legs: benchmark.legs.map((leg) => ({
      segment: leg.segment,
      weight: leg.weight,
      ...(leg.instrument === undefined ? {} : { instrument: toInstrumentWire(leg.instrument) }),
    })),
    points: benchmark.points.map((point) => ({ day: point.day, index: point.index })),
    periodReturn: benchmark.periodReturn,
  }
}

/** Absent figures stay absent: a history too thin to measure sends no return and no drawdown at
 *  all rather than a zero a client would draw as a flat line. */
export function toNavWire(history: NavHistory): TradingNavResponse {
  return {
    window: history.window,
    baseCurrency: history.baseCurrency,
    ...(history.firstDay === undefined ? {} : { firstDay: history.firstDay }),
    recordedCount: history.recordedCount,
    points: history.points.map((point) => ({
      day: point.day,
      nav: point.navBase,
      index: point.index,
    })),
    ...(history.periodReturn === undefined ? {} : { periodReturn: history.periodReturn }),
    ...(history.maximumDrawdown === undefined ? {} : { maximumDrawdown: history.maximumDrawdown }),
    ...(history.currentDrawdown === undefined ? {} : { currentDrawdown: history.currentDrawdown }),
    ...(history.benchmark === undefined
      ? {}
      : { benchmark: toNavBenchmarkWire(history.benchmark) }),
    ...(history.benchmarkGap === undefined ? {} : { benchmarkGap: history.benchmarkGap }),
  }
}

/** An unpriced position sends no market value and no weight at all rather than a zero: a client
 *  that renders zero has been told the holding is worthless, which the valuation never claimed. */
function toPositionWire(
  position: ValuedPosition,
  context: {
    readonly navBase: number | undefined
    readonly minimumSizes: ReadonlyMap<string, number>
    readonly locale: Locale
  }
): AbsolutePositionWire {
  const { navBase, minimumSizes, locale } = context
  const heldSince = position.position.buys[0]?.acquiredAt
  const minimumSize = minimumSizes.get(buildInstrumentKey(position.position.instrument))
  const base = {
    instrument: toInstrumentWire(position.position.instrument),
    quantity: position.position.quantity,
    belowMinimumSize: isBelowMinimumSize(position.position.quantity, minimumSize),
    settledQuantity: position.position.settledQuantity,
    ...(position.position.quantity > 0
      ? { unitCostNative: position.position.costBasisNative / position.position.quantity }
      : {}),
    ...(heldSince === undefined ? {} : { heldSince }),
    investedBase: position.position.costBasisBase,
  }

  if (position.kind === 'unpriced') {
    return { ...base, caveats: toCaveatWires([position.caveat], locale) }
  }

  return {
    ...base,
    marketValueBase: position.valueBase,
    unrealizedPnlBase: position.valueBase - base.investedBase,
    ...(navBase === undefined || navBase === 0
      ? {}
      : { weightPctNav: percent(position.valueBase / navBase) }),
    caveats: [],
  }
}

/** What the row kept beside the call: where the plan's stop has risen to, for a chart's stop-raise
 *  marks, the models that argued it, and whether its lower level is only a review. Each is absent
 *  until the row has it. */
function toStoredStateWire(
  suggestion: StoredSuggestion
): Pick<SuggestionWire, 'trailingStop' | 'raisedStopFrom' | 'models' | 'reviewOnly'> {
  const { trailingStop, raisedStopFrom, debate, reviewOnly } = suggestion

  return {
    ...(reviewOnly === true ? { reviewOnly } : {}),
    ...(trailingStop === undefined ? {} : { trailingStop }),
    ...(raisedStopFrom === undefined ? {} : { raisedStopFrom }),
    ...(debate === undefined || debate.models.length === 0 ? {} : { models: [...debate.models] }),
  }
}

export function toSuggestionWire(call: StoredSuggestion, locale: Locale): SuggestionWire {
  const suggestion = shownCall(call)
  const base = {
    id: suggestion.id,
    instrument: toInstrumentWire(suggestion.instrument),
    at: suggestion.at,
    authoredLocale: suggestion.authoredLocale,
    conviction: suggestion.conviction,
    strategyId: suggestion.strategyId,
    strategyVersion: suggestion.strategyVersion,
    focusKey: suggestion.focusKey,
    calculationVersions: suggestion.calculationVersions.map((version) => ({
      name: version.name,
      version: version.version,
    })),
    createdAt: suggestion.createdAt,
    provenance: toProvenanceWires(suggestion.provenance),
    caveats: toCaveatWires(suggestion.caveats, locale),
    ...toStoredStateWire(suggestion),
  }

  if (suggestion.action === 'hold') {
    return {
      ...base,
      action: 'hold',
      ...(suggestion.thesis === undefined ? {} : { thesis: suggestion.thesis }),
      ...(suggestion.entry === undefined ? {} : { entry: suggestion.entry }),
      ...(suggestion.stop === undefined ? {} : { stop: suggestion.stop }),
      ...(suggestion.target === undefined ? {} : { target: suggestion.target }),
      ...(suggestion.riskReward === undefined ? {} : { riskReward: suggestion.riskReward }),
      holdReasonCodes: [...suggestion.holdReasonCodes],
      ...toHoldKindWire(suggestion),
    }
  }

  return {
    ...base,
    action: suggestion.action,
    thesis: suggestion.thesis,
    entry: suggestion.entry,
    stop: suggestion.stop,
    target: suggestion.target,
    riskReward: suggestion.riskReward,
    ...(suggestion.sizePctNav === undefined ? {} : { sizePctNav: suggestion.sizePctNav }),
    ...(suggestion.outcome === undefined ? {} : { outcome: toOutcomeWire(suggestion.outcome) }),
  }
}

// A hold that is not a decision: a run that failed, or the plan written for a held name at its fill.
function toHoldKindWire(
  suggestion: StoredSuggestion
): Pick<Extract<SuggestionWire, { readonly action: 'hold' }>, 'undecided' | 'recorded'> {
  if (isUndecidedHold(suggestion)) {
    return { undecided: true }
  }

  return isRecordedPlan(suggestion) ? { recorded: true } : {}
}

function toOutcomeWire(
  outcome: NonNullable<Extract<StoredSuggestion, { action: 'buy' | 'reduce' }>['outcome']>
): NonNullable<SuggestionWire['outcome']> {
  return {
    status: outcome.status,
    resolvedAt: outcome.resolvedAt,
    exitDay: outcome.exitDay,
    returnPct: outcome.returnPct,
    ...(outcome.benchmarkReturnPct === undefined
      ? {}
      : { benchmarkReturnPct: outcome.benchmarkReturnPct }),
  }
}

export function toSuggestionCardWire(card: SuggestionCard): SuggestionCardWire {
  return {
    verdict: card.verdict,
    facts: [...card.facts],
    reasons: [...card.reasons],
    levels: [...card.levels],
    notes: [...card.notes],
    ...(card.calibration === undefined ? {} : { calibration: card.calibration }),
    details: card.details.map((block) => [...block]),
    disclaimer: card.disclaimer,
  }
}
