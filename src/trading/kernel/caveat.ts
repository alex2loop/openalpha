// Each code declares its own severity at the point of definition, so adding a code forces the
// decision: `info` is an expected, by-design note (ℹ️); `warn` is a degradation (⚠️). The default
// direction is warn — a code forgotten here shows as a warning, never silently hidden.
const CAVEAT_CODES = Object.freeze([
  { code: 'source.unavailable', severity: 'warn' },
  { code: 'source.timeout', severity: 'warn' },
  { code: 'source.rate-limited', severity: 'warn' },
  { code: 'source.breaker-open', severity: 'warn' },
  { code: 'source.recovered', severity: 'info' },
  { code: 'source.futures-proxy', severity: 'info' },
  { code: 'source.token-proxy', severity: 'info' },
  { code: 'source.stale-cache', severity: 'warn' },
  { code: 'source.truncated', severity: 'warn' },
  { code: 'source.market-read-truncated', severity: 'warn' },
  { code: 'source.symbol-not-found', severity: 'warn' },
  { code: 'source.ambiguous-symbol', severity: 'warn' },
  { code: 'source.content-sanitized', severity: 'warn' },
  { code: 'source.payload-rejected', severity: 'warn' },
  { code: 'source.empty-window', severity: 'warn' },
  { code: 'source.stale-window', severity: 'warn' },
  { code: 'source.short-window', severity: 'warn' },
  { code: 'source.unit-mismatch', severity: 'info' },
  { code: 'source.no-available-provider', severity: 'warn' },
  { code: 'source.sector-map-unavailable', severity: 'warn' },
  { code: 'source.foreign-room-unavailable', severity: 'warn' },
  { code: 'source.supervision-unavailable', severity: 'warn' },
  { code: 'source.supervision-partial', severity: 'info' },
  { code: 'source.supervision-unofficial', severity: 'info' },
  { code: 'source.index-membership-unavailable', severity: 'warn' },
  { code: 'market.detector-failed', severity: 'warn' },
  { code: 'market.detection-partial', severity: 'warn' },
  { code: 'market.ticker-unknown', severity: 'warn' },
  { code: 'market.ticker-not-listed', severity: 'warn' },
  { code: 'market.ticker-ambiguous', severity: 'warn' },
  { code: 'market.ticker-shared', severity: 'warn' },
  { code: 'market.ticker-not-active', severity: 'warn' },
  { code: 'market.tokenized-equity', severity: 'warn' },
  { code: 'market.not-registered', severity: 'warn' },
  { code: 'market.exchange-unknown', severity: 'warn' },
  { code: 'market.first-day-band', severity: 'warn' },
  { code: 'market.band-edge-blocked', severity: 'warn' },
  { code: 'market.foreign-room-exhausted', severity: 'warn' },
  { code: 'market.foreign-room-unverified', severity: 'warn' },
  { code: 'market.distribution-session', severity: 'warn' },
  { code: 'market.index-review-eve', severity: 'warn' },
  { code: 'market.index-review-session', severity: 'warn' },
  { code: 'market.foreign-flip', severity: 'warn' },
  { code: 'market.washout-held', severity: 'warn' },
  { code: 'market.leverage-led', severity: 'warn' },
  { code: 'market.report-due', severity: 'warn' },
  { code: 'market.report-overdue', severity: 'warn' },
  { code: 'market.risk-event-headlines', severity: 'warn' },
  { code: 'market.ex-date-upcoming', severity: 'warn' },
  { code: 'market.margin-list-removal', severity: 'warn' },
  { code: 'market.margin-ineligible', severity: 'warn' },
  { code: 'market.delisting-scheduled', severity: 'warn' },
  { code: 'market.stop-beyond-band', severity: 'warn' },
  { code: 'market.stop-capped', severity: 'info' },
  { code: 'market-data.bar-basis-conflict', severity: 'warn' },
  { code: 'market-data.no-coverage', severity: 'warn' },
  { code: 'market-data.benchmark-unavailable', severity: 'warn' },
  { code: 'market-data.trade-sides-empty', severity: 'warn' },
  { code: 'market-data.trade-sides-missed', severity: 'warn' },
  { code: 'market-data.insufficient-history', severity: 'warn' },
  { code: 'market-data.universe-truncated', severity: 'warn' },
  { code: 'market-data.universe-shallow', severity: 'warn' },
  { code: 'market-data.universe-empty', severity: 'warn' },
  { code: 'market-data.history-empty', severity: 'warn' },
  { code: 'market-data.kind-unsupported', severity: 'warn' },
  { code: 'market-data.overview-unsupported', severity: 'warn' },
  { code: 'market-data.overview-failed', severity: 'warn' },
  { code: 'market-data.screen-unsupported', severity: 'warn' },
  { code: 'market-data.sectors-unsupported', severity: 'warn' },
  { code: 'market-data.focus-no-match', severity: 'info' },
  { code: 'market-data.close-only-series', severity: 'info' },
  { code: 'market-data.board-flow-diverges', severity: 'warn' },
  { code: 'market-data.world-close-lagging', severity: 'info' },
  { code: 'market-data.evidence-settled-only', severity: 'info' },
  { code: 'market-data.quote-not-live', severity: 'warn' },
  { code: 'market-data.evidence-stale', severity: 'warn' },
  { code: 'market-data.series-stale', severity: 'warn' },
  { code: 'market-data.funding-crowded', severity: 'warn' },
  { code: 'market-data.volatility-abstained-at-high', severity: 'info' },
  { code: 'market-data.conviction-drift', severity: 'warn' },
  { code: 'market-data.venue-catalog-unavailable', severity: 'warn' },
  { code: 'macro.inputs-missing', severity: 'warn' },
  { code: 'macro.regime-lowered', severity: 'warn' },
  { code: 'macro.regime-held', severity: 'info' },
  { code: 'macro.confirmers-abstained', severity: 'warn' },
  { code: 'macro.confirmers-warming-up', severity: 'info' },
  { code: 'macro.coverage-at-floor', severity: 'info' },
  { code: 'macro.coverage-below-floor', severity: 'warn' },
  { code: 'macro.optional-source-degraded', severity: 'warn' },
  { code: 'factor.coverage-below-minimum', severity: 'warn' },
  { code: 'factor.agreement-below-minimum', severity: 'warn' },
  { code: 'factor.input-missing', severity: 'warn' },
  { code: 'factor.input-stale', severity: 'warn' },
  { code: 'factor.accounts-weakening', severity: 'warn' },
  { code: 'factor.accounts-weakening-reading', severity: 'warn' },
  { code: 'factor.accounts-warning-signs', severity: 'warn' },
  { code: 'factor.bad-debt-rising', severity: 'warn' },
  { code: 'factor.inventory-outpacing-sales', severity: 'warn' },
  { code: 'factor.interest-cover-falling', severity: 'warn' },
  { code: 'factor.accounts-lines-dropped', severity: 'warn' },
  { code: 'factor.accounts-quarter-partial', severity: 'warn' },
  { code: 'factor.accounts-quarter-late', severity: 'warn' },
  { code: 'factor.cash-conversion-low', severity: 'warn' },
  { code: 'factor.free-cash-negative', severity: 'warn' },
  { code: 'factor.dividend-above-free-cash', severity: 'warn' },
  { code: 'factor.equity-raised', severity: 'warn' },
  { code: 'valuation.price-missing', severity: 'warn' },
  { code: 'valuation.fx-missing', severity: 'warn' },
  { code: 'valuation.price-stale', severity: 'warn' },
  { code: 'valuation.dealer-buy-price', severity: 'info' },
  { code: 'valuation.fx-stale', severity: 'warn' },
  { code: 'valuation.partial-nav', severity: 'warn' },
  { code: 'portfolio.valuation-partial', severity: 'warn' },
  { code: 'portfolio.targets-renormalized', severity: 'info' },
  { code: 'portfolio.targets-unfilled', severity: 'warn' },
  { code: 'portfolio.too-few-candidates', severity: 'warn' },
  { code: 'portfolio.core-unfilled', severity: 'warn' },
  { code: 'portfolio.segment-no-candidates', severity: 'warn' },
  { code: 'portfolio.candidates-available', severity: 'warn' },
  { code: 'portfolio.candidates-by-name', severity: 'warn' },
  { code: 'portfolio.holding-signal-missing', severity: 'warn' },
  { code: 'portfolio.increases-underfunded', severity: 'warn', operatorDetail: true },
  { code: 'portfolio.increase-below-minimum', severity: 'info' },
  { code: 'portfolio.reduce-standing', severity: 'warn' },
  { code: 'portfolio.reduction-below-minimum', severity: 'info' },
  { code: 'portfolio.candidate-illiquid', severity: 'warn' },
  { code: 'portfolio.unmeasured-volatility', severity: 'warn' },
  { code: 'portfolio.concentration-unchecked', severity: 'warn' },
  { code: 'portfolio.regime-risk', severity: 'warn' },
  { code: 'profile.exclusions-unavailable', severity: 'warn' },
  { code: 'stage.threw', severity: 'warn' },
  { code: 'suggestion.conviction-lowered', severity: 'warn' },
  { code: 'suggestion.averaging-down', severity: 'warn', operatorDetail: true },
  { code: 'suggestion.recent-exit', severity: 'warn', operatorDetail: true },
  { code: 'suggestion.round-trip-churn', severity: 'warn' },
  { code: 'suggestion.crowded-side', severity: 'warn' },
  { code: 'suggestion.size-limited-by-risk', severity: 'info' },
  { code: 'suggestion.size-limited-by-open-risk', severity: 'info' },
  { code: 'suggestion.open-risk-unplanned', severity: 'warn' },
  { code: 'suggestion.size-limited-by-position-cap', severity: 'info' },
  { code: 'suggestion.size-limited-by-sector', severity: 'info' },
  { code: 'suggestion.size-limited-by-etf', severity: 'info' },
  { code: 'suggestion.size-limited-by-segment', severity: 'info' },
  { code: 'suggestion.size-limited-by-cash', severity: 'info' },
  { code: 'suggestion.size-limited-by-liquidity', severity: 'info' },
  { code: 'suggestion.size-scaled-by-regime', severity: 'info' },
  { code: 'suggestion.size-realized-scale', severity: 'info' },
  { code: 'suggestion.size-unavailable', severity: 'warn' },
  { code: 'suggestion.size-fx-unavailable', severity: 'warn' },
  { code: 'suggestion.size-segment-uncapped', severity: 'warn' },
  { code: 'suggestion.turnover-below-minimum', severity: 'warn' },
  { code: 'suggestion.tracking-error-wide', severity: 'warn' },
  { code: 'suggestion.market-cap-below-minimum', severity: 'warn' },
  { code: 'suggestion.free-float-below-minimum', severity: 'warn' },
  { code: 'suggestion.under-supervision', severity: 'warn' },
  { code: 'suggestion.volatility-above-maximum', severity: 'warn' },
  { code: 'suggestion.volatility-below-minimum', severity: 'warn' },
  { code: 'suggestion.choppy-range', severity: 'warn' },
  { code: 'suggestion.recent-limit-hits', severity: 'warn' },
  { code: 'suggestion.leverage-above-maximum', severity: 'warn' },
  { code: 'suggestion.assets-to-equity-above-maximum', severity: 'warn' },
  { code: 'suggestion.profitability-below-minimum', severity: 'warn' },
  { code: 'suggestion.debate-degraded', severity: 'warn' },
  { code: 'suggestion.headlines-unread', severity: 'info' },
  { code: 'suggestion.citation-unverified', severity: 'warn' },
  { code: 'suggestion.figure-unmatched', severity: 'info' },
  { code: 'suggestion.claim-contradicted', severity: 'warn' },
  { code: 'suggestion.thesis-invalidated', severity: 'warn' },
  { code: 'suggestion.invalidator-restates-level', severity: 'warn' },
  { code: 'suggestion.levels-minimum-rr', severity: 'warn' },
  { code: 'suggestion.levels-void', severity: 'warn' },
  { code: 'suggestion.chasing-gap', severity: 'warn' },
  { code: 'suggestion.stop-ratcheted', severity: 'info' },
  { code: 'suggestion.take-profit-held', severity: 'info' },
  { code: 'suggestion.standing-unverified', severity: 'warn' },
  { code: 'suggestion.position-changed', severity: 'warn' },
  { code: 'reporting.sample-below-minimum', severity: 'warn' },
  { code: 'reporting.mixed-strategy-versions', severity: 'warn' },
  { code: 'reporting.repeats-folded', severity: 'info' },
  { code: 'reporting.shadow-approximation', severity: 'warn' },
  { code: 'alert.price-unavailable', severity: 'warn' },
  { code: 'brief.book-unpriced', severity: 'warn' },
  { code: 'brief.names-capped', severity: 'warn' },
  { code: 'brief.section-unavailable', severity: 'warn' },
  { code: 'refresh.no-available-provider', severity: 'warn' },
  { code: 'refresh.scope-empty', severity: 'warn' },
  { code: 'refresh.scope-partial', severity: 'warn' },
  { code: 'refresh.targets-missing', severity: 'warn' },
  { code: 'refresh.validation-failed', severity: 'warn' },
  { code: 'refresh.previous-scope-kept', severity: 'warn' },
  { code: 'refresh.bank-sector-unmapped', severity: 'warn' },
] as const)

