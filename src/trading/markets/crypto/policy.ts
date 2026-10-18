import type { CryptoFactorId, FactorPolicy, LevelPolicy } from '@/trading/kernel/factor'
import type { BoardLotPolicy, Ticker, TickSizePolicy } from '@/trading/kernel/instrument'
import type { AdmissionPolicy } from '@/trading/markets/admission'
import type { MacroDriverPolicy } from '@/trading/markets/macro-risk'
import { CRYPTO_FACTOR_IDS } from '@/trading/kernel/factor'
import { marketRef, region, ticker } from '@/trading/kernel/instrument'
import {
  DEFAULT_MINIMUM_COVERAGE_FRACTION,
  equalWeights,
  RANK_HIGHER_IS_BULLISH,
  RANK_LOWER_IS_BULLISH,
  returnBand,
} from '@/trading/markets/factor-scoring'

/** Bump on any change below. Outcome tracking compares it, which is why these are code, not config. */
export const CRYPTO_STRATEGY_VERSION = '1.0.0'

export const CRYPTO_MARKET_REF = marketRef('crypto')
export const CRYPTO_REGION = region('global')
/** What a story has to read as before a coin's name in it is that coin: the market's own word for
 *  itself, so a token named after an ordinary word does not answer with the ordinary word. */
export const CRYPTO_SEARCH_TOPIC: readonly string[] = Object.freeze(['crypto', 'cryptocurrency'])
export const BTC_TICKER: Ticker = ticker('BTC')
export const ETH_TICKER: Ticker = ticker('ETH')

/** The reference assets an overview leads with, in this order. Two, because one price is a coin's
 *  story and the pair is the market's: the majors move together or they do not, and that difference
 *  is the first thing a reader wants. */
export const CRYPTO_OVERVIEW_NAMES: readonly Ticker[] = [BTC_TICKER, ETH_TICKER]

/** How many names the overview's most-traded list carries — the same bound every market's leader
 *  list uses, declared per market because each owns what its recap is worth showing. */
export const CRYPTO_OVERVIEW_LEADERS = 5

/** How many names each side of the movers list carries. Read on a phone beside the board, so it
 *  states who led rather than inventorying the session. */
export const CRYPTO_MOVERS_PER_SIDE = 5

/** The ranked window every universe read asks for: what the screen and the overview volunteer
 *  unprompted. It reaches past what the screen can trade because the movers list is drawn from the
 *  same rows — the market-cap floor already stops the board at rank 220 (measured 2026-09-22), so
 *  depth costs the screen nothing and buys the tail a reading. It does not bound what may be asked
 *  about by name. */
export const MAXIMUM_RESOLUTION_RANK = 750
/** Cap on how many screen survivors get per-asset evidence fetched. A backstop rather than a
 *  policy: the venue listing is what actually bounds the sweep, since a name the operator has no
 *  book for is dropped before the evidence budget is spent — 81 of 115 eligible rows on the board
 *  measured 2026-09-22, one bars call each, 5,4s at `CRYPTO_SOURCE_CONCURRENCY`. This sits above
 *  any reachable board seen so far and exists for the bull market that widens one. */
export const MAXIMUM_SCREEN_CANDIDATES = 150

/** Subjects in flight at once. The provider's own rate is the pacer's to enforce — binance earns
 *  ten a second and admits a quarter-minute burst, so a lower cap here only queues work the bucket
 *  would have granted. */
export const CRYPTO_SOURCE_CONCURRENCY = 10

/** How long a covered pass keeps the names it lost before asking for them again. Short enough that
 *  a transient outage heals within the session, long enough that a name no provider serves costs
 *  one repair rather than one per command. */
export const CRYPTO_REPAIR_COOLDOWN_MS = 900_000

export const CRYPTO_TREND_SESSIONS = 50
export const BTC_REGIME_SESSIONS = 200
export const CRYPTO_VOLATILITY_SESSIONS = 30
/** The Donchian entry window the trend literature settles on for daily bars: a close above the
 *  20-session high is the breakout, the 55-session midline the filter. */
export const CRYPTO_BREAKOUT_SESSIONS = 20
/** Within this fraction of the 20-session high a name is breaking out, and its expanding range is
 *  the breakout rather than a reason to rank it down. */
export const BREAKOUT_PROXIMITY_FRACTION = 0.03
/** Half the entry window: the Turtle exit for a 20-session entry, and the level under which a
 *  breakout has failed rather than paused. */
