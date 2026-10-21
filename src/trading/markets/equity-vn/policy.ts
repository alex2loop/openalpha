import type { CalendarPolicy } from '@/trading/kernel/config'
import type { LevelPolicy } from '@/trading/kernel/factor'
import type {
  BoardLotPolicy,
  DailyPriceBandPolicy,
  InstrumentKind,
  PriceDisplay,
  Ticker,
  TickSizePolicy,
} from '@/trading/kernel/instrument'
import type { MacroSeriesId } from '@/trading/kernel/market/macro-series'
import type { RefreshDataKind } from '@/trading/kernel/market/refresh'
import type { AdmissionPolicy } from '@/trading/markets/admission'
import type { MacroDriverPolicy } from '@/trading/markets/macro-risk'
import { MS_PER_DAY } from '@/core/utils/time'
import { currencyCode, fxPair, marketRef, region, ticker } from '@/trading/kernel/instrument'
import { VN_EXCHANGE_HOLIDAYS } from '@/trading/markets/equity-vn/holidays'
import { US_DRIVER_BANDS } from '@/trading/markets/macro-risk'

/** Bumped whenever a parameter changes what this market suggests: the version is part of a
 *  suggestion's identity, so a stored one is never reused, or scored, across two parameterizations. */
export const VN_STRATEGY_VERSION = '1.0.0'
export const VN_MARKET_REF = marketRef('equity-vn')
export const VN_MARKET_REGION = region('vn')
/** Where VN's global macro drivers are published. The real-rate and US-yield series are US facts;
 *  asking for them under the VN region would route to the domestic provider and find nothing. */
export const VN_GLOBAL_MACRO_REGION = region('us')
/** The đồng price of a dollar: the pair the VN book converts through and the confirmer measures. */
export const VN_FX_PAIR = Object.freeze({
  fromCurrency: currencyCode('USD'),
  toCurrency: currencyCode('VND'),
})
export const VN_BRIEF_FX_PAIR = fxPair(VN_FX_PAIR.fromCurrency, VN_FX_PAIR.toCurrency)

/** The exchanges this market knows the rules for. The universe admits HOSE and HNX
 *  (`ADMITTED_EXCHANGES`), but tradeability answers for whatever exchange a stored record names, so
 *  all three tables live here rather than a HOSE-shaped assumption spreading through the market. */
export const VN_EXCHANGES = Object.freeze(['HOSE', 'HNX', 'UPCOM'] as const)
export type VnExchange = (typeof VN_EXCHANGES)[number]

export const PRIMARY_EXCHANGE: VnExchange = 'HOSE'

/** The boards a name may list on to enter the universe. UPCoM is out: 821 names on a ±15% band,
 *  most of them below every screen gate, and a board that wide wins any move ranking on volatility
 *  alone. HOSE and HNX each have their own band and tick table below, so both price correctly. */
export const ADMITTED_EXCHANGES: readonly VnExchange[] = Object.freeze(['HOSE', 'HNX'])

/** Post-KRX session model (live since 2025-05-05), Asia/Ho_Chi_Minh. Continuous trading runs
 *  09:15-11:30 and 13:00-14:30; the ATC call auction runs to 14:45, which is the last instant a
 *  price is discovered, so that is the calendar's close. HNX matches PLO orders until 15:00, but
 *  only at the closing price already fixed at 14:45, so nothing after the bell moves the reading a
 *  settled session stands for. The 11:30-13:00 lunch gap is the calendar's break — auction phases
 *  are tradeability facts, not calendar states. HNX determines its open by reference price rather
 *  than an ATO auction; that difference is a per-exchange calendar override in config, never an
 *  assumption baked in here. */
export const VN_CALENDAR: CalendarPolicy = Object.freeze({
  timezone: 'Asia/Ho_Chi_Minh',
  sessionOpenLocalTime: '09:00',
  sessionCloseLocalTime: '14:45',
  breakStartLocalTime: '11:30',
  breakEndLocalTime: '13:00',
  weekendDays: Object.freeze([0, 6]),
  holidays: VN_EXCHANGE_HOLIDAYS,
  continuous: false,
})

/** HOSE ticks are tiered by price with breakpoints at 10,000 and 50,000 VND. Reading those as
 *  50,000/100,000 inflates every tick and rounds levels onto a grid the exchange does not use. */
export const HOSE_SHARE_TICK: TickSizePolicy = Object.freeze({
  bands: Object.freeze([
    { maximumPriceExclusive: 10_000, tickSize: 10 },
    { maximumPriceExclusive: 50_000, tickSize: 50 },
    { tickSize: 100 },
  ]),
})