export type CaveatCode = (typeof CAVEAT_CODES)[number]['code']

export const CAVEAT_CODE_STRINGS: readonly CaveatCode[] = CAVEAT_CODES.map((entry) => entry.code)

const CAVEAT_CODE_SET: ReadonlySet<string> = new Set(CAVEAT_CODE_STRINGS)

/** Codes whose detail is the operator's own money: a model gets the code, never the figure. */
export const OPERATOR_DETAIL_CODES: ReadonlySet<string> = new Set(
  CAVEAT_CODES.flatMap((entry) => ('operatorDetail' in entry ? [entry.code] : []))
)

export function isCaveatCode(code: string): code is CaveatCode {
  return CAVEAT_CODE_SET.has(code)
}

export type CaveatDetail = Readonly<Record<string, string | number>>

export type CaveatSeverity = 'info' | 'warn'

export interface Caveat {
  readonly code: CaveatCode
  readonly detail?: CaveatDetail
  /** An expected note against a degradation, which is what marks the row. Absent resolves from the
   *  code's own severity in `CAVEAT_CODES`. */
  readonly severity?: CaveatSeverity
}

const CODE_SEVERITY: ReadonlyMap<CaveatCode, CaveatSeverity> = new Map(
  CAVEAT_CODES.map((entry) => [entry.code, entry.severity])
)

