import type {
  CurrencyCode,
  MarketRef,
  Region,
  TradingDay,
  VenueRef,
} from '@/trading/kernel/instrument'
import type { BriefSectionKind } from '@/trading/kernel/operator/brief-section'
import type { SourceId } from '@/trading/kernel/source/source-id'

export const DEBATE_MODES = Object.freeze(['full', 'lean'] as const)
export type DebateMode = (typeof DEBATE_MODES)[number]

/** The `[[model_tiers.<name>]]` chain the personas prefer when configured; otherwise they run on
 *  the primary `[[models]]` entry. */
export const DEBATE_MODEL_TIER = 'debate'
/** The tier the headline read asks for. Configuring none turns the read off. */
export const DECISIONS_MODEL_TIER = 'decisions'
/** Reads macro figures out of official reports and press items; absent falls back to `[[models]]`. */
export const EXTRACTION_MODEL_TIER = 'extraction'
/** Updates and proposes investment themes; absent falls back to `[[models]]`. Every entry must
 *  support tool calls: the analyst may call `research`. */
export const THEME_MODEL_TIER = 'themes'
export const THEME_ANALYST_AGENT_ID = 'theme-analyst'

/** The debate as it actually runs: an ordered list of waves per mode, each naming the roles that
 *  run together in it. Roles are derived from this rather than declared beside it, so a role can
 *  never belong to no wave and the budget slices can never disagree with the order they run in. */
export const DEBATE_MODE_WAVES = Object.freeze({
  full: [
    { wave: 'cases', roles: ['bull-researcher', 'bear-researcher'] },
    { wave: 'synthesis', roles: ['portfolio-manager'] },
    { wave: 'plan', roles: ['trader', 'risk-analyst', 'claim-verifier'] },
  ],
  lean: [
    { wave: 'analysis', roles: ['market-analyst'] },
    { wave: 'verification', roles: ['claim-verifier'] },
  ],
} as const satisfies Readonly<
  Record<
    DebateMode,
    readonly { readonly wave: string; readonly roles: readonly [string, ...string[]] }[]
  >
>)

type DebateWaveSpec = (typeof DEBATE_MODE_WAVES)[DebateMode][number]
type DebateWave = DebateWaveSpec['wave']

export type DebateRole = DebateWaveSpec['roles'][number]

/** Every role a mode runs, in the order its budget slices are cut. */
export const DEBATE_MODE_ROLES = Object.freeze({
  full: Object.freeze(DEBATE_MODE_WAVES.full.flatMap((spec) => spec.roles)),
  lean: Object.freeze(DEBATE_MODE_WAVES.lean.flatMap((spec) => spec.roles)),
}) satisfies Readonly<Record<DebateMode, readonly DebateRole[]>>

/** Why a run argued at the shallow depth. Only `lean` carries one: `full` is the depth a reader
 *  expects. Decided once and carried, because a stored row cannot tell a typed `lean` from a
 *  configured one afterwards. */
export const LEAN_DEBATE_REASONS = Object.freeze([
  'requested',
  'configured',
  'book-hold',
  'factors-hold',
] as const)
export type LeanDebateReason = (typeof LEAN_DEBATE_REASONS)[number]

/** Every wave either mode can run, deduped in first-appearance order. The locale gate derives one
 *  progress key per member, so a new wave cannot ship without the label a surface shows for it. */
export const DEBATE_WAVES: readonly DebateWave[] = Object.freeze([
  ...new Set(DEBATE_MODES.flatMap((mode) => DEBATE_MODE_WAVES[mode].map((spec) => spec.wave))),
])

export interface CalendarPolicy {
  /** The exchange whose hours these are, a proper noun printed as is; absent where no one exchange
   *  sets them (crypto, gold). */
  readonly exchange?: string
  readonly timezone: string
  readonly sessionOpenLocalTime: string
  readonly sessionCloseLocalTime: string
  readonly breakStartLocalTime?: string
  readonly breakEndLocalTime?: string
  /** Where continuous trading gives way to the closing call auction, which runs to the close.
   *  Absent where the market fixes its close without one. */
  readonly closeAuctionStartLocalTime?: string
  readonly weekendDays: readonly number[]
  /** Weekdays the exchange is shut, as it published them. Absent where the tape trades every day
   *  its weekend allows. */
  readonly holidays?: readonly TradingDay[]
  readonly continuous: boolean
}