/** HNX and UPCOM quote shares on a flat 100 VND grid — one band, not the HOSE table. */
const FLAT_SHARE_TICK: TickSizePolicy = Object.freeze({
  bands: Object.freeze([{ tickSize: 100 }]),
})

/** ETFs and covered warrants trade on a flat 10 VND tick at any price, on every exchange. */
export const FUND_TICK: TickSizePolicy = Object.freeze({
  bands: Object.freeze([{ tickSize: 10 }]),
})

export const SHARE_TICK_BY_EXCHANGE: Readonly<Record<VnExchange, TickSizePolicy>> = Object.freeze({
  HOSE: HOSE_SHARE_TICK,
  HNX: FLAT_SHARE_TICK,
  UPCOM: FLAT_SHARE_TICK,
})

/** A VN share's par value: common share capital over it is the share count. */
export const VN_SHARE_PAR_VND = 10_000

/** Hitting a band caps the matchable price; it does not halt the name. A stock can trade at its
 *  ceiling all session, which is why `ceiling-locked` is a screen gate and a tradeability caveat
 *  rather than a trading status. */
export const DAILY_BAND_BY_EXCHANGE: Readonly<Record<VnExchange, DailyPriceBandPolicy>> =
  Object.freeze({
    HOSE: { maximumUpPct: 0.07, maximumDownPct: 0.07 },
    HNX: { maximumUpPct: 0.1, maximumDownPct: 0.1 },
    UPCOM: { maximumUpPct: 0.15, maximumDownPct: 0.15 },
  })

/** Levels are priced off the quote the run read, and a session inside HOSE's ±7% band can still
 *  carry a name past them. Below parity the stored entry, stop, and target describe a trade that no
 *  longer pays for the risk it carries. */
export const VN_MINIMUM_RISK_REWARD = 1

/** A newly listed name, and the first session back after a 25-session suspension, trades under a
 *  widened band. It is a per-day override plus a caveat — never an absent band, which would leave
 *  levels unclamped on exactly the most volatile session a name ever has. */
export const FIRST_DAY_BAND_BY_EXCHANGE: Readonly<Record<VnExchange, DailyPriceBandPolicy>> =
  Object.freeze({
    HOSE: { maximumUpPct: 0.2, maximumDownPct: 0.2 },
    HNX: { maximumUpPct: 0.3, maximumDownPct: 0.3 },
    UPCOM: { maximumUpPct: 0.4, maximumDownPct: 0.4 },
  })

/** 100 shares on all three exchanges. Odd lots (1-99) trade only in a dedicated session and never
 *  enter sizing, which floors to this lot. */
export const BOARD_LOT: BoardLotPolicy = Object.freeze({ size: 100 })

/** VN boards, and every broker app, quote in thousands of dong to two decimals: 27.55 means 27,550.
 *  Storage stays in whole dong; only human-facing prices are converted. */
export const VN_BOARD_PRICE_DISPLAY: PriceDisplay = Object.freeze({ divisor: 1000, decimals: 2 })

/** T+2 trading days. Every settlement question reads this one value, so the widely expected T+1
 *  shortening is a manifest edit rather than a hunt for hardcoded twos. */
export const SETTLEMENT_SESSIONS = 2

/** Public companies default to a 100% foreign cap (Decree 155/2020, art. 139). 50% applies only to
 *  conditional sectors without a specific cap, and banks default to 30%. The
 *  effective cap is per-instrument data; these are the fallbacks when the record carries none. */
export const DEFAULT_FOREIGN_ROOM_FRACTION = 1
export const BANK_FOREIGN_ROOM_FRACTION = 0.3
/** Decree 69/2025 (effective 2025-05-19) lifts the cap to 49% for the banks executing an approved
 *  compulsory-transfer plan, for the plan's duration. */
export const COMPULSORY_TRANSFER_BANK_ROOM_FRACTION = 0.49
export const COMPULSORY_TRANSFER_BANK_TICKERS: readonly Ticker[] = Object.freeze([
  ticker('MBB'),
  ticker('HDB'),
  ticker('VPB'),
])
/** Canonical form: a provider's own `Banks` never matches, and the miss reads as an uncapped bank. */
export const BANK_SECTOR = 'banks'