export function caveatSeverity(caveat: Caveat): CaveatSeverity {
  return caveat.severity ?? CODE_SEVERITY.get(caveat.code) ?? 'warn'
}

/** Codes whose message names the provider that failed, so one is only reportable when a stamp
 *  exists to name. */
type SourcedCaveatCode = Extract<
  CaveatCode,
  | 'source.unavailable'
  | 'source.timeout'
  | 'source.rate-limited'
  | 'source.breaker-open'
  | 'source.stale-cache'
  | 'source.symbol-not-found'
  | 'source.payload-rejected'
  | 'source.stale-window'
  | 'source.short-window'
>

/** A boundary with no stamp reports the provider-agnostic code rather than a message with an
 *  unresolved `{source}`. What was being read survives that fall either way: the code hoists to a
 *  message-level list where the section that lost it is no longer beside it, and a warning naming
 *  neither a provider nor a subject reads as the whole block being unbacked. Ids are strings, not
 *  `SourceId`: `types/source` imports `Caveat` from here, so the reverse edge would close a cycle. */
export function sourcedCaveat(
  code: SourcedCaveatCode,
  sourceIds: readonly string[],
  detail: CaveatDetail & { readonly sourceKind: string }
): Caveat {
  const source = sourceIds[0]

  if (source === undefined) {
    return { code: 'source.no-available-provider', detail: { sourceKind: detail.sourceKind } }
  }

  return { code, detail: { ...detail, source } }
}