export const CRYPTO_INVALIDATION_SESSIONS = 10
/** Relative volume baseline. The breakout bar is compared against the sessions before it. */
export const CRYPTO_RELATIVE_VOLUME_SESSIONS = 20
/** The decline a washout is measured against, and how many sessions it runs over. */
export const WASHOUT_RUN_SESSIONS = 4
export const WASHOUT_MINIMUM_FALL = 0.05
/** Relative volume at which a down session after a fall reads as a washout rather than a session. */
export const WASHOUT_RELATIVE_VOLUME = 1.5
/** Where in its own range a washout session has to close: the bottom fifth. */
export const WASHOUT_CLOSE_RANGE_FRACTION = 0.2
/** How many sessions the washout low has to hold before the read counts, and how many it stays
 *  current for: a low that held a week ago is history, not a tell. */
export const WASHOUT_HOLD_SESSIONS = Object.freeze({ minimum: 2, maximum: 4 })
/** The rise a leverage read is judged on, over the open-interest change window the adapter reports. */
export const LEVERAGE_LED_MINIMUM_RUN = 0.05
/** Contract count has to grow this many times faster than price for the move to read as carried by
 *  new positions rather than spot. */
export const LEVERAGE_LED_OI_MULTIPLE = 2
/** ETH/BTC leads an alt rotation by two to four weeks in the rotation literature, and its 50-session
 *  average is the trigger practitioners read it against. */
export const ETH_BTC_TREND_SESSIONS = 50
export const CHOPPINESS_SESSIONS = 14
/** One bar beyond the longest lookback, so a full-window trend is computable. */
export const CRYPTO_EVIDENCE_SESSIONS = BTC_REGIME_SESSIONS + 1

/** Two daily bars so the newest complete one is available even while today's is still filling. A
 *  taker share read off a partial session moves all day and would report a different market each
 *  time the brief ran. */
export const CRYPTO_TAKER_SESSIONS = 2

/** Levels are priced off the quote the run read, and this market travels between one reading and
 *  the next. Below parity the stored entry, stop, and target describe a trade that no longer pays
 *  for the risk it carries, whatever it was worth on the day it was written. */
export const CRYPTO_MINIMUM_RISK_REWARD = 1

export const CRYPTO_MINIMUM_HISTORY_SESSIONS = 90
export const MINIMUM_MARKET_CAP_USD = 250_000_000
export const MINIMUM_DAILY_VOLUME_USD = 10_000_000
export const CRYPTO_MAXIMUM_DAILY_VOLATILITY = 0.12
/** An asset whose price does not move is a cash equivalent, not a trade idea: every factor here
 *  measures a price change, and dividing by a range of nothing ranks a peg above every real name.
 *  Measured, not named — pegs launch faster than any denylist is edited, and the observed gap is
 *  wide enough to be unambiguous: pegs realize 0.0001-0.0004 and the calmest real asset 0.006. */
export const CRYPTO_MINIMUM_DAILY_VOLATILITY = 0.002
/** Choppiness index above this reads as a range, where a trend factor measures noise. The classic
 *  61.8 threshold, kept because no backtest in this project justifies moving it. */
export const MAXIMUM_CHOPPINESS = 61.8

/** What a failed gate costs a named crypto ticker. Only the two history gates refuse: with too few
 *  bars every statistic below is measured over a window it does not have, which is a data gap rather
 *  than a verdict about the asset. The size floors decide which twenty-five names are worth spending
 *  evidence on, which is a different question from the one an operator asks by naming a ticker — so
 *  they cost a band, and the sizing ceilings bound what is left. Volatility and choppiness lower for
 *  the same reason VN's do: the name is analysable, just less trustworthy. */
export const CRYPTO_ADMISSION: AdmissionPolicy = Object.freeze({
  blocking: Object.freeze({
    'no-price-history': 'insufficient-data',
    'insufficient-history': 'insufficient-data',
  }),
  lowering: Object.freeze({
    'below-minimum-market-cap': 'suggestion.market-cap-below-minimum',
    'below-minimum-turnover': 'suggestion.turnover-below-minimum',
    'volatility-above-maximum': 'suggestion.volatility-above-maximum',
    'volatility-below-minimum': 'suggestion.volatility-below-minimum',
    'choppy-range': 'suggestion.choppy-range',
  }),
})

export const CRYPTO_LIQUIDITY_SESSIONS = 30

