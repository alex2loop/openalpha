import type { Caveat } from '@/trading/kernel/caveat'
import type { CurrencyCode, MarketRef, TradingDay } from '@/trading/kernel/instrument'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'

export const BRIEF_SECTION_ORDER = Object.freeze([
  'thesis-review',
  'story',
  'session-delta',
  'book-summary',
  'resolved-suggestions',
  'fired-alerts',
  'position-exits',
  'unwatched-positions',
  'stale-positions',
  'positions-in-loss',
  'cross-asset-pulse',
  'trade-sides',
  'drift-nudge',
  'monthly-scorecard',
  'regime-shift',
  'macro',
  'deposit-rate',
  'macro-headlines',
  'economy-headlines',
  'reading',
  'market-prices',
  'market-quotes',
  'market-board',
  'tape',
  'breadth',
  'turnover',
  'range',
  'market-cap',
  'sector-rotation',
  'foreign-desk-flow',
  'proprietary-flow',
  'derivatives',
  'taker-flow',
  'etf-flows',
  'positioning',
  'premium',
  'leaders',
  'leaders-24h',
  'movers-session',
  'movers-24h',
  'sentiment',
  'basis',
  'fx',
  'watchlist-leading',
  'watchlist-dropped',
  'screen-delta',
  'disclosures',
  'index-review',
  'events',
  'headlines',
  'cost',
  'suggestions',
  'cross-asset-suggestions',
  'next-actions',
  'discipline',
] as const)

export type BriefSectionKind = (typeof BRIEF_SECTION_ORDER)[number]

/** The render vocabulary a stored snapshot was written against. A snapshot carries it, and a reader
 *  that no longer speaks it rebuilds rather than rendering: section kinds and field names are
 *  already gated by their own enums, but a title that gains a placeholder is not, and an older
 *  payload renders it as the literal `{sessions}`. Bump whenever a section title, its params, a
 *  section-level key, or which block a kind is grouped into changes. */
export const BRIEF_RENDER_VERSION = 20

/** Kinds a market's overview converter emits, so no brief builder produces them. Compose's builder
 *  record excludes them, which is what keeps that record exhaustive. A kind only the whole-market
 *  view emits belongs here too: the brief never asks for it, and a builder existing only to throw
 *  would be worse than its absence. */
export const OVERVIEW_SECTION_KINDS = Object.freeze([
  'market-prices',
  'market-quotes',
  'market-board',
  'market-cap',
  'turnover',
  'derivatives',
  'taker-flow',
  'etf-flows',
  'positioning',
  'premium',
  'range',
  'leaders',
  'leaders-24h',
  'movers-session',
  'movers-24h',
  'sentiment',
  'reading',
] as const)
export type OverviewSectionKind = (typeof OVERVIEW_SECTION_KINDS)[number]

export const BRIEF_SECTION_STATUSES = Object.freeze([
  'ready',
  'unavailable',
  'omitted-by-policy',
] as const)

export type BriefSectionValue = string | number

/** Which side of a two-sided section a row sits on. Sector rotation reads over/under; desk flow
 *  reads buy/sell. One tuple because both are the same rendered field. */
export const BRIEF_DIRECTIONS = Object.freeze([
  'over',
  'under',
  'buy',
  'sell',
  'entered',
  'left',
] as const)
export type BriefDirection = (typeof BRIEF_DIRECTIONS)[number]

/** Which side crossed the spread for most of a session's classified volume. Apart from
 *  `BriefDirection` because net buying over a window and who was the aggressor in one session are
 *  different facts, and a reader who sees one word for both will read them as one. */
export type BriefAggressorSide = 'buy' | 'sell' | 'balanced'

/** What the brief tells the operator to do next. Not a suggestion: these name a command to run. */
export const BRIEF_ACTION_CODES = Object.freeze([
  'add-watchlist',
  'review-portfolio',
  'rebalance',
  'review-suggestions',
  'review-alerts',
  'avoid-chasing',
  'record-book',
  'record-dividend',
  'record-distribution',
] as const)
export type BriefActionCode = (typeof BRIEF_ACTION_CODES)[number]