/** Above this, debt service dominates the equity story regardless of what the tape says. */
export const MAXIMUM_DEBT_TO_EQUITY = 3
/** A bank's ceiling, read as assets to equity rather than debt to equity: the provider publishes no
 *  debt-to-equity ratio for a single VN bank, so the equity-side floor never fired on exactly the
 *  names that carry the most leverage. Recovered from the DuPont identity - assets to equity is
 *  return on equity over return on assets, and both are published for every name. The level is not
 *  comparable to the equity ceiling beside it, and it sits above the whole sector rather than inside
 *  it: across all 24 listed banks on 2026-09-16 the spread ran 6,5 to 18,1, median 12,1, with no gap
 *  anywhere in it, and the World Bank puts the system at 11,7 on its own capital-to-assets series -
 *  close enough to hold the DuPont reading honest. That series also ran 17 to 19 every year from
 *  2015 to 2019, so a line in the mid-teens is one the entire country's banking sector has sat above
 *  within the decade. This clears the system's worst year, which is what makes it an outlier test
 *  rather than a reading of the business model. */
export const MAXIMUM_BANK_ASSETS_TO_EQUITY = 20
export const MINIMUM_RETURN_ON_EQUITY_PCT = 8
export const MINIMUM_NET_MARGIN_PCT = 5
/** Strong returns excuse a thin margin: one weak component is a business model, not a warning. */
export const STRONG_RETURN_ON_EQUITY_PCT = 20

/** Policy, not regulation: below this much remaining room a foreign buy is unfillable rather than
 *  merely tight. In money, not percentage points — three percent of a large bank is thousands of
 *  tỷ, an amount this operator never fills. Set at `MINIMUM_MEDIAN_TURNOVER_VND`, this file's
 *  smallest transactable amount. */
export const MINIMUM_FOREIGN_ROOM_VND = 10_000_000_000

/** How far back the weekly room sweep looks for each ticker's latest row, in trading days: long
 *  enough to span a holiday stretch, short enough that a delisted name's stale row drops out. */
export const FOREIGN_ROOM_LOOKBACK_SESSIONS = 7

/** Buy minus sell over the two of them, so the scale is -1 to 1 and the auction prints sit outside
 *  it: they have no aggressor, and one ATC print was 15.7% of VNM's session on 2026-08-26, so
 *  counting them either way would manufacture pressure nobody applied. The threshold is chosen
 *  rather than measured, which is why the stage only reports it. Revisit once ~30 resolved
 *  suggestions carry `market.distribution-session`, by comparing their returns against unflagged
 *  rows from the same period and market. */
export const DISTRIBUTION_BALANCE_AT = -0.2
/** Below this much classified volume the ratio is noise rather than a reading, whichever way it
 *  points. A hundred board lots: the screen's liquidity gate already excludes names that trade this
 *  thinly, so this only catches a session where one of them barely traded at all. */
export const TRADE_SIDES_MINIMUM_VOLUME = BOARD_LOT.size * 100

/** How far ahead a statutory reporting deadline is worth naming. Beyond this the reader will have
 *  reviewed the position again before it matters. */
export const REPORT_NOTICE_DAYS = 21
/** Months whose third Friday closes an FTSE GEIS review; MarketVector reviews on the same day. */
export const FTSE_REVIEW_MONTHS = Object.freeze([3, 6, 9, 12] as const)
/** Months whose first Monday makes a HOSE index review effective; the rebalance trades the session
 *  before. February and August change the VN30's members; May and November reweight it and change
 *  VNDiamond's, and the passive money moves on all four. */
export const HOSE_REVIEW_MONTHS = Object.freeze([2, 5, 8, 11] as const)
/** How far past a fiscal period end the accounts may sit before the ratios stop describing the
 *  business. A VN issuer files the following quarter within twenty days of its close, so at a full
 *  quarter plus the filing window plus three weeks of slack the issuer has missed a deadline rather
 *  than merely not reached one. Counted in calendar days because a statutory deadline is. */
export const REPORT_OVERDUE_DAYS = 135

/** The target is a multiple of the rounded risk, not an ATR multiple of its own: measured from
 *  ATR it lost ticks independently of the stop, and a 15-tick VN30 bank landed at 1.47. The long
 *  stop is three ATRs: at two, every stored plan sat inside one limit-down session and under the
 *  two-session settlement drawdown printed beside it, and the debate's own invalidator (a close
 *  under the 50-session average) lay twice as far below entry as the stop did. The trail hangs the
 *  stop from the highest close of a trading month so a name that ran keeps what it gained; an
 *  entry-relative stop on a long-horizon book otherwise never moves until the plan is spent.
 *
 *  That trail also clamps a fresh entry, and a VN entry is the close rather than a breakout, so the
 *  window high sits above it on every name that is not making a new high and the stop is the trail
 *  multiple less the pullback. Measured across the screened board on 2026-09-22 it bound on 63 of
 *  105 names, cut the median plan a quarter inside its designed distance and the deepest one to a
 *  fortieth, and left twelve stops inside a single session's own range. One ATR is the floor under
 *  it: a session's typical range is the least a stop can sit outside and still be answering the
 *  thesis rather than the noise. It widens a fifth of the board and moves no target, because the
 *  risk the target and the size read is the designed three ATRs either way.
 *
 *  A fund leaves whole at its review level, so it banks nothing before the target. */