/** For the screen this saves an evidence fetch on dollar pegs already known and is not what keeps
 *  them out — `CRYPTO_MINIMUM_DAILY_VOLATILITY` is that gate, and it catches the ones nobody added
 *  here. A peg to another currency is the exception: it moves as that currency moves against the
 *  dollar, EURC about 0.004 a day, above the floor, so it is kept out only by being named here. The
 *  overview's ranking has no candles to measure, so there this list is the only defence and a peg
 *  missing from it shows up until someone adds it. */
export const STABLECOIN_TICKERS: ReadonlySet<string> = new Set([
  'USDT',
  'USDC',
  'DAI',
  'FDUSD',
  'TUSD',
  'USDE',
  'PYUSD',
  'USDS',
  'USD1',
  'USDG',
  'USDGO',
  'USDD',
  'RLUSD',
  'EURC',
  'STABLE',
])

/** Mirrors of another asset: a wrapped or staked coin doubles a position inside this universe, and
 *  a gold token tracks the metal, a thesis none of this market's factors can argue. */
export const EXCLUDED_TICKERS: ReadonlySet<string> = new Set([
  'WBTC',
  'WETH',
  'STETH',
  'WSTETH',
  'WEETH',
  'WBETH',
  'XAUT',
  'PAXG',
])

/** A letter followed by up to nine uppercase alphanumerics — the shape every symbol in the ranked
 *  universe has. It rejects exchange-suffixed and punctuated codes outright, but it cannot separate
 *  a three-letter coin from a three-letter equity ticker; nothing in the grammar can. A ticker both
 *  markets claim is reported as cross-market ambiguity by `MarketRegistry`, which is the honest
 *  answer — a hardcoded collision list would be a second universe to keep current. */
export const CRYPTO_SYMBOL_RE = /^[A-Z][A-Z0-9]{1,9}$/

/** A decade of price per band, so the tick stays near a ten-thousandth of the price everywhere in a
 *  universe that spans ten orders of magnitude. A single flat tick cannot: at $0.077 a one-cent grid
 *  is 13% of the price, which rounds a stop and a target onto the same number and reports the name
 *  as having no levels at all. */
export const CRYPTO_TICK: TickSizePolicy = Object.freeze({
  bands: Object.freeze([
    Object.freeze({ maximumPriceExclusive: 0.00001, tickSize: 0.000000001 }),
    Object.freeze({ maximumPriceExclusive: 0.0001, tickSize: 0.00000001 }),
    Object.freeze({ maximumPriceExclusive: 0.001, tickSize: 0.0000001 }),
    Object.freeze({ maximumPriceExclusive: 0.01, tickSize: 0.000001 }),
    Object.freeze({ maximumPriceExclusive: 0.1, tickSize: 0.00001 }),
    Object.freeze({ maximumPriceExclusive: 1, tickSize: 0.0001 }),
    Object.freeze({ maximumPriceExclusive: 10, tickSize: 0.001 }),
    Object.freeze({ maximumPriceExclusive: 100, tickSize: 0.01 }),
    Object.freeze({ maximumPriceExclusive: 1000, tickSize: 0.1 }),
    Object.freeze({ tickSize: 1 }),
  ]),
})

/** Crypto is divisible far below one unit, so the board lot is a precision step, not a round lot. */
export const CRYPTO_BOARD_LOT: BoardLotPolicy = Object.freeze({ size: 0.0001 })

