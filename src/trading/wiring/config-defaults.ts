import type {
  AlertPolicy,
  BriefPolicy,
  DefaultVenues,
  IntradayPolicy,
  OperationsPolicy,
  OrderPolicy,
  RetryPolicy,
  SuggestionPolicy,
  TradingConfig,
  TradingCosts,
  VenueConfigs,
} from '@/trading/kernel/config'
import type { VenueRef } from '@/trading/kernel/instrument'
import type { BriefSectionKind } from '@/trading/kernel/operator/brief-section'
import { MS_PER_HOUR } from '@/core/utils/time'
import { currencyCode, marketRef, region, venueRef } from '@/trading/kernel/instrument'

// Starting point for a knob `[trading]` exposes: what an operator gets before they state a
// preference, not a value the code depends on.
const DEFAULT_SUGGESTION_COOLDOWN_SESSIONS = 0
const DEFAULT_SUGGESTION_REUSE_WINDOW_HOURS = 4
const ALERT_INTERVAL_MS = 60_000
const REFRESH_INTERVAL_MS = 43_200_000
const EXIT_INTERVAL_MS = 60_000
const INTENT_SWEEP_INTERVAL_MS = 300_000
const BREAKOUT_RANGE = 1.5
const BREAKOUT_SESSIONS = 14
const DEFAULT_MAXIMUM_PRICE_DRIFT = 0.005
/** Measured 2026-10-05: a run with 2 active themes (2 updates, discovery, 2 sector maps and 9
 *  company reads) cost $0.54, and a medium research pass adds about $0.22. A third active theme
 *  with full shortlists (up to 15 company reads) passes this cap; the run then ends the stage and
 *  names every company it skipped. */
const DEFAULT_THEME_MAXIMUM_COST_USD = 1

// Fixed policy the operator does not tune: implementation detail with a sane value, kept in code so
// the config surface stays the set of knobs an operator can meaningfully judge.
const DEFAULT_MAXIMUM_LEDGER_ENTRIES = 50_000
const SUGGESTION_BATCH_CONCURRENCY = 5
const DELIVERY_LEASE_MS = 60_000
/** IANA-reserved, so it resolves wherever any name does and names no provider the daemon reads. */
const REACHABILITY_HOST = 'example.com'
const REACHABILITY_TIMEOUT_MS = 5_000
const OFFLINE_RETRY_MS = 60_000
const BRIEF_MAXIMUM_ITEMS_PER_SECTION = 5
const BRIEF_ACTIVITY_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1_000
const OUTCOME_INTERVAL_MS = 43_200_000
/** Twice a day, three of each: a 24-month backfill finishes in about four days and no tick bills
 *  more than six model calls. */
const MACRO_EXTRACT_BATCH_SIZE = 3
const BRIEF_INTERVAL_MS = 60_000
const DEFAULT_OPERATION_BATCH_SIZE = 50

// Core sections must be market-agnostic because this default applies to every region's brief.
const DEFAULT_BRIEF_CORE_SECTIONS: readonly BriefSectionKind[] = Object.freeze(['next-actions'])

const DELIVERY_RETRY: RetryPolicy = Object.freeze({
  maximumAttempts: 3,
  initialDelayMs: 30_000,
})

const REFRESH_RETRY: RetryPolicy = Object.freeze({
  maximumAttempts: 5,
  initialDelayMs: 120_000,
})

const DEFAULT_BRIEF_SEND_TIME = '08:15'

const DEFAULT_BRIEF_POLICY: BriefPolicy = Object.freeze({
  sendTime: DEFAULT_BRIEF_SEND_TIME,
  coreSections: DEFAULT_BRIEF_CORE_SECTIONS,
  maximumItemsPerSection: BRIEF_MAXIMUM_ITEMS_PER_SECTION,
  activityLookbackMs: BRIEF_ACTIVITY_LOOKBACK_MS,
})

/** Off until the operator names their own times. The morning brief is the one scheduled delivery;
 *  an intraday push is a second and third message a fresh install never asked for. */
const DEFAULT_INTRADAY_POLICY: IntradayPolicy = Object.freeze({
  sendTimes: Object.freeze([]),
})

const DEFAULT_SUGGESTION_POLICY: SuggestionPolicy = Object.freeze({
  cooldownSessions: DEFAULT_SUGGESTION_COOLDOWN_SESSIONS,
  reuseWindowMs: DEFAULT_SUGGESTION_REUSE_WINDOW_HOURS * MS_PER_HOUR,
  batchConcurrency: SUGGESTION_BATCH_CONCURRENCY,
  debateMode: 'full',
})

/** The venues the build ships, each registered in `composition/venues.ts`. Any other id under
 *  `[trading.venues]` is a broker the operator trades by hand. */
export const BUILT_IN_VENUES: readonly VenueRef[] = Object.freeze([
  venueRef('okx'),
  venueRef('binance'),
  venueRef('vps'),
  venueRef('gold-shop'),
])

const DEFAULT_VENUE_CONFIGS: VenueConfigs = Object.freeze({
  [venueRef('okx')]: Object.freeze({
    simulated: false,
    credentialEnv: Object.freeze({
      apiKey: 'OKX_API_KEY',
      secret: 'OKX_API_SECRET',
      passphrase: 'OKX_API_PASSPHRASE',
    }),
  }),
  [venueRef('binance')]: Object.freeze({
    simulated: false,
    credentialEnv: Object.freeze({
      apiKey: 'BINANCE_API_KEY',
      secret: 'BINANCE_API_SECRET',
    }),
  }),
})