export const VN_FUND_LEVEL_POLICY: LevelPolicy = Object.freeze({
  atrSessions: 14,
  stopVolatilityMultiplier: { short: 1.5, long: 3 },
  targetRiskMultiplier: { short: 1.5, long: 3 },
  trail: Object.freeze({ sessions: 22, volatilityMultiplier: 3, minimumStopMultiplier: 1 }),
})

/** A share banks its first third one risk unit out. Measured on the stored board, one trade per
 *  name at a time with the stop, trail and T+2 as they run: the long target at nine ATRs was
 *  reached by 3% to 14% of entries, one risk unit by 13% to 36%, with no measurable change in what
 *  the trade returned, because the rest rides the trail either way. */
export const VN_LEVEL_POLICY: LevelPolicy = Object.freeze({
  ...VN_FUND_LEVEL_POLICY,
  takeProfitRiskMultiplier: { short: 1, long: 1 },
})

/** A year of sessions: the horizon the published Vietnamese turnover factor is measured over, and
 *  long enough that one crowded fortnight does not read as a year of speculation. */
export const SPECULATIVE_TURNOVER_SESSIONS = 250

export const MOMENTUM_SESSIONS = 60
export const TREND_SESSIONS = 50
export const TREND_SLOPE_SESSIONS = 10
export const LONG_TREND_SESSIONS = 200
export const LONG_TREND_SLOPE_SESSIONS = 20
export const LIQUIDITY_SESSIONS = 20
export const TRADING_FREQUENCY_SESSIONS = 60
/** The baseline a session's volume is unusual against. Twenty sessions is roughly a trading month,
 *  long enough to average out a single quiet week without reaching back into a different regime. */
export const RELATIVE_VOLUME_SESSIONS = 20

export const VOLATILITY_SESSIONS = 20
/** The trailing year the 52-week anchor is measured over, in sessions. A VN year is ~249 sessions
 *  (260 weekdays minus ~11 exchange holidays), so the threshold sits below that with slack for
 *  long-holiday years — at 250 the factor never fired. */
export const HIGH_PROXIMITY_SESSIONS = 240
export const FLOW_DEVIATION_SESSIONS = 20
/** The factor reads flow over a month, not days: persistent foreign accumulation predicts, while
 *  single-session spikes are the noise the feedback-trading literature says to ignore. */
export const FLOW_PERSISTENCE_SESSIONS = 20
export const FLOW_PERSISTENCE_MINIMUM_SESSIONS = 10
/** The advance a tape signal is measured against, and how many sessions it runs over. */
export const TAPE_RUN_SESSIONS = 4
export const TAPE_RUN_MINIMUM_FRACTION = 0.03
/** A session's foreign net, as a share of turnover, this far from its trailing mean in standard
 *  deviations reads as a flip rather than noise. */
export const FOREIGN_FLIP_Z = 2
/** What a flows fetch must ask for: the deviation window plus warm-up, because alignment drops any
 *  session with no matching turnover and a window sized to the factor's exact need would fall under
 *  it the first time a name did not trade. */
export const VN_FLOW_SESSIONS = FLOW_DEVIATION_SESSIONS + 20
/** Refetched behind the newest stored flow so a late correction to a settled session is picked up. */
export const VN_FLOW_TAIL_SESSIONS = 10
/** How far back a sell-side rating still counts as current coverage. Roughly two reporting
 *  quarters: long enough that a thinly-covered name has any consensus at all, short enough that a
 *  rating written against different earnings is not summed into today's. */
export const VN_RECOMMENDATION_SESSIONS = 120
/** An overview needs the last two sessions; the window is wider so a holiday or a halted session
 *  still leaves two bars in it. */
/** How many names each overview leader list carries. A recap names who the money went to; the
 *  whole book is what `/screen` is for. */
export const VN_OVERVIEW_LEADERS = 5

export const VN_OVERVIEW_SESSIONS = 5
/** Sessions the short moving-average breadth compares against — the 20-day mean. */
export const VN_TURNOVER_REFERENCE_SESSIONS = 20
/** Reading order for the boards, largest first. Alphabetical puts HNX above HOSE, which is not how
 *  any VN summary is read. A board absent here sorts after these, by name. */
export const VN_BOARD_ORDER: readonly string[] = Object.freeze(['HOSE', 'HNX', 'UPCOM'])

export const VN_MA_SESSIONS = 50
export const SECTOR_SHORT_SESSIONS = 20
export const SECTOR_LONG_SESSIONS = 60

