import type { Caveat } from '@/trading/kernel/caveat'
import type {
  CurrencyCode,
  InstrumentRef,
  MarketRef,
  SessionPhase,
  TradingDay,
  TradingSessionState,
} from '@/trading/kernel/instrument'
import type {
  EtfFlowSnapshot,
  PercentileEntry,
  PercentileId,
  PositioningSnapshot,
  Quote,
  SentimentSnapshot,
  SessionSoFar,
} from '@/trading/kernel/market/market-data'
import type { MacroRiskView } from '@/trading/kernel/market/market-macro'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'

/** Where an instrument trades right now, carried beside the settled close it never replaces. The
 *  time is formatted on the market's own clock at build, because the row travels without a
 *  calendar. */
export interface LiveIndexReading {
  readonly price: number
  readonly changePct?: number
  readonly observedAt: number
  /** The session this reading was taken in, on the quoting market's own calendar — which is the day
   *  it belongs to, not the settled day the rest of the overview is dated by. */
  readonly observedOn: TradingDay
  readonly observedTime: string
  /** What the intraday series has recorded today, where the provider serves one. */
  readonly session?: IntradaySession
}

/** `SessionSoFar` with its start on the market's own clock, because a high and a low mean nothing
 *  without the moment they are measured from. */
export interface IntradaySession extends Omit<SessionSoFar, 'fromAt'> {
  readonly fromTime: string
}

/** The session still running, counted from the live board rather than from stored evidence. Three
 *  counts and no more: everything else a settled session reports is either not final until the close
 *  or measured against a full session. `matched` is names that have printed a trade so far, which
 *  climbs through the day - never the settled block's `measured`, and never compared with it. */
export interface MarketIntradayBreadth {
  readonly at: TradingDay
  readonly advancers: number
  readonly decliners: number
  readonly matched: number
}

/** Not exported: every consumer reads it through `MarketDataOverview.premiumRank` and none names
 *  the type. */
interface PremiumRank {
  /** 0-100. */
  readonly percentile: number
  readonly sessions: number
}

export interface MarketDataOverviewRow {
  readonly instrument: InstrumentRef
  readonly quote?: Quote
  /** The session `quote` settled in, where it is a close rather than a dealer board's standing
   *  price. A close dated by anything else — the block's own day, the instant it was read — is a
   *  level from one session under another session's label. */
  readonly closedOn?: TradingDay
  readonly changePct?: number
  readonly turnover?: number
  /** Present only while the market trades and the reading is fresher than the settled close in
   *  `quote`, so a closed session's close is never restated as current. */
  readonly live?: LiveIndexReading
}

export interface MarketBreadth {
  readonly advancers: number
  readonly decliners: number
  readonly netAdvancers: number
  /** Names with a measurable session — the denominator the counts below are out of. */
  readonly measured: number
  /** Names pinned to the daily band. Only a market that bands its prices reports them. */
  readonly ceilings?: number
  readonly floors?: number
  /** Advancers divided by advancers plus decliners. Absent when no name settled today. */
  readonly advanceRatio?: number
  /** Share of `ma50Measured` trading above its own 50-session mean. */
  readonly aboveMa50Ratio?: number
  /** Names with enough history to place a 50-session mean — the denominator `aboveMa50Ratio` is out
   *  of, which is never `measured`: a name that settled today may still be too young to rank. */
  readonly ma50Measured?: number
  /** How far the market's index sits above its own 50-session mean, from the last close. Absent
   *  for a market that publishes no index. */
  readonly indexToMa50Pct?: number
  /** How far that mean has moved over its slope window. Absent alongside `indexToMa50Pct`. */
  readonly ma50SlopePct?: number
  /** Names at a 52-week high this session. */
  readonly newHighs?: number
  /** Names at a 52-week low this session. */
  readonly newLows?: number
  /** How many names trade above each mean, plus where today sits in its own history. The percentile
   *  table is keyed by the same ids the screen publishes, so the two tell one story. */
  readonly components?: MarketBreadthComponents
}

/** Above/below each moving average across the measured universe, and where the broad tape sits in its
 *  own recent distribution. */
export interface MarketBreadthComponents {
  readonly above20: number
  readonly below20: number
  readonly above50: number
  readonly below50: number
  /** Today's breadth percentile within each series' own window. Partial: a market reports what its
   *  sources carry, and the recap renders only the entries present. */
  readonly percentiles: Partial<Record<PercentileId, PercentileEntry>>
}

/** One name and the session number it is ranked by, in the market's currency. */
export interface MarketLeader {
  readonly instrument: InstrumentRef
  readonly value: number
  /** This name's value as a share of the session's total for its list (gross buys or gross sells
   *  for a foreign-flow list) — how concentrated the top is. */
  readonly sharePct?: number
  /** This name's own move this session, so a list ranked by money is never read as one ranked by
   *  price. Absent where the name has no settled bar in the session being reported. */
  readonly changePct?: number
}