/** The hours a market trades, as `HH:MM` on its own clock: what a surface times its open, lunch
 *  and close from. A calendar that never closes has none. */
export interface SessionHours {
  /** The exchange whose hours these are, as its calendar names it. */
  readonly exchange?: string
  readonly timezone: string
  readonly open: string
  readonly close: string
  readonly breaks?: readonly { readonly from: string; readonly to: string }[]
  readonly closeAuction?: { readonly from: string; readonly to: string }
}

export interface SuggestionPolicy {
  readonly cooldownSessions: number
  /** How long a market with no session boundary keeps serving its last answer. Its calendar day is
   *  a charting convention rather than a session falling due, so the reuse gate measures from the
   *  row itself; a market whose calendar closes reuses within its own day and ignores this. */
  readonly reuseWindowMs: number
  readonly batchConcurrency: number
  readonly debateMode: DebateMode
}

export interface OperationPolicy {
  readonly intervalMs: number
  readonly batchSize: number
}

interface IntervalPolicy {
  readonly intervalMs: number
}

export interface RetryPolicy {
  readonly maximumAttempts: number
  readonly initialDelayMs: number
}

export interface OperationsPolicy {
  /** One loop drives delivery, exit arming and screener arming, so one interval and one batch size
   *  cover all three. */
  readonly alerts: OperationPolicy
  readonly outcomes: OperationPolicy
  /** Runs after every refresh pass rather than on its own interval: a board can only be captured
   *  once that pass has stored the session it is built on. */
  readonly factorLog: Pick<OperationPolicy, 'batchSize'>
  /** `batchSize` is how many documents of each kind one tick may send to the model. */
  readonly macroExtract: OperationPolicy
  /** Measures `/themes` stock reads at their horizons; no model call. */
  readonly themeOutcomes: OperationPolicy
  readonly briefs: OperationPolicy
  readonly exits: OperationPolicy
  /** Sweeps intent rows the exchange took that the book never got. No batch size: the rows exist
   *  only where a fill was lost, so the table is bounded by what a human still has to clear. */
  readonly intents: IntervalPolicy
  readonly refresh: IntervalPolicy
  /** A pass that left a kind with nothing retries on this ladder, never past the next anchor; a
   *  spent ladder starts over at that anchor. */
  readonly refreshRetry: RetryPolicy
  readonly deliveryLeaseMs: number
  readonly deliveryRetry: RetryPolicy
  /** A closed laptop wakes in the background with no network, and a tick spent there fails or
   *  burns a delivery attempt. Every loop resolves this host first and waits `offlineRetryMs`
   *  while it cannot. */
  readonly reachabilityHost: string
  readonly reachabilityTimeoutMs: number
  readonly offlineRetryMs: number
}

export interface BriefPolicy {
  /** Local `HH:mm` in the *market's* timezone, and only the default: a delivery row that names its
   *  own time wins. The one brief knob an operator can actually judge. */
  readonly sendTime: string
  readonly coreSections: readonly BriefSectionKind[]
  readonly maximumItemsPerSection: number
  readonly activityLookbackMs: number
}

export interface IntradayPolicy {
  /** Local `HH:mm` in the *market's* timezone, in fire order. Empty means the send is off - there
   *  is no separate enable flag, because a schedule with no times is already disabled. */
  readonly sendTimes: readonly string[]
}

export interface AlertPolicy {
  /** How many average daily ranges a move must span before a watchlist breakout alert fires. */
  readonly breakoutRange: number
  /** Settled sessions the average daily range is measured over. */
  readonly breakoutSessions: number
}

export interface TypedPricePolicy {
  /** How many times above or below the market's latest price a price the operator typed must sit
   *  before they are asked to confirm it. */
  readonly confirmMultiple: number
}

export interface OrderPolicy {
  /** 0 = uncapped. Estimated notional in the market's quote currency. */
  readonly maximumStakeQuote: number
  /** 0 = uncapped. Open ledger positions plus unmirrored intents. */
  readonly maximumOpenTrades: number
  /** A fraction, not a percent: 0.005 is half a percent. */
  readonly maximumPriceDrift: number
  /** Permits an order under `approvalMode: 'bypass'`, where the engine's gate asks nobody. */
  readonly allowUnattended: boolean
  /** Refuse a buy that names no stop-loss. */
  readonly requireStopLoss: boolean
}