/** Slack on top of the deepest window, spent twice over: the calendar counts weekdays while a
 *  factor counts traded sessions, so a year's ~11 holidays go before a name misses a day of its
 *  own. Sized against the long-trend chain alone, it left 11% of the board without a 52-week high. */
const EVIDENCE_SLACK_SESSIONS = 40

/** The deepest window any factor needs, plus the slack above, is what a bars read must ask for.
 *  One constant so a factor deepening its window cannot silently outrun the fetch. */
export const VN_EVIDENCE_SESSIONS =
  Math.max(LONG_TREND_SESSIONS + LONG_TREND_SLOPE_SESSIONS, HIGH_PROXIMITY_SESSIONS) +
  EVIDENCE_SLACK_SESSIONS
/** A pre-open run sees no bar for `asOf` yet, so one session behind is normal and two is not. */
export const VN_MAX_EVIDENCE_LAG_SESSIONS = 1

/** How many settled sessions a kind's stored attempt stays good for. Prices and flows restate
 *  every session; ratios restate on a reporting calendar, so refetching them daily is unforced
 *  provider traffic. The universe has its own weekly replacement in `isUniverseStale`. */
export const REFRESH_STALE_SESSIONS: Readonly<Record<RefreshDataKind, number>> = Object.freeze({
  instruments: 1,
  bars: 1,
  fundamentals: 5,
  flows: 1,
  macro: 1,
  accounts: 1,
  premium: 1,
})

/** How long a replayed attempt keeps the targets it lost before asking for them again. Short
 *  enough that a transient outage heals within the session, long enough that a name no provider
 *  can serve costs one repair rather than one per command. */
export const VN_REPAIR_COOLDOWN_MS = 900_000

/** Below this a sector cannot supply a stable ranking of its own, so its members rank against the
 *  other thin sectors pooled together rather than against three peers. */
export const SECTOR_RANK_MINIMUM_MEMBERS = 10

export const MINIMUM_HISTORY_SESSIONS = 120
/** Two questions hide in one number, and only the second is absolute. Capacity — can this book
 *  enter and leave? — is a function of position size: at a 200 million VND position, a name turning
 *  over 200M trades it in a tenth of a session. Market quality — is this price a market at all? —
 *  is what the floor still has to answer once capacity is satisfied, and below roughly a tenth of
 *  this a VN name prints a handful of trades whose spread outruns any edge. The exchange's own bar
 *  sits higher: VN30 (HOSE-Index ground rules v4.0, July 2025 review) requires a 12-month median of
 *  30B VND/day or 300k shares/session, up from 10B/100k in v3.0. At 0.2B a nostro trading KLB (5.1B
 *  median) looks liquid versus a dead tail (p50 0.59B) while being 47x thinner than MBB (245B). The
 *  raised floor keeps the screen comparable across deposits while ensuring a tenth of a session
 *  covers a realistic ticket (5-10B -> 500M-1B per tenth). Revisit above roughly 2 tỷ NAV. Applied
 *  to the window's median: a few block-trade sessions cannot stand in for a tape otherwise dead. */
export const MINIMUM_MEDIAN_TURNOVER_VND = 10_000_000_000
/** A fund's on-screen turnover is not its market quality: creation and redemption through
 *  authorised participants hold its price to the basket it holds, so a thin tape still prints a
 *  real price. On-screen is still this book's only way out - a creation lot is at least 100.000
 *  chứng chỉ quỹ - so the floor answers capacity alone, a fifth of a session for a 200 million
 *  ticket. That admits two funds outright and a third most sessions; the fourth with any secondary
 *  market at all sits just under it. There is no gap to move the floor into — measured over 120
 *  sessions the candidates' ranges overlap continuously from 0,05 tỷ up, so any level flickers some
 *  fund in and out, and this one at least states the capacity rule it came from. */
export const MINIMUM_ETF_MEDIAN_TURNOVER_VND = 1_000_000_000
/** Where a fund's daily dispersion against its own index stops being tracking and starts being the
 *  wrapper's own price: roughly a VN index's daily volatility. A fund this far off its basket each
 *  session is a cost the buyer pays on the way in and out, so the suggestion says so — but it is not
 *  a reading of the index, which is the whole of what the fund will return, and it was scored as one
 *  until 2026-09-22. Measured that day, it ran 0,54% to 2,84% across the board on a 20-session
 *  window and gave two funds on one index opposite verdicts. */
export const WIDE_TRACKING_ERROR = 0.01
/** The board `/screen` answers with when no kind is named. A fund composite averages two factors
 *  and a stock composite six, so a mixed board sorts two spreads and the fund tops it on
 *  arithmetic; the fund board is its own request. */