/** What one market's session amounted to. Closed, because each arm is a catalog sentence and a
 *  builder that could compose its own would be writing copy. */
const BRIEF_READINGS = Object.freeze([
  'narrow-decline',
  'broad-decline',
  'rise-unconfirmed',
  'rise-confirmed',
] as const)
export type BriefReading = (typeof BRIEF_READINGS)[number]

/** How a stop is arrived at. One arm today; the tuple exists so the rendered sentence is a catalog
 *  key rather than a string a builder composes. */
const BRIEF_STOP_BASES = Object.freeze(['volatility-resting'] as const)
export type BriefStopBasis = (typeof BRIEF_STOP_BASES)[number]

/** Split out so the renderer's unit map can be exhaustive over them: a numeric field with no
 *  formatter reaches a reader as a raw float. */
export const BRIEF_NUMERIC_FIELDS = Object.freeze([
  'aboveMa50Ratio',
  'advanceRatio',
  'advancers',
  'aggressorSharePct',
  'basisPct',
  'buyPrice',
  'cashAfterPlanPctNav',
  /** A cash dividend per share, in the market's price unit. */
  'cashPerShare',
  'ceilings',
  'changePct',
  'compositeScore',
  'contribution',
  'coverage',
  'currentPctNav',
  'decliners',
  'deploymentScale',
  'depositRate12m',
  'entryTranchePct',
  'floors',
  'flowWindowUsd',
  'foreignNetBase',
  'foreignNetWindow',
  'funding',
  'index',
  'indexToMa50Pct',
  'ma50Measured',
  'largestSharePct',
  'last',
  'level',
  'limitUsd',
  'liquidReservePctNav',
  'losingCount',
  'losingReturnPct',
  'longShortRatio',
  'ma50SlopePct',
  'marketCap',
  'maximumOpenRiskPctNav',
  'maximumSectorPctNav',
  'measured',
  'nav',
  'net',
  'netAdvancers',
  'netFlowUsd',
  'netLong',
  'newHighs',
  'newLows',
  'previousClose',
  'observedPrice',
  'oiRatio',
  'openInterest',
  'pendingCount',
  'premium',
  'premiumPercentile',
  'previousFlow',
  'previousFraction',
  'previousMultiple',
  'previousSignedFlow',
  'previousSignedFraction',
  'proprietaryNetWindow',
  'rate',
  'relativeVolume',
  'reservePctNav',
  'resistance',
  'resistancePct',
  'resolvedCount',
  'returnPct',
  'riskPerTradePctNav',
  'score',
  'sellPrice',
  'sentimentScore',
  'sharePct',
  /** New shares per share held, a fraction (`0.1` for 100:10). */
  'shareRatio',
  'spentUsd',
  'spreadPct',
  'stopBreachedCount',
  'stopClearCount',
  'stopUnmeasuredCount',
  'strength',
  /** What a rights issue's new share costs, in the market's price unit. */
  'subscriptionPrice',
  'support',
  'supportPct',
  'takeProfitTranchePct',
  'takerBuyPct',
  'targetPctNav',
  'termDepositEligiblePctNav',
  'threshold',
  'turnover',
  'turnoverRatio',
  'value',
  'valuePct',
  'volatilityDaily',
  'weekChange',
  'winRate',
  'yearPercentile',
] as const)

const BRIEF_TEXT_FIELDS = Object.freeze([
  'action',
  'aggressorSide',
  'at',
  'closedOn',
  'observedOn',
  'paysOn',
  'board',
  'code',
  'condition',
  'conviction',
  'currentRegime',
  'direction',
  'driver',
  'driverMissing',
  'effect',
  'eventKind',
  'formulaVersion',
  /** Which market this row's instrument trades on, for a section whose rows span several. A section
   *  covering one market names it in its own header instead. */
  'market',
  'mark',
  'posture',
  'previousRegime',
  'publisher',
  'reason',
  'reading',
  'reduceReason',
  'regime',
  'sector',
  'segment',
  'sentiment',
  'status',
  'stopBasis',
  'story',
  'thesisStatus',
  'ticker',
  'title',
  'url',
  'watch',
] as const)