/** Every numeric cap is off by default — `0` is uncapped. A buy must name a stop: a position nobody
 *  guards is the one a gap takes furthest, and the operator can still switch this off. What
 *  stops a fresh install from placing is not a cap: `/trade` is registered only for a venue whose
 *  credentials resolved, and every order still passes the approval gate. */
const DEFAULT_ORDER_POLICY: OrderPolicy = Object.freeze({
  maximumStakeQuote: 0,
  maximumOpenTrades: 0,
  maximumPriceDrift: DEFAULT_MAXIMUM_PRICE_DRIFT,
  allowUnattended: false,
  requireStopLoss: true,
})

const DEFAULT_OPERATIONS_POLICY: OperationsPolicy = Object.freeze({
  alerts: Object.freeze({ intervalMs: ALERT_INTERVAL_MS, batchSize: DEFAULT_OPERATION_BATCH_SIZE }),
  outcomes: Object.freeze({
    intervalMs: OUTCOME_INTERVAL_MS,
    batchSize: DEFAULT_OPERATION_BATCH_SIZE,
  }),
  factorLog: Object.freeze({ batchSize: DEFAULT_OPERATION_BATCH_SIZE }),
  macroExtract: Object.freeze({
    intervalMs: OUTCOME_INTERVAL_MS,
    batchSize: MACRO_EXTRACT_BATCH_SIZE,
  }),
  themeOutcomes: Object.freeze({
    intervalMs: OUTCOME_INTERVAL_MS,
    batchSize: DEFAULT_OPERATION_BATCH_SIZE,
  }),
  briefs: Object.freeze({ intervalMs: BRIEF_INTERVAL_MS, batchSize: DEFAULT_OPERATION_BATCH_SIZE }),
  exits: Object.freeze({
    intervalMs: EXIT_INTERVAL_MS,
    batchSize: DEFAULT_OPERATION_BATCH_SIZE,
  }),
  intents: Object.freeze({ intervalMs: INTENT_SWEEP_INTERVAL_MS }),
  refresh: Object.freeze({ intervalMs: REFRESH_INTERVAL_MS }),
  refreshRetry: REFRESH_RETRY,
  deliveryLeaseMs: DELIVERY_LEASE_MS,
  deliveryRetry: DELIVERY_RETRY,
  reachabilityHost: REACHABILITY_HOST,
  reachabilityTimeoutMs: REACHABILITY_TIMEOUT_MS,
  offlineRetryMs: OFFLINE_RETRY_MS,
})

/** The published retail rates for the venues an install holds out of the box. Wrong for any
 *  operator on a different tier, which is why the confirmation states the rate it used. */
const DEFAULT_TRADING_COSTS: TradingCosts = Object.freeze({
  [venueRef('vps')]: Object.freeze({ buy: 0.0015, sell: 0.0015, sellTax: 0.001 }),
  // A gold shop bills no commission: what it keeps is the gap between its two prices, and a row
  // books the side it filled at, so the spread is already in the basis and the proceeds.
  [venueRef('gold-shop')]: Object.freeze({ buy: 0, sell: 0 }),
  // OKX's taker rate. The maker rate was the earlier default on the theory that these orders rest as
  // limits; every fill actually recorded has been a taker, and the maker rate understates each one.
  // A spot buy is billed in the coin delivered unless the account opts into quote-currency fees, so
  // an order of 3 credits 2.997 and the row must say so.
  [venueRef('okx')]: Object.freeze({ buy: 0.001, sell: 0.001, feeAsset: 'base' }),
  // Binance's standard spot taker rate, billed like OKX's in the coin a buy delivers unless the
  // account pays in BNB, which the venue's own figures then say.
  [venueRef('binance')]: Object.freeze({ buy: 0.001, sell: 0.001, feeAsset: 'base' }),
})

/** Where each built-in market books, and so whose fees its suggestions are weighed and graded on.
 *  Boot rejects an entry whose venue does not hold the market. */
const DEFAULT_VENUE_BY_MARKET: DefaultVenues = Object.freeze({
  [marketRef('equity-vn')]: venueRef('vps'),
  [marketRef('gold-vn')]: venueRef('gold-shop'),
  [marketRef('crypto')]: venueRef('binance'),
})

const DEFAULT_ALERT_POLICY: AlertPolicy = Object.freeze({
  breakoutRange: BREAKOUT_RANGE,
  breakoutSessions: BREAKOUT_SESSIONS,
})

export const DEFAULT_TRADING_CONFIG: TradingConfig = Object.freeze({
  displayTimezone: 'UTC',
  baseCurrency: currencyCode('VND'),
  defaultRegion: region('vn'),
  maximumLedgerEntries: DEFAULT_MAXIMUM_LEDGER_ENTRIES,
  suggestions: DEFAULT_SUGGESTION_POLICY,
  operations: DEFAULT_OPERATIONS_POLICY,
  briefs: DEFAULT_BRIEF_POLICY,
  intraday: DEFAULT_INTRADAY_POLICY,
  alerts: DEFAULT_ALERT_POLICY,
  orders: DEFAULT_ORDER_POLICY,
  themes: Object.freeze({ maximumCostUsd: DEFAULT_THEME_MAXIMUM_COST_USD }),
  markets: Object.freeze({}),
  venues: DEFAULT_VENUE_CONFIGS,
  sourceCredentialEnv: Object.freeze({}),
  costs: DEFAULT_TRADING_COSTS,
  defaultVenues: DEFAULT_VENUE_BY_MARKET,
})