export const DEFAULT_SCREEN_KIND: InstrumentKind = 'equity'
/** Turnover and size answer different questions, and a name can clear the first while failing this
 *  one badly: the smallest names on the board traded several times the liquidity floor while
 *  turning over three percent of their whole capitalisation a day, which is a rotation rather than
 *  a market an operator can enter and leave. Set an order of magnitude below the median listing. */
export const MINIMUM_MARKET_CAP_VND = 1_000_000_000_000
/** Share of outstanding stock that actually trades. MSCI's investable-universe floor; below it a
 *  sliver of the register sets the price and turnover clears on a float nobody can exit through. */
export const MINIMUM_FREE_FLOAT_PCT = 15
/** A mover has to have moved on real money: below this much traded in the session itself, a name at
 *  its ceiling is a shell, not news. The same figure as the screen's median floor and deliberately
 *  not the same constant — that one measures an ordinary session over a window, this one measures
 *  the single session being reported. */
export const MINIMUM_MOVER_TURNOVER_VND = 10_000_000_000

/** Share of the frequency window a name must trade on. MSCI's emerging-market floor; below it the
 *  series is mostly carried-forward closes, and every price statistic taken from it is fiction. */
export const MINIMUM_TRADING_FREQUENCY_FRACTION = 0.8
/** Daily close-to-close stdev, matching `realizedVolatility`'s un-annualized units. A HOSE name
 *  banded at +-7% cannot exceed this for long without being untradeable rather than volatile. */
export const MAXIMUM_DAILY_VOLATILITY = 0.06
/** Within this much of the ceiling the last close counts as locked: a name that closed on its
 *  ceiling cannot be bought at a sane price the next morning. */
export const CEILING_LOCK_PROXIMITY_FRACTION = 0.005

/** Repeated ceiling closes mark a pump: the documented pattern is one more session of continuation
 *  — unreachable for a T+2 buyer — then reversal. */
export const LIMIT_HIT_LOOKBACK_SESSIONS = 10
export const LIMIT_HIT_MAXIMUM = 3
/** A close counts as a limit hit at this share of the band: tick rounding means an adjusted series
 *  rarely lands on the exact ceiling ratio. */
export const LIMIT_HIT_TOLERANCE_FRACTION = 0.9

/** What a failed screen gate costs a named VN ticker. `ceiling-locked` is absent because the band
 *  edge is already the levels block, and `no-price-history` because a name with no series has no
 *  levels to size. A pumped or thinly-traded name is still analysable, just less trustworthy.
 *
 *  `volatility-above-maximum` is absent because it can never be reached: the two names in the whole
 *  stored universe that clear `MAXIMUM_DAILY_VOLATILITY` are both names that barely trade, so they
 *  fail `below-minimum-traded-sessions` first and admission blocks before it reads this table. The
 *  gate itself stays — it is a live outlier test on the screen. */
export const VN_ADMISSION: AdmissionPolicy = Object.freeze({
  blocking: Object.freeze({
    'abnormal-trading-status': 'market-not-tradeable',
    'below-minimum-traded-sessions': 'market-not-tradeable',
    'under-trading-restriction': 'market-not-tradeable',
    'insufficient-history': 'insufficient-data',
  }),
  lowering: Object.freeze({
    'below-minimum-turnover': 'suggestion.turnover-below-minimum',
    'below-minimum-market-cap': 'suggestion.market-cap-below-minimum',
    'below-minimum-free-float': 'suggestion.free-float-below-minimum',
    'recent-limit-hits': 'suggestion.recent-limit-hits',
    'under-supervision': 'suggestion.under-supervision',
  }),
})

export const MINIMUM_SECTOR_MEMBERS = 3
/** Realized volatility above the roll-up's own tolerance discounts a sector's score, once. */
export const SECTOR_VOLATILITY_PENALTY = 0.25
/** Below this share of the universe carrying a sector, the ranking is a ranking of a third of the
 *  market wearing the market's authority. */
export const MINIMUM_SECTOR_COVERAGE_FRACTION = 0.6

export const DOWNSIDE_BAND_PROXIMITY_FRACTION = 0.15
export const MARGIN_CASCADE_UNIVERSE_FRACTION = 0.1
/** Two separate reports, not two mirrors of one: the threshold counts stories because that is what
 *  grouping produces, and one wire item syndicated widely is one report. */
export const MINIMUM_POLICY_NEWS_STORIES = 2
export const POLICY_NEWS_ITEMS = 25
/** Foreign selling worse than this share of turnover, averaged over the flow window, fires. */
export const FOREIGN_FLOW_STRESS_RATIO = -0.02