/** Fields a row carries for another field's sake, never as a datum of their own: `currency` is the
 *  unit appended to the values it denominates, `observedAt` is the instant a price block reads its
 *  clock from, and `sessions` is the window the row's own labels name. Printed as fields they would
 *  state a unit twice, an epoch once, and a window nothing measured. */
export const BRIEF_STRUCTURAL_FIELDS = Object.freeze([
  'currency',
  'observedAt',
  'sessions',
  'storyRole',
  'runKey',
] as const)

/** Every field a section may put in a row. Closed so a surface cannot render a value it has no
 *  label for: adding a field without its `trading.brief.field.*` entry fails composition. */
export const BRIEF_FIELDS = Object.freeze([
  ...BRIEF_NUMERIC_FIELDS,
  ...BRIEF_TEXT_FIELDS,
  ...BRIEF_STRUCTURAL_FIELDS,
])

export type BriefNumericField = (typeof BRIEF_NUMERIC_FIELDS)[number]
export type BriefField = (typeof BRIEF_FIELDS)[number]
export type BriefSectionRow = Readonly<Partial<Record<BriefField, BriefSectionValue>>>

/** The first numeric value a section list carries for a field, whatever row holds it: a total the
 *  first row states, or a board split the later ones do. */
export function sectionNumber(
  sections: readonly BriefSectionResult[],
  kind: BriefSectionKind,
  field: BriefField
): number | undefined {
  const section = sections.find((candidate) => candidate.kind === kind)

  if (section === undefined || section.status !== 'ready') {
    return undefined
  }

  for (const row of section.rows) {
    const value = row[field]

    if (typeof value === 'number') {
      return value
    }
  }

  return undefined
}

/** An operator who has recorded nothing: the book summary is omitted by policy, which is what a
 *  null book produces. A summary that is unavailable (the read threw) is not "no book", so a failed
 *  read never tells an operator with a real book to start one. */
export function hasNoBook(sections: readonly BriefSectionResult[]): boolean {
  return sections.find((section) => section.kind === 'book-summary')?.status === 'omitted-by-policy'
}

/** The window a section states, for a row rebuilt from its fields: a verdict line and a delta row
 *  both quote a section by field name, and a windowed label on either must name the span that
 *  section printed rather than nothing. */
export function sectionSessions(
  sections: readonly BriefSectionResult[],
  kind: BriefSectionKind
): { readonly sessions?: number } {
  const sessions = sectionNumber(sections, kind, 'sessions')

  return sessions === undefined ? {} : { sessions }
}

export type BriefSectionResult =
  | {
      readonly kind: BriefSectionKind
      readonly status: 'ready'
      /** Which market's block this section belongs to. Absent for sections that describe the
       *  operator's own book rather than a market. */
      readonly market?: MarketRef
      /** The market's block glyph, carried here because the renderer sees only the snapshot. */
      readonly icon?: string
      /** The session this section's numbers describe. Its block states it once, so four markets
       *  closing on four different days each date their own numbers. */
      readonly asOf?: TradingDay
      readonly rows: readonly BriefSectionRow[]
      /** What this section's money is denominated in: its aggregate amounts, or, for a price block,
       *  what its prices are quoted in. Absent where it carries neither, which is what keeps an
       *  index level from being labelled as currency. */
      readonly currency?: CurrencyCode
      /** Fills the section title's placeholders. A section whose rows sum a window has to name it,
       *  or the same label reports a different number on every surface that measures differently. */
      readonly titleParams?: Readonly<Record<string, string | number>>
      readonly provenance: readonly SourceProvenance[]
      readonly caveats: readonly Caveat[]
    }
  | {
      readonly kind: BriefSectionKind
      readonly status: 'unavailable' | 'omitted-by-policy'
      readonly market?: MarketRef
      readonly icon?: string
      readonly asOf?: TradingDay
      readonly caveats: readonly Caveat[]
    }