/** Where the session's money went, by name — each list strongest first and bounded by the market's
 *  own limit. Net flow stays signed, so a sell reads as the outflow it was. A list this market does
 *  not measure, or that nobody qualified for, is absent rather than empty. */
/** The window a ranked list was measured over. A board that closes reports the session it closed; a
 *  market that never closes reports its provider's rolling day. The same heading over both is two
 *  different numbers, so the window travels with the rows and titles them. */
type ReadWindow = 'session' | 'rolling-24h'

export interface MarketLeaders {
  readonly window: ReadWindow
  /** How many sessions every list here sums over, where the window is sessions at all. The same
   *  label over a different span is a different number, and the brief's flow sections measure a
   *  longer one. Absent for a rolling window, which has no session count to state. */
  readonly sessions?: number
  readonly foreignBuys?: readonly MarketLeader[]
  readonly foreignSells?: readonly MarketLeader[]
  readonly mostTraded?: readonly MarketLeader[]
}

/** One board's own session numbers, for a market that lists on more than one. A market with a
 *  single board publishes none of these: its totals are already the whole answer, and a lone board
 *  row would only restate them. */
export interface MarketBoard {
  readonly board: string
  readonly breadth?: MarketBreadth
  readonly turnover?: number
  readonly foreignNetValue?: number
}

/** One name's move this session, and the money it moved on. Separate from `MarketLeaders`, whose
 *  lists sum a declared window: a mover is always exactly one session, the overview's own. */
export interface MarketMover {
  readonly instrument: InstrumentRef
  readonly changePct: number
  readonly turnover: number
}

/** The id every surface titles a mover list by: the brief section, the settled field and the screen
 *  block all name the window rather than each deciding what "movers" meant. */
export const MOVER_KIND = Object.freeze({
  session: 'movers-session',
  'rolling-24h': 'movers-24h',
} as const satisfies Record<ReadWindow, string>)

/** The same, for the traded-value ranking. It reads the same board the movers do — every crypto
 *  provider publishes a rolling 24-hour volume — so one list called the window and the other called
 *  it a session, off one number. One map over both namespaces the way `MOVER_KIND` already is: the
 *  brief section and the settled field share these ids, which is what a second name for the same
 *  ranking would have cost. Only the session arm has a settled field today, because the only region
 *  owner that ranks by traded value is a board that closes. */
export const LEADER_KIND = Object.freeze({
  session: 'leaders',
  'rolling-24h': 'leaders-24h',
} as const satisfies Record<ReadWindow, string>)

/** The two extremes of that window, each strongest first. Absent where a market publishes no
 *  per-name change, or where nobody cleared the liquidity floor the market ranks above. */
export interface MarketMovers {
  readonly window: ReadWindow
  readonly gainers: readonly MarketMover[]
  readonly losers: readonly MarketMover[]
}

/** Share of a settled session's volume where the buyer crossed the spread, dated by that session
 *  rather than by the block. A market that never closes dates its block by the live board it reads,
 *  which is always a session ahead of this — printed bare, the figure read as today's. */
export interface MarketTakerFlow {
  readonly at: TradingDay
  readonly buyPct: number
}

/** Where the market trades against its own recent swing, in its own scale. The two percentages are
 *  the fraction distance to each edge from the market's current reading, or from the last close
 *  when it is not quoting - what a stop and a target are sized from. Either goes negative once the
 *  quote leaves the swing the closes drew. */
export interface MarketRange {
  /** Closes the swing was drawn over. A distance to support states nothing without it: the same 2%
   *  is a tight range over twenty sessions and a quiet year over three hundred. */
  readonly sessions: number
  readonly support: number
  readonly resistance: number
  readonly supportPct: number
  readonly resistancePct: number
}

/** Median valuation across the measured universe. A median, not a mean, because a handful of
 *  loss-makers and banks with negative earnings would pull a mean somewhere it describes no name. */
export interface MarketRatios {
  readonly medianPe: number
  readonly medianPb: number
}

/** The derivatives stack the brief reads as crowding evidence: funding, open interest, long/short. */
export interface MarketDerivatives {
  /** Newest print behind these readings. Funding is a mean over a window and open interest is a
   *  latest value, so the pair is dated by an instant rather than by a session. */
  readonly observedAt: number
  readonly fundingDailyPct: number
  readonly windowDays: number
  /** Notional standing open, in the contract's quote currency. */
  readonly openInterestUsd?: number
  /** Latest OI over the mean of the `sessions` daily readings ending on it, measured on contract
   *  count rather than on the notional above it — see `FundingSnapshot.openInterestRatio`, which
   *  this carries verbatim. */
  readonly openInterestRatio?: { readonly value: number; readonly sessions: number }
  readonly longShortRatio?: number
}