/** A weaker đồng over this many refreshed sessions, by at least this fraction, fires. The window
 *  is one month of sessions: shorter reads a fixing as a trend, longer misses the move the
 *  foreign desk is already selling into. */
export const FX_STRESS_SESSIONS = 20
export const FX_STRESS_DEPRECIATION_FRACTION = 0.02
/** Slack behind the window's far end: the pair prints on its own calendar, so the session one
 *  window back is often one VN traded and the FX tape did not. Writer and reader share it. */
export const FX_STRESS_SCAN_SESSIONS = 10
/** The stored USD/VND series. Written by the refresh, read by the confirmer one window later. */
export const VN_FX_SERIES: MacroSeriesId = 'usd-vnd'

/** Below this share of the market above its own trend, a falling index is broad rather than a
 *  handful of heavyweights. */
export const MINIMUM_TAPE_PARTICIPATION_FRACTION = 0.4

/** VN stress lowers the regime the driver composite produced; it never raises it. That is the
 *  whole asymmetry: macro may only reduce deployable capital, so the multiplier stays the one
 *  `REGIME_SCALE` already owns and a benign VN read simply leaves the base regime alone. Each
 *  confirmer, and a corroborated rate-hike bias, costs one band. */
export const VN_MACRO_FORMULA_VERSION = '1.0.0-vn'

/** The local tape and the price of local money carry the regime; the US price of capital and its
 *  stress gauge still vote, lighter, because foreign flows answer to them. Read off the US alone,
 *  the segment sat defensive through local rallies whenever US real rates ran high. The index trend
 *  is its 200-session distance and slope averaged; breadth is the share of the board above its own
 *  50-session average, banded like crypto's; the 12-month deposit rate is bullish near the 2024
 *  trough (~4,6%) and bearish near the April 2023 stress peak (~7,95%). Chosen anchors, not fitted
 *  ones. */
export const VN_MACRO_DRIVERS: MacroDriverPolicy = Object.freeze({
  weights: Object.freeze({
    'vn-index-trend': 0.3,
    'vn-breadth': 0.2,
    'deposit-rate-12m': 0.2,
    'us-real-rate': 0.1,
    'usd-index': 0.1,
    'us-volatility': 0.1,
  }),
  bands: Object.freeze({
    'vn-index-trend': { kind: 'linear', bearishAt: -10, bullishAt: 10 } as const,
    'vn-breadth': { kind: 'linear', bearishAt: 35, bullishAt: 65 } as const,
    'deposit-rate-12m': { kind: 'linear', bearishAt: 7.5, bullishAt: 5 } as const,
    'us-real-rate': US_DRIVER_BANDS['us-real-rate'],
    'usd-index': US_DRIVER_BANDS['usd-index'],
    'us-volatility': US_DRIVER_BANDS['us-volatility'],
  }),
  units: Object.freeze({
    'vn-index-trend': 'percent',
    'vn-breadth': 'percent',
    'deposit-rate-12m': 'percent',
    'us-real-rate': 'percent',
    'usd-index': 'level',
    'us-volatility': 'level',
  }),
})

/** The market-owned fan-out ceiling for every VN provider read that iterates instruments — evidence
 *  warming and live watchlist events alike. The source pacer still enforces each configured
 *  provider's own rate; this only bounds how many subjects are in flight at once. */
export const VN_SOURCE_CONCURRENCY = 5
/** The instrument feed changes on listing events, not intraday, so the universe is replaced weekly
 *  while evidence keeps the configured refresh cadence. */
export const UNIVERSE_STALE_MS = 7 * MS_PER_DAY
/** A name's annual reports are asked for again once the stored copy is this old: often enough to
 *  pick up a restatement within a month, rarely enough that a pass costs a few names a day. */
export const ACCOUNTS_REFETCH_MS = 30 * MS_PER_DAY
/** A quarter is looked for from this long after it ends until the window closes. Measured on 25
 *  large names over 2025-26: Q1 and Q3 land 15-35 days after the quarter ends, the reviewed
 *  half-year 30-66 days after. */
export const QUARTER_WATCH_FROM_DAYS = 15
export const QUARTER_WATCH_UNTIL_DAYS = 70
/** How often a name whose latest quarter is due is asked again, until the quarter lands. */
export const QUARTER_WATCH_REFETCH_MS = 2 * MS_PER_DAY
/** How far a backup cash flow's year-to-date pre-tax profit may sit from the stored quarters' sum,
 *  as a fraction of the larger magnitude, before the figures are refused. */