/** Aggregating several results repeats the same code once per contributor. Two caveats are the
 *  same only when their rendered detail matches too, so a per-kind detail is never collapsed into
 *  another kind's. First occurrence wins. */
export function dedupeCaveats(caveats: readonly Caveat[]): readonly Caveat[] {
  const seen = new Set<string>()

  return caveats.filter((caveat) => {
    const detail = Object.entries(caveat.detail ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `${name}=${value}`)
      .join('&')
    const key = `${caveat.code}|${detail}`

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

export const HOLD_REASON_CODES = Object.freeze([
  'stage-blocked',
  'insufficient-data',
  'zero-nav',
  'excluded-instrument',
  'segment-off',
  'segment-target-zero',
  'reference-only',
  'cap-exhausted',
  'sector-cap-exhausted',
  'etf-cap-exhausted',
  'segment-cap-exhausted',
  'cash-exhausted',
  'liquidity-too-thin',
  'risk-budget-too-small',
  'open-risk-exhausted',
  'size-below-board-lot',
  'increase-unfunded',
  'fully-invested',
  'market-not-tradeable',
  'history-not-adjusted',
  'index-review-session',
  'no-rebalance-needed',
  'evidence-sold',
  'recorded-entry',
  'factors-bearish',
  'factors-neutral',
  'factors-contested',
  'debate-unresolved',
  'debate-declined',
  'trader-waiting',
  'probability-below-floor',
  'claim-unverified',
] as const)
export type HoldReasonCode = (typeof HOLD_REASON_CODES)[number]

/** Why a held name is sold. `over-target` is the plan's trim; every other arm is the evidence
 *  turning on a name the book holds, and each names the share it sells. */
export const REDUCE_REASON_CODES = Object.freeze([
  'over-target',
  'thesis-weakening',
  'structure-broken',
  'regime-risk-off',
  'stale',
  'overheated',
] as const)
export type ReduceReasonCode = (typeof REDUCE_REASON_CODES)[number]
/** The evidence arms only. `over-target` is the plan's trim, which reads weights rather than
 *  evidence, so no market's own read can ever claim it. */
export type EvidenceReduceReasonCode = Exclude<ReduceReasonCode, 'over-target'>

/** Holds that report a failure to run rather than a verdict. The row is still written, but it must
 *  not satisfy the reuse gate: an outage cached as a decision blocks the ticker until tomorrow.
 *  `insufficient-data` belongs here for the same reason the debate case does - it says the evidence
 *  never arrived, not that the asset is a hold - and it is the arm a repaired provider unblocks, so
 *  caching it would hold yesterday's outage over a source that works again. */
export const UNDECIDED_HOLD_REASON_CODES: ReadonlySet<HoldReasonCode> = new Set<HoldReasonCode>([
  'debate-unresolved',
  'insufficient-data',
])

export const DELIVERY_ERROR_CODES = Object.freeze([
  'channel-unavailable',
  'channel-rejected',
  'recipient-revoked',
  'render-failed',
  'aborted',
] as const)
export type DeliveryErrorCode = (typeof DELIVERY_ERROR_CODES)[number]

export const INSTRUMENT_STATUSES = Object.freeze([
  'active',
  'halted',
  'delisted',
  'unknown',
] as const)
export type InstrumentStatus = (typeof INSTRUMENT_STATUSES)[number]

export const PORTFOLIO_FINDING_KINDS = Object.freeze([
  'position-cap-breach',
  'segment-cap-breach',
  'etf-cap-breach',
  'sector-cap-breach',
  'reserve-below-target',
  'segment-drift',
  'concentration',
  'illiquid-position',
  'excluded-holding',
] as const)
export type PortfolioFindingKind = (typeof PORTFOLIO_FINDING_KINDS)[number]

export const PORTFOLIO_EVIDENCE_KINDS = Object.freeze([
  'segment-weight',
  'position-weight',
  'sector-weight',
  'cash-weight',
  'days-to-liquidate',
] as const)
export type PortfolioEvidenceKind = (typeof PORTFOLIO_EVIDENCE_KINDS)[number]
