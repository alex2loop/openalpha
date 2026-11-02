import type { CalendarPolicy } from '@/trading/kernel/config'
import type { LevelPolicy } from '@/trading/kernel/factor'
import type { BoardLotPolicy, Ticker, TickSizePolicy } from '@/trading/kernel/instrument'
import type { AdmissionPolicy } from '@/trading/markets/admission'
import type { MacroDriverPolicy } from '@/trading/markets/macro-risk'
import { MS_PER_DAY } from '@/core/utils/time'
import { marketRef, region, ticker } from '@/trading/kernel/instrument'
import { RESTATEMENT_TOLERANCE } from '@/trading/markets/bar-restatement'
import { usClosuresOf, usEarlyClosesOf } from '@/trading/markets/equity-us/calendar/closures'
import { US_MACRO_DRIVERS } from '@/trading/markets/macro-risk'

export const US_STRATEGY_VERSION = '1.0.0'
export const US_MARKET_REF = marketRef('equity-us')
export const US_MARKET_REGION = region('us')

/** The regular session only: pre-market, after-hours and overnight trading are out of scope. */
export const US_CALENDAR: CalendarPolicy = Object.freeze({
  timezone: 'America/New_York',
  sessionOpenLocalTime: '09:30',
  sessionCloseLocalTime: '16:00',
  weekendDays: Object.freeze([0, 6]),
  holidays: usClosuresOf,
  earlyCloses: Object.freeze({ localTime: '13:00', days: usEarlyClosesOf }),
  continuous: false,
})

/** A cash account may sell what it bought the same day, so no session has to pass before a share
 *  is sellable. The broker's own T+1 cash settlement is the operator's to read. */
export const US_SETTLEMENT_SESSIONS = 0

export const US_BOARD_LOT: BoardLotPolicy = Object.freeze({ size: 1 })

/** One cent, and a hundredth of a cent under a dollar. */
export const US_TICK: TickSizePolicy = Object.freeze({
  bands: Object.freeze([{ maximumPriceExclusive: 1, tickSize: 0.0001 }, { tickSize: 0.01 }]),
})

export const US_BENCHMARK_TICKER: Ticker = ticker('SPY')
/** Listed so a level row reads from the store like any name; Nasdaq charts both. */
export const US_INDEX_TICKERS: readonly Ticker[] = Object.freeze([ticker('COMP'), ticker('NDX')])

/** A fund leaves whole at its review level, so it banks nothing before the target, and nothing
 *  trails that level: a trail would only clamp the fresh one, as it did for VN funds. */
export const US_FUND_LEVEL_POLICY: LevelPolicy = Object.freeze({
  atrSessions: 14,
  stopVolatilityMultiplier: { short: 1.5, long: 3 },
  targetRiskMultiplier: { short: 1.5, long: 3 },
})

/** A share banks its first third one risk unit out, the rest riding the trail. */
export const US_LEVEL_POLICY: LevelPolicy = Object.freeze({
  ...US_FUND_LEVEL_POLICY,
  takeProfitRiskMultiplier: { short: 1, long: 1 },
  trail: Object.freeze({ sessions: 22, volatilityMultiplier: 3, minimumStopMultiplier: 1 }),
})

/** Levels are priced off the quote the run read, and a gap can carry a name past them. Below
 *  parity the stored entry, stop and target describe a trade that no longer pays for its risk. */
export const US_MINIMUM_RISK_REWARD = 1

const YEAR_SESSIONS = 252
const MONTH_SESSIONS = 21
/** The calendar counts weekdays while a factor counts traded sessions, so a year's holidays go
 *  before a name misses a day of its own. */
const EVIDENCE_SLACK_SESSIONS = 20

/** The deepest window any factor needs (twelve months, skipping the latest), plus the slack above,
 *  is what a bars read must ask for. */
export const US_EVIDENCE_SESSIONS = YEAR_SESSIONS + MONTH_SESSIONS + EVIDENCE_SLACK_SESSIONS

/** Listings change on corporate events, not intraday, so the universe is replaced weekly while
 *  evidence keeps the configured refresh cadence. */
export const US_UNIVERSE_STALE_MS = 7 * MS_PER_DAY
/** The listing is about 12,000 names; a fetch far short of that is a bad fetch, not a shrunken
 *  market. */
export const US_MINIMUM_UNIVERSE_SIZE = 5_000

/** The board is the equities ranked by capitalisation: wide enough that a screen has a market to
 *  choose from, narrow enough that a refresh asks the provider for hundreds of names, not
 *  thousands. The refresh keeps snapshots for a few dozen beyond it, so a held name that slips just
 *  past the rank stays on the board and keeps its evidence. */
export const US_SCREEN_RANK = 500
export const US_SCREEN_RANK_BUFFER = 550