/** The mean session turnover a `turnoverRatio` is measured against. */
export interface MarketTurnoverReference {
  readonly sessions: number
  readonly value: number
}

/** The session's roll-ups across the market, in its currency. Every field is optional because each
 *  market publishes what its own sources carry; absent means not published, never zero — a desk
 *  that was not reported did not trade nothing. */
export interface MarketDataOverview {
  /** Carried on the result, not supplied by the caller: an overview travels beside three others
   *  when no market was named, and a level with no market on it is a claim about nothing. */
  readonly market: MarketRef
  /** The session every roll-up below was measured at. Never the newest day anything in the read
   *  reports: a live index row runs ahead of the stored tape all morning, and dating the roll-ups
   *  by it stamps one session's breadth, turnover and flows under the next one's date. Each row
   *  carries its own `closedOn`, so the rows lose nothing by this naming the settled tape. */
  readonly asOf: TradingDay
  /** The market's state at read time — a different fact from `asOf`, which names the session the
   *  numbers describe. Open beside a trailing `asOf` means today's session has no rows yet. */
  readonly sessionState?: TradingSessionState
  /** The same instant as `sessionState`, resolved against the calendar's trading days so a surface
   *  can name it: the state union reports one `closed` for a lunch break and a holiday, which is
   *  the wrong word half the time it is printed. */
  readonly sessionPhase?: SessionPhase
  readonly currency: CurrencyCode
  /** What the rows' prices are quoted in, where they are money at all. Absent for a market that
   *  publishes index levels: a level has no denomination, and labelling one with the market's
   *  currency states a unit it does not carry. */
  readonly priceCurrency?: CurrencyCode
  /** The manifest's block glyph, carried on the read so a renderer can head this market's block
   *  without reaching into the market registry. */
  readonly icon: string
  /** The composite this market's segment is actually gated by. Absent only where that same read
   *  already heads the whole message — the owner of the operator's own region — and on a market
   *  with no macro capability. A market owning any other region publishes here or nowhere. */
  readonly macro?: MacroRiskView
  readonly rows: readonly MarketDataOverviewRow[]
  /** The boards the roll-ups below were measured over. A total without it reads as the whole
   *  market, which no measured universe is. */
  readonly universe?: string
  readonly breadth?: MarketBreadth
  /** The session running now, where the market publishes a live board and it is not the one
   *  `breadth` already settled. */
  readonly intraday?: MarketIntradayBreadth
  /** Traded value across the measured universe this session. */
  readonly turnover?: number
  /** This session's turnover over the mean of the prior reference window — how busy today was
   *  against a normal session. */
  readonly turnoverRatio?: number
  /** What that ratio divides by: every window yields a different multiple. */
  readonly turnoverReference?: MarketTurnoverReference
  readonly foreignNetValue?: number
  readonly proprietaryNetValue?: number
  /** Capitalisation of the market's whole universe. */
  readonly marketCap?: number
  /** The largest constituent's share of `marketCap`, as a percentage — how concentrated the market
   *  is in one name. Bitcoin dominance, where the market is crypto. */
  readonly largestSharePct?: number
  /** Below this share of the universe above its own mean, a falling index is broad rather than a
   *  handful of heavyweights. The market's own calibration of its tape; absent for one whose
   *  universe carries no such reading, which then gets no session sentence. */
  readonly narrowDeclineBelowPct?: number
  /** Whatever index the market's sentiment source publishes, with its own classification. */
  readonly sentiment?: SentimentSnapshot
  /** How far this market's board trades above the world reference it derives from, as a fraction. */
  readonly premium?: number
  /** Where the market trades within its own recent swing. */
  readonly range?: MarketRange
  /** The derivatives stack: funding, open interest, and the long/short account ratio. */
  readonly derivatives?: MarketDerivatives
  /** Who was crossing the spread, and the session that was. Present only for a market whose venue
   *  states the aggressor side; nothing scores it. */
  readonly takerFlow?: MarketTakerFlow
  /** Spot-ETF net flows for this market, when a flow source serves it. */
  readonly etfFlows?: EtfFlowSnapshot
  /** Speculative positioning from a COT-style report, when one resolves. */
  readonly positioning?: PositioningSnapshot
  /** Where today's premium sits in its own stored history, with the window it was ranked over.
   *  One value, because a rank whose span is not stated is a number no reader can size. */
  readonly premiumRank?: PremiumRank
  /** Median price ratios across the measured universe, in the market's currency. */
  readonly ratios?: MarketRatios
  readonly leaders?: MarketLeaders
  /** The session's biggest movers, above the market's own liquidity floor. */
  readonly movers?: MarketMovers
  /** The same session, per board, where the market lists on more than one. The totals above stay
   *  the market's answer; these are what a reader checks against one exchange's own summary. */
  readonly boards?: readonly MarketBoard[]
  readonly provenance: readonly SourceProvenance[]
  readonly caveats: readonly Caveat[]
}