/** `stopVolatilityMultiplier` is wider than gold's: a 2x ATR stop on a crypto asset is inside its
 *  ordinary daily range. The target is a multiple of that risk, so it moves out with the stop by
 *  itself, and 2 puts it four ATRs out on the short horizon this segment is held on, which is where
 *  the multiplier was always aimed. Measured on the stored bars, entered at the 20-session breakout
 *  and trailed: 1.3 is worse on 15 of the 23 names with enough windows to read, and 2 beats 1.6 on
 *  17 of them but by 0.02R equal-weighted, a gap that is carried by three high-count names and
 *  disappears without them. So the measurement settles the floor rather than the optimum, and it
 *  settles it over one year of names that are still listed. The trail is a Chandelier Exit read off
 *  closes: the 22-session high close less three ATRs over `atrSessions`, where LeBeau's own rule
 *  hangs from the highest high and ties ATR to the same 22 sessions. Both were measured by
 *  `scripts/research-trail-variants.ts` on the stored bars: this one takes 2.19 profit factor
 *  against 2.08 over 147 trades, but loses 20 of 32 decided names, so the total is carried by a few
 *  coins and neither reading is settled. It stays as written because nothing argues it down. The
 *  long arm is
 *  where the void price first clears the entry by a whole risk unit under this market's own
 *  risk-reward floor, so a plan held for a quarter is not void on its first ordinary gap.
 *
 *  Both arms bank their first third one risk unit out. The long arm's target at seven and a half
 *  ATRs was reached by 8% to 15% of breakout entries, one risk unit by 27% to 34%. On the short arm
 *  one risk unit costs 0.04R a trade against its target (t -1.5) where 1.5 costs 0.03R (t -2.3),
 *  and the record shows why the target alone banks too rarely: of 24 bought names by 2026-10-01,
 *  9 reached one risk unit before their stop and 2 the target.
 *
 *  A buy is not gated on the breakout, so the trail can clamp a fresh stop far inside its designed
 *  distance: on 72 stored names (2026-09-24) 18.8% of entries sat within one ATR and 8% were stopped
 *  the next session. A one-ATR floor cut that to 2% and raised the return per budgeted risk unit on
 *  both arms.
 *
 *  A name up 25% or more over seven sessions rests its buy half an ATR under the quote for five
 *  sessions. Measured 2026-10-15 on 81 names' hourly bars: the limit, filled only on a trade
 *  through it after the order went in, beat the market buy by 2.4% a trade on the production exits
 *  (t 3.2, 85% filled), ahead in both halves of the year and in every liquidity third. Below 25%
 *  the edge fades in the second half, so the market buy stays. */
export const CRYPTO_LEVEL_POLICY: LevelPolicy = Object.freeze({
  atrSessions: 14,
  stopVolatilityMultiplier: { short: 2, long: 2.5 },
  targetRiskMultiplier: { short: 2, long: 3 },
  takeProfitRiskMultiplier: { short: 1, long: 1 },
  trail: Object.freeze({ sessions: 22, volatilityMultiplier: 3, minimumStopMultiplier: 1 }),
  restingEntry: Object.freeze({
    runSessions: 7,
    minimumRun: 0.25,
    atrOffset: 0.5,
    validSessions: 5,
  }),
})

/** Equal weights for the same reason gold states: this project ships no backtest that would justify
 *  anything else. `trend` is the one return-shaped factor and normalizes linearly, since a return has
 *  no population to rank against; the four bounded ones scale against a fixed reference range.
 *
 *  `trend` is the only price-strength leg. Momentum and the distance to the 200-session high were
 *  measured on 2026-10-12 over 88 stored names: none of the three ranked the next 7, 14 or 28
 *  sessions better than chance, and they moved together, so the composite counted one reading three
 *  times. `trend` stays because its metrics carry the breakout trigger, the invalidation and the
 *  relative volume the trader and the exit read.
 *
 *  `funding` is contrarian: a crowded long funding rate precedes the unwind that liquidates it, so
 *  it reads lower-is-bullish. `long-short` is contrarian for the same reason: Binance's global
 *  long/short account ratio counts ordinary accounts, and a crowd already long has less left to buy.
 *  `volatility` ranks lower-is-bullish rather than repeating the screen's hard floor: among the
 *  assets that already cleared `CRYPTO_MAXIMUM_DAILY_VOLATILITY`, the calmer one is the better
 *  position.
 *
 *  Bitcoin's own regime and the market-wide sentiment index are deliberately absent. Both are one
 *  number for the whole board, so neither can order it, and the regime already sizes this segment
 *  through `CRYPTO_MACRO_DRIVERS`. Relative strength against Bitcoin is absent too: it is a coin's
 *  return less Bitcoin's, which orders the board exactly as the coin's own return does and moves
 *  every band with Bitcoin. */
export const CRYPTO_FACTOR_POLICY: FactorPolicy<CryptoFactorId> = Object.freeze({
  weights: equalWeights(CRYPTO_FACTOR_IDS),
  normalization: Object.freeze({
    // Asymmetric because the measured envelope is: crypto trend distances skew positive. The bounds
    // are the 5th and 95th percentiles from `scripts/research-crypto-bounds.ts` over every name the
    // screen scored or rejected. A distance of zero is neutral whatever the envelope.
    trend: returnBand(-0.214, 0.405),
    funding: RANK_LOWER_IS_BULLISH,
    'long-short': RANK_LOWER_IS_BULLISH,
    'turnover-velocity': RANK_HIGHER_IS_BULLISH,
    volatility: RANK_LOWER_IS_BULLISH,
  }),
  minimumCoverageFraction: DEFAULT_MINIMUM_COVERAGE_FRACTION,
  // Fitted with the cut points below by `scripts/research-conviction-bands.ts --market=crypto`.
  minimumAgreement: 0.5431,
  // Pooled p75 / p95 of the same run; one board is no reason to refit.
  mediumConvictionAt: 0.1798,
  highConvictionAt: 0.3395,
})