/** Funds a fund board ranks: broad index, size and style, sector, bond, gold. None is leveraged
 *  or inverse, which `isLeveragedFund` would refuse to buy. */
export const US_SCREEN_ETFS: readonly Ticker[] = Object.freeze(
  [
    'SPY',
    'VOO',
    'IVV',
    'VTI',
    'QQQ',
    'DIA',
    'IWM',
    'IJH',
    'IJR',
    'MDY',
    'VUG',
    'VTV',
    'VIG',
    'SCHD',
    'VEA',
    'EFA',
    'VWO',
    'EEM',
    'XLK',
    'XLF',
    'XLE',
    'XLV',
    'XLY',
    'XLP',
    'XLI',
    'XLB',
    'XLU',
    'XLRE',
    'XLC',
    'SMH',
    'SOXX',
    'IBB',
    'XBI',
    'KRE',
    'ITB',
    'XHB',
    'XRT',
    'VNQ',
    'TLT',
    'IEF',
    'SHY',
    'AGG',
    'BND',
    'LQD',
    'HYG',
    'TIP',
    'GLD',
    'IAU',
    'SLV',
    'USO',
  ].map(ticker)
)

/** Annual accounts change on the filing calendar, not the trading one: a weekly look finds a new
 *  10-K within days and costs one pass of frame reads. */
export const US_ACCOUNTS_STALE_MS = 7 * MS_PER_DAY
/** Years a trend compounds over, as the accounts history reads them. */
export const US_TREND_YEARS = 5

/** A snapshot older than this many sessions belongs to a name that has left the kept set. */
export const US_BOARD_SNAPSHOT_SESSIONS = 5
/** A year of closes: the momentum window needs it and a younger listing has no measured year. */
export const US_MINIMUM_HISTORY_SESSIONS = YEAR_SESSIONS
/** Median daily traded value below which an order in size moves the price. */
export const US_MINIMUM_TRADED_VALUE_USD = 1_000_000
/** Daily volatility (standard deviation of daily returns) above which a name is an outlier. */
export const US_MAXIMUM_VOLATILITY = 0.1
/** How many names a refresh asks the provider for at once; the pacer still enforces the rate. */
export const US_SOURCE_CONCURRENCY = 5

/** Sessions back a filing still reads as news in the brief, and sessions ahead an ex-date is worth
 *  stating and reminding about. */
export const US_RECENT_FILING_SESSIONS = 5
export const US_EX_DATE_HORIZON_SESSIONS = 10
/** Store reads in flight while the board assembles; the database is local, so wider than a provider. */
export const US_BOARD_READ_CONCURRENCY = 8
/** How far a stored close may sit from the same session's refetched close before the series counts
 *  as restated. */
export const US_RESTATEMENT_TOLERANCE = RESTATEMENT_TOLERANCE

export const US_MOMENTUM_SESSIONS = YEAR_SESSIONS
/** The latest month is left out of the twelve-month return: it reverses. */
export const US_MOMENTUM_SKIP_SESSIONS = MONTH_SESSIONS
export const US_VOLATILITY_SESSIONS = 63
export const US_LIQUIDITY_SESSIONS = 20
export const US_TREND_SESSIONS = 50
export const US_TREND_SLOPE_SESSIONS = 10
export const US_FUND_MOMENTUM_SESSIONS = 126
export const US_HIGH_PROXIMITY_SESSIONS = YEAR_SESSIONS

/** What a story has to read as before a company's name in it is that company. */
export const US_SEARCH_TOPIC: readonly string[] = Object.freeze(['stock', 'shares', 'earnings'])

/** A name with no series or too short a one has no levels to size; the rest only cost conviction. */
export const US_ADMISSION: AdmissionPolicy = Object.freeze({
  blocking: Object.freeze({
    'no-price-history': 'insufficient-data',
    'insufficient-history': 'insufficient-data',
  }),
  lowering: Object.freeze({
    'below-minimum-market-cap': 'suggestion.market-cap-below-minimum',
    'below-minimum-turnover': 'suggestion.turnover-below-minimum',
    'volatility-above-maximum': 'suggestion.volatility-above-maximum',
  }),
})

/** The shared US table, with the curve voting as well: an equity segment is the one that prices
 *  recession risk, so it weighs what the other US-priced segments leave out. The fold divides by
 *  the fired total, so adding a driver restates no other. */
export const US_EQUITY_MACRO_DRIVERS: MacroDriverPolicy = Object.freeze({
  ...US_MACRO_DRIVERS,
  weights: Object.freeze({
    'us-real-rate': 0.3,
    'us-10y-yield': 0.2,
    'usd-index': 0.15,
    'us-inflation-yoy': 0.15,
    'us-volatility': 0.1,
    'us-term-spread': 0.1,
  }),
})

/** Sessions a stored regime still anchors the next read's band against. */
export const US_REGIME_MEMORY_SESSIONS = 5