/** Which side of a buy the venue takes its fee out of. `quote` bills the money spent, so the whole
 *  ordered quantity is delivered. `base` takes it out of the coins, so fewer arrive than were
 *  ordered - the default on most crypto exchanges. A sell is always billed in the proceeds. */
export const FEE_ASSETS = Object.freeze(['base', 'quote'] as const)

/** Fractions of notional, never percents - 0.0015 is fifteen basis points. `sellTax` is the
 *  statutory share of an exit, absent where none is levied. */
export interface CostRates {
  readonly buy: number
  readonly sell: number
  readonly sellTax?: number
  readonly feeAsset?: (typeof FEE_ASSETS)[number]
}

export type TradingCosts = Readonly<Partial<Record<VenueRef, CostRates>>>

/** Keyed by market: one default cannot span asset classes. */
export type DefaultVenues = Readonly<Partial<Record<MarketRef, VenueRef>>>

/** Everything one venue is configured with. Credentials are only the first of these — a broker also
 *  carries a sub-account and a margin package — so the venue gets a section rather than each new
 *  setting a list of its own somewhere else. */
export interface VenueConfig {
  /** Variable names only, keyed as the venue names them; values come from the environment at boot. */
  readonly credentialEnv: Readonly<Record<string, string>>
  /** Places orders against the exchange's demo environment. A venue with no demo ignores it. */
  readonly simulated: boolean
  /** The markets a broker the build does not ship holds, from `markets` or else `default_for`.
   *  Absent for a built-in venue, whose markets the code owns. */
  readonly markets?: readonly MarketRef[]
}

export type VenueConfigs = Readonly<Partial<Record<VenueRef, VenueConfig>>>

/** Everything one market is configured with. */
export interface MarketConfig {
  /** Closures the exchange announced after this build shipped, added to the market's own table. */
  readonly holidays: readonly TradingDay[]
  /** The farthest below entry a stop may sit, as a fraction of entry. Absent means no ceiling. */
  readonly maximumStopLoss?: number
  /** Stop distance in ATRs, for whichever horizon the segment runs. Absent keeps the market's own. */
  readonly stopLossAtr?: number
  /** Target as a multiple of the risk distance. Absent keeps the market's own. */
  readonly rewardRisk?: number
}

export type MarketConfigs = Readonly<Partial<Record<MarketRef, MarketConfig>>>

export interface ThemePolicy {
  /** The most one `/themes` run may spend, research included; `[budget]` caps still apply. */
  readonly maximumCostUsd: number
}

export interface LedgerPolicy {
  /** How long a held row waits for `/record confirm`. */
  readonly confirmTtlMs: number
  /** Held rows kept at once, one per chat session. */
  readonly maximumStagedRecords: number
}

export interface TradingConfig {
  /** The operator's own clock, from `[locale] timezone`. Every rendered instant reads in it, so one
   *  message never mixes a market's session clock with another market's. A market's *trading day*
   *  stays its own - a close is dated by the session that produced it, not by where it was read. */
  readonly displayTimezone: string
  readonly baseCurrency: CurrencyCode
  readonly defaultRegion: Region
  readonly maximumLedgerEntries: number
  readonly suggestions: SuggestionPolicy
  readonly operations: OperationsPolicy
  readonly briefs: BriefPolicy
  readonly intraday: IntradayPolicy
  readonly alerts: AlertPolicy
  readonly typedPrices: TypedPricePolicy
  readonly orders: OrderPolicy
  readonly ledger: LedgerPolicy
  readonly themes: ThemePolicy
  /** Market ref to everything that market is configured with. A market absent here runs on its own
   *  defaults; a market whose universe is fetched ignores the section entirely. */
  readonly markets: MarketConfigs
  /** Venue id to everything that venue is configured with. Only the venue knows which settings it
   *  needs, so the shape inside is the venue's rather than this file's. */
  readonly venues: VenueConfigs
  /** Source id to the variable holding its credential. Only the name is configurable; the value
   *  comes from the environment and endpoints stay code-owned. */
  readonly sourceCredentialEnv: Readonly<Partial<Record<SourceId, string>>>
  /** What the operator pays, per venue - whoever executes charges it. Only they know it: a VN
   *  brokerage rate depends on the sub-account and the promotion running, and a venue's tax is
   *  policy that changes without a release. Read from each venue's `fees`. */
  readonly costs: TradingCosts
  /** Where a market books when the operator names no venue: the built-in table, overridden by each
   *  venue's `default_for`. */
  readonly defaultVenues: DefaultVenues
}