/** Bitcoin's own trend carries the regime; how many liquid altcoins rose this week says whether the
 *  move is broad; ETH against Bitcoin, the rotation read, votes lightest. Breadth counts names up on
 *  the week rather than names beating Bitcoin: in a Bitcoin-led bull the rest of the board can rise
 *  and still lag it, and counting only the ones that beat it read that board as defensive. Its
 *  anchors sit fifteen points either side of an even split; the trend bands are the distances the
 *  rotation literature calls decisive. No backtest here. The segment is not sized on the US
 *  composite: real rates and the dollar read defensive through an entire crypto bull once rates are
 *  high. */
export const CRYPTO_MACRO_DRIVERS: MacroDriverPolicy = Object.freeze({
  weights: Object.freeze({ 'btc-trend': 0.5, 'eth-btc-trend': 0.2, 'alt-breadth': 0.3 }),
  bands: Object.freeze({
    'btc-trend': { kind: 'linear', bearishAt: -15, bullishAt: 15 } as const,
    'eth-btc-trend': { kind: 'linear', bearishAt: -10, bullishAt: 10 } as const,
    'alt-breadth': { kind: 'linear', bearishAt: 35, bullishAt: 65 } as const,
  }),
  units: Object.freeze({
    'btc-trend': 'percent',
    'eth-btc-trend': 'percent',
    'alt-breadth': 'percent',
  }),
})

/** Funding charged per day, in percent: the scale the factor reads against, three eight-hour
 *  settlements at the ±0.1 per-interval bound this replaced. Its endpoints are twice
 *  `CROWDED_FUNDING_DAILY_PCT`, so a name reaching either is well past crowded rather than at the
 *  edge of it. Measured per day rather than per settlement because Binance settles 432 of 571
 *  perpetuals every four hours and five every hour, so a per-interval scale ranks contracts against
 *  each other in different units. */
export const FUNDING_DAILY_RANGE = Object.freeze({ low: -0.3, high: 0.3 })

/** Funding charged per day, in percent, at which the paying side is crowded rather than merely
 *  leaning: half the top of the range above, about 55% a year, and where practitioners start
 *  reading the market as overheated. Inside it funding is a factor like any other. Named `_PCT`
 *  because it is percent-valued (0.15 means 0.15%), never a multiplier. */
export const CROWDED_FUNDING_DAILY_PCT = 0.15

/** Bounds how much open-interest expansion can amplify a funding reading: past double its window
 *  mean the rate itself is the story, and further OI growth adds outlier risk, not information. */
export const OI_CONFIRMATION_CAP = 2

/** Aggregate daily traded value over market cap, both measured across every venue. The bounds are
 *  the 5th and 95th percentiles of the eligible universe as it stood when they were set: a full
 *  turnover per day is arithmetically possible and empirically never reached, so an open-ended
 *  scale reads every asset as motionless. */
export const TURNOVER_RATIO_RANGE = Object.freeze({ low: 0.01, high: 0.25 })

/** The board's own 5th and 95th percentiles, and deliberately not
 *  `CRYPTO_MAXIMUM_DAILY_VOLATILITY`: that ceiling is an outlier gate, and scaling against it
 *  crowds every survivor into the calm end. Re-measured 2026-09-22, the pair it replaces having
 *  drifted until nearly half the board pinned at -1,00 and none of it reached the low end. */
export const VOLATILITY_RANGE = Object.freeze({ low: 0.022, high: 0.096 })

/** Binance's global long/short account ratio, which is a ratio and not a share: 1,0 is a balanced
 *  book and the board runs above it, so the raw value read as a percentile saturated every name at
 *  once. The 1st and 99th percentiles rather than the 5th and 95th its neighbours state — the
 *  narrower pair clips a tenth of the board, and a bound an ordinary name reaches stops separating
 *  anyone. Provisional: 30 sessions, over which the board's own median moved 1,099 to 1,575. */
export const LONG_SHORT_RANGE = Object.freeze({ low: 0.5, high: 2.7 })
