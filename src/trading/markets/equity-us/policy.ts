import type { CalendarPolicy } from '@/trading/kernel/config'
import type { LevelPolicy } from '@/trading/kernel/factor'
import type { BoardLotPolicy, Ticker, TickSizePolicy } from '@/trading/kernel/instrument'
import type { AdmissionPolicy } from '@/trading/markets/admission'
import { MS_PER_DAY } from '@/core/utils/time'
import { marketRef, region, ticker } from '@/trading/kernel/instrument'
import { US_EXCHANGE_HOLIDAYS } from '@/trading/markets/equity-us/holidays'

export const US_STRATEGY_VERSION = '1.0.0'
export const US_MARKET_REF = marketRef('equity-us')
export const US_MARKET_REGION = region('us')

/** The regular session only: pre-market, after-hours and overnight trading are out of scope. */
export const US_CALENDAR: CalendarPolicy = Object.freeze({
  timezone: 'America/New_York',
  sessionOpenLocalTime: '09:30',
  sessionCloseLocalTime: '16:00',
  weekendDays: Object.freeze([0, 6]),
  holidays: US_EXCHANGE_HOLIDAYS,
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

/** A fund leaves whole at its review level, so it banks nothing before the target. */
export const US_FUND_LEVEL_POLICY: LevelPolicy = Object.freeze({
  atrSessions: 14,
  stopVolatilityMultiplier: { short: 1.5, long: 3 },
  targetRiskMultiplier: { short: 1.5, long: 3 },
  trail: Object.freeze({ sessions: 22, volatilityMultiplier: 3, minimumStopMultiplier: 1 }),
})

/** A share banks its first third one risk unit out, the rest riding the trail. */
export const US_LEVEL_POLICY: LevelPolicy = Object.freeze({
  ...US_FUND_LEVEL_POLICY,
  takeProfitRiskMultiplier: { short: 1, long: 1 },
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

export const US_STATISTICS_LIQUIDITY_SESSIONS = 20
export const US_STATISTICS_VOLATILITY_SESSIONS = 20

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