export const CASH_FLOW_MATCH_TOLERANCE = 0.005
/** The kind's last fetch older than this means the refetch stopped running. Past the interval by
 *  two weeks, so the one quiet stretch the interval itself creates never reads as stale. */
const ACCOUNTS_STALE_MS = 45 * MS_PER_DAY
/** Kinds whose cadence no session count expresses, judged by the age of their last fetch. */
export const REFRESH_WALL_CLOCK_MS: Readonly<Partial<Record<RefreshDataKind, number>>> =
  Object.freeze({ instruments: UNIVERSE_STALE_MS, accounts: ACCOUNTS_STALE_MS })

export const MINIMUM_UNIVERSE_SIZE = 50
export const VN_INDEX_TICKER = 'VNINDEX'
export const VN30_INDEX_TICKER = 'VN30'

/** Benchmark-only codes: the fund map below is the single place they are named, and the headline
 *  list plus that map are the whole index surface this policy publishes. */
export const VN100_INDEX_TICKER = 'VN100'
const VNDIAMOND_INDEX_TICKER = 'VNDIAMOND'
const VNX50_INDEX_TICKER = 'VNX50'
const VNMIDCAP_INDEX_TICKER = 'VNMIDCAP'
const VNFINLEAD_INDEX_TICKER = 'VNFINLEAD'
const VNFINSELECT_INDEX_TICKER = 'VNFINSELECT'
const VNSHINE_INDEX_TICKER = 'VNSHINE'
const VNMITECH_INDEX_TICKER = 'VNMITECH'

/** The tape this market publishes as its own. Everything else it stores is a reference leg read by
 *  a factor, and a leg on the overview is a row the operator did not ask for. */
export const VN_HEADLINE_INDEX_TICKERS: readonly Ticker[] = Object.freeze([
  ticker(VN_INDEX_TICKER),
  ticker(VN30_INDEX_TICKER),
  ticker(VN100_INDEX_TICKER),
])

/** The index each listed fund replicates, which the fund's own registered name states. Tracking
 *  error, index trend and index momentum are read against this series and nothing else: measured
 *  against VN-Index, a Diamond fund's "tracking error" is the distance between two indices and the
 *  three factors are one number for every fund. A fund absent here abstains on all three — today
 *  that is VinaCapital's VN50 Growth, whose index no provider publishes, and the closed-end funds
 *  and the REIT that `IFC` types as funds, which track nothing by construction. */
export const ETF_BENCHMARK_BY_TICKER: ReadonlyMap<Ticker, Ticker> = new Map([
  [ticker('E1VFVN30'), ticker(VN30_INDEX_TICKER)],
  [ticker('FUESSV30'), ticker(VN30_INDEX_TICKER)],
  [ticker('FUEKIV30'), ticker(VN30_INDEX_TICKER)],
  [ticker('FUEMAV30'), ticker(VN30_INDEX_TICKER)],
  [ticker('FUEVN100'), ticker(VN100_INDEX_TICKER)],
  [ticker('FUEIP100'), ticker(VN100_INDEX_TICKER)],
  [ticker('FUEVFVND'), ticker(VNDIAMOND_INDEX_TICKER)],
  [ticker('FUEKIVND'), ticker(VNDIAMOND_INDEX_TICKER)],
  [ticker('FUEMAVND'), ticker(VNDIAMOND_INDEX_TICKER)],
  [ticker('FUEABVND'), ticker(VNDIAMOND_INDEX_TICKER)],
  [ticker('FUEBFVND'), ticker(VNDIAMOND_INDEX_TICKER)],
  [ticker('FUETPVND'), ticker(VNDIAMOND_INDEX_TICKER)],
  [ticker('FUESSV50'), ticker(VNX50_INDEX_TICKER)],
  [ticker('FUETCC50'), ticker(VNX50_INDEX_TICKER)],
  [ticker('FUEFCV50'), ticker(VNX50_INDEX_TICKER)],
  [ticker('FUEDCMID'), ticker(VNMIDCAP_INDEX_TICKER)],
  [ticker('FUESSVFL'), ticker(VNFINLEAD_INDEX_TICKER)],
  [ticker('FUEKIVFS'), ticker(VNFINSELECT_INDEX_TICKER)],
  [ticker('FUEPHVNS'), ticker(VNSHINE_INDEX_TICKER)],
  [ticker('FUEMITEC'), ticker(VNMITECH_INDEX_TICKER)],
])

/** The exchange's rolling alias for the nearest-month VN30 contract, and the only form the provider
 *  lists: dated contracts appear only once expired, none of them carrying a maturity date. */
export const VN30_FRONT_MONTH_TICKER = 'VN30F1M'

export const BASIS_SESSIONS = 60
export const EVENT_HORIZON_SESSIONS = 10
