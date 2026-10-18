import type { Caveat, EvidenceReduceReasonCode, HoldReasonCode } from '@/trading/kernel/caveat'
import type { ConvictionBand } from '@/trading/kernel/conviction'
import type { FactorMetric } from '@/trading/kernel/factor-metric'
import type {
  DailyPriceBand,
  InstrumentRef,
  MarketRef,
  TradingDay,
} from '@/trading/kernel/instrument'
import type { Candle } from '@/trading/kernel/market/market-data'
import type { TapeReading } from '@/trading/kernel/market/tape'
import type { InvestmentHorizon } from '@/trading/kernel/operator/profile'
import type { ScreenGateCode } from '@/trading/kernel/screen-codes'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'

export const GOLD_FACTOR_IDS = Object.freeze([
  'real-rate',
  'usd',
  'gold-silver-ratio',
  'trend',
  'official-demand',
  'inflation',
  'safe-haven',
] as const)
export type GoldFactorId = (typeof GOLD_FACTOR_IDS)[number]

export const VN_GOLD_FACTOR_IDS = Object.freeze([...GOLD_FACTOR_IDS, 'local-premium'] as const)
export type VnGoldFactorId = (typeof VN_GOLD_FACTOR_IDS)[number]

export const CRYPTO_FACTOR_IDS = Object.freeze([
  'trend',
  'funding',
  'long-short',
  'turnover-velocity',
  'volatility',
] as const)
export type CryptoFactorId = (typeof CRYPTO_FACTOR_IDS)[number]

export const VN_EQUITY_FACTOR_IDS = Object.freeze([
  'trend',
  'quality',
  'value',
  'speculative-turnover',
  'foreign-flow',
  'proprietary-flow',
  'high-proximity',
] as const)
export type VnEquityFactorId = (typeof VN_EQUITY_FACTOR_IDS)[number]

export const VN_ETF_FACTOR_IDS = Object.freeze(['index-trend', 'index-momentum'] as const)
export type VnEtfFactorId = (typeof VN_ETF_FACTOR_IDS)[number]

// `VnGoldFactorId` is a superset of `GoldFactorId`, so world gold's ids arrive through it.
export type FactorId = VnGoldFactorId | CryptoFactorId | VnEquityFactorId | VnEtfFactorId

/** Every factor id any market can score, deduped — the VN gold set extends the global one and
 *  several markets share `trend` and `high-proximity`. The locale manifest reads this instead of asking
 *  the registry: a factor id is a compile-time fact, so its key needs no running market to be known. */
export const FACTOR_IDS: readonly FactorId[] = Object.freeze([
  ...new Set<FactorId>([
    ...VN_GOLD_FACTOR_IDS,
    ...CRYPTO_FACTOR_IDS,
    ...VN_EQUITY_FACTOR_IDS,
    ...VN_ETF_FACTOR_IDS,
  ]),
])
const KNOWN_FACTOR_IDS: ReadonlySet<string> = new Set(FACTOR_IDS)

/** The factors that read how the business itself is doing. Value is absent on purpose: it reads
 *  what the market pays for the business, and a name turning expensive has not weakened. */
export const BUSINESS_FACTOR_IDS: ReadonlySet<FactorId> = new Set<FactorId>(['quality'])

export type FactorNormalization =
  | {
      readonly kind: 'linear'
      readonly bearishAt: number
      readonly bullishAt: number
      /** The reading that scores zero, where it is not the midpoint of the bounds. */
      readonly neutralAt?: number
    }
  | { readonly kind: 'rank'; readonly direction: 'higher-is-bullish' | 'lower-is-bullish' }

export interface FactorPolicy<K extends string> {
  readonly weights: Readonly<Record<K, number>>
  readonly normalization: Readonly<Record<K, FactorNormalization>>
  /** Fraction of factor weight that must fire before the composite is rated at all. */
  readonly minimumCoverageFraction: number
  /** Share of scored magnitude that must sit on the composite's side, on the same [0, 1] scale
   *  `agreement` is measured on. */
  readonly minimumAgreement: number
  /** Where this market's composite stops reading medium, and where it starts reading high. A
   *  composite is a weighted mean, so its spread narrows as the factor count rises: one shared pair
   *  would ask an eleven-factor board to clear the same bar as a four-factor one. Each market
   *  therefore carries the pair measured on its own distribution. */
  readonly mediumConvictionAt: number
  readonly highConvictionAt: number
}

export interface FactorResult<K extends FactorId = FactorId> {
  readonly id: K
  readonly score: number
  /** The factor's share of the composite, so the contributions a surface prints sum to the score
   *  beside them. Absent where the factor did not fire: it moved nothing, and the fired shares
   *  already account for the whole. */
  readonly weight?: number
  /** Absent where the factor is normalized from a quantity with no operator-facing unit. */
  readonly metrics?: readonly FactorMetric[]
  readonly provenance: readonly SourceProvenance[]
  readonly caveats: readonly Caveat[]
}

/** What a market's factor pass produced: the per-factor rows plus the composite they imply under
 *  the market's own weights. Markets return the whole thing so no consumer re-averages the rows
 *  and lands on a different number. */
/** The composite read, apart from the rows it was folded from: the score that chose the direction
 *  and the band, and the two qualifiers that say how much of the evidence stood behind it. */
export interface FactorComposite {
  readonly score: number
  /** How strong the score reads against its own market's cut points. Banded where the policy is in
   *  hand rather than at each reader, so nothing has to know which market's scale it is holding. */
  readonly band: ConvictionBand
  /** Bearish enough that a name the operator does not hold is not drafted as a buy. A lower bar than
   *  `band`, because it asks whether the read is distinguishable from neutral rather than whether it
   *  is strong — and stamped here for the same reason `band` is. */
  readonly bearish: boolean
  /** Bullish enough to be worth buying rather than watching. The mirror of `bearish` on the same
   *  ratio, so the gap between them is the band where the read says nothing either way. */
  readonly bullish: boolean
  /** Share of factor weight that fired. Below one, the score speaks for less than the whole model. */
  readonly coverage: number
  /** Coverage short of the market's own floor, so the composite speaks for too little of the model
   *  to rate. Stamped where the policy is in hand, for the same reason `band` is. */
  readonly coverageBelowMinimum: boolean
  /** The factors that fired disagreed, measured against the market's own floor. False where nothing
   *  measured it — an unmeasured board is not a divided one. */
  readonly agreementBelowMinimum: boolean
  /** Absent when fewer than two factors fired — one value has no dispersion to measure. */
  readonly agreement?: number
}

/** Drops an absent `agreement` rather than carrying it as an explicit undefined, which
 *  `exactOptionalPropertyTypes` rejects. The scorer, the draft, and the row parser all land here. */
export function factorComposite(value: {
  readonly score: number
  readonly band: ConvictionBand
  readonly bearish: boolean
  readonly bullish: boolean
  readonly coverage: number
  readonly coverageBelowMinimum: boolean
  readonly agreementBelowMinimum: boolean
  readonly agreement?: number | undefined
}): FactorComposite {
  const {
    score,
    band,
    bearish,
    bullish,
    coverage,
    coverageBelowMinimum,
    agreementBelowMinimum,
    agreement,
  } = value

  return {
    score,
    band,
    bearish,
    bullish,
    coverage,
    coverageBelowMinimum,
    agreementBelowMinimum,
    ...(agreement === undefined ? {} : { agreement }),
  }
}

/** Whether a stored id is still a factor this build scores. A retired one costs the row it
 *  printed, never the record that carries it. */
export function isFactorId(id: string): id is FactorId {
  return KNOWN_FACTOR_IDS.has(id)
}

export interface FactorScore extends FactorComposite {
  readonly results: readonly FactorResult[]
  readonly caveats: readonly Caveat[]
  /** What this market's own evidence says a holder of the name should do, beyond the buy-side
   *  score: a breakout that failed, or longs paying to stay long. Absent means the evidence read
   *  nothing on the sell side, not that it read nothing. */
  readonly reduceSignal?: EvidenceReduceReasonCode
  /** Whether the latest audited annual report says the business is getting worse, where the market
   *  reads one. A long holding's thesis sale reads it ahead of the business factors' lean; absent
   *  means no report was read, never a healthy one. */
  readonly businessWeakening?: boolean
  /** Every admission gate this market's own evidence says the name fails, in the market's own gate
   *  order. A screen applies these before it ranks; a named ticker reaches the pipeline without one,
   *  so the score carries them and `createAdmissionStage` enforces the market's policy on them.
   *  Absent means the market declares no gates, or the name is outside its universe. */
  readonly failedGates?: readonly ScreenGateCode[]
  /** What the settled session's tape said about the name, where the market reads a tape at all.
   *  Absent means this market publishes no such read, not that the tape was quiet. */
  readonly signals?: readonly TapeReading[]
}

export interface FactorRequest {
  readonly instrument: InstrumentRef
  readonly asOf: TradingDay
  readonly now: number
  readonly signal: AbortSignal
}

export interface LevelPolicy {
  readonly atrSessions: number
  /** Stop distance, in ATRs, per horizon: a wave trade is ejected before ordinary noise becomes a
   *  drawdown, a long hold is not. The target is a multiple of this, so R:R is unchanged. */
  readonly stopVolatilityMultiplier: Readonly<Record<InvestmentHorizon, number>>
  /** Per horizon, like the stop beside it: a target is a multiple of the risk distance, and a segment
   *  held three times as long should not take profit at a swing multiple. It is what the plan's R:R
   *  and every reward gate read. */
  readonly targetRiskMultiplier: Readonly<Record<InvestmentHorizon, number>>
  /** Where a buy banks its first tranche, as a multiple of the risk distance, so the price the
   *  operator acts on is one the name reaches rather than the target the trail rides toward. Absent,
   *  or at or past the target, banks it at the target. */
  readonly takeProfitRiskMultiplier?: Readonly<Record<InvestmentHorizon, number>>
  /** A stop that hangs from the highest close of the window rather than from the entry, for a
   *  market whose winners run further than one entry-relative stop keeps. Absent means the stop
   *  is entry-relative only. */
  readonly trail?: {
    readonly sessions: number
    readonly volatilityMultiplier: number
    /** How close, in ATRs, the trail may pull a fresh entry's stop. The trail wins whenever the
     *  window high sits above the entry, which is every entry that is not itself the high, so
     *  without a floor the distance is the trail multiple less the pullback and a name a few
     *  percent off its high is stopped inside one session's range. Absent leaves the trail
     *  unclamped, which is right where the entry is the breakout itself. */
    readonly minimumStopMultiplier?: number
  }
  /** The operator's ceiling on how far from entry a stop may sit, as a fraction of entry. It wins
   *  over the ATR distance and the trail floor. Absent means none; no shipped policy declares it. */
  readonly maximumStopLoss?: number
  /** A buy after a run this market measured to give back enters as a limit resting below the live
   *  quote rather than at it. Absent, every buy enters at the quote. */
  readonly restingEntry?: RestingEntryRule
}

export interface RestingEntryRule {
  /** Settled sessions the run is measured over. */
  readonly runSessions: number
  /** The run, as a fraction, at or above which the entry rests. */
  readonly minimumRun: number
  /** How far below the quote the limit rests, in ATRs. */
  readonly atrOffset: number
  /** Sessions the limit stands, counting the order session. */
  readonly validSessions: number
}

export interface TradeLevels {
  readonly entry: number
  readonly stop: number
  readonly target: number
  /** Where a buy banks its first tranche; the target itself where the policy names no nearer one. */
  readonly takeProfit: number
  readonly riskReward: number
  readonly atr: number
  /** Entry to the entry-relative stop, before a trail or a ratchet moved the stop closer. Size is
   *  budgeted on this: a stop that trails a run is an exit level, not a smaller bet. */
  readonly riskDistance: number
  /** The stop is a level the segment's weight answers, with nothing armed under it: a fund on a market
   *  that reviews its funds rather than stopping them. Absent where the stop is an exit to arm. */
  readonly reviewOnly?: true
  /** Present when `entry` is a resting limit below the quote rather than the quote itself: the run
   *  that moved it there and how long the order stands. */
  readonly resting?: {
    readonly run: number
    readonly runSessions: number
    readonly validSessions: number
  }
}

/** What a *caller* asks a market for. The level policy and tick grid are the market's own — it
 *  supplies them when it delegates to the shared builder, and no caller can override them. */
export interface LevelRequest {
  readonly candles: readonly Candle[]
  readonly direction: 'buy' | 'reduce'
  /** Operator intent, like `direction`: how long the position is meant to be held. */
  readonly horizon: InvestmentHorizon
  /** The price a position would actually be opened at, when that is not the last candle close —
   *  a live quote, or a market whose entry is quoted in a different unit from its volatility
   *  series (domestic gold prices off a vendor board while its risk distances come from world
   *  bars). Absent means the last close is the entry. */
  readonly entry?: number
  /** What a holder is paid to sell right now, where that is not the entry: a dealer board buys back
   *  below the price it sells at. A buy's stop and target are placed on this side, so every ratio
   *  read off them already pays the spread. */
  readonly exitPrice?: number
  readonly dailyBand?: DailyPriceBand
  /** Levels for a position already held, as its exit plan: nothing is bought at `entry`, so no gate
   *  on whether a buy could be placed there (a band edge, a full foreign room) applies. */
  readonly forHolding?: boolean
}

export interface MarketLevelRequest extends LevelRequest {
  readonly instrument: InstrumentRef
  readonly asOf: TradingDay
  /** The session an order placed now fills in, whose daily band the plan is priced against. */
  readonly orderSession: TradingDay
  /** The session `entry` printed in, where that is not the last candle's. */
  readonly entrySession?: TradingDay
  readonly signal: AbortSignal
}

export type LevelResult =
  | {
      readonly kind: 'available'
      readonly levels: TradeLevels
      readonly caveats: readonly Caveat[]
      /** The band these levels were clamped against. Rides with the result because it is the
       *  instrument's own, which no manifest field can state for a market listing on more than one
       *  exchange, and because it reaches the stored row no other way. */
      readonly dailyBand?: DailyPriceBand
    }
  | {
      readonly kind: 'unavailable'
      readonly reasonCode: HoldReasonCode
      readonly caveats?: readonly Caveat[]
    }

/** How a factor read at the time, and what that reading went on to be worth. The pipeline computes
 *  it, the store keeps it and the renderer prints it, so the shapes sit beside the factor
 *  vocabulary itself rather than in the feature that reports them. */
export const FACTOR_READINGS = Object.freeze(['bullish', 'bearish'] as const)
export type FactorReading = (typeof FACTOR_READINGS)[number]

export interface FactorAttributionBucket {
  readonly reading: FactorReading
  readonly resolvedCount: number
  /** Readings the price then agreed with: a bullish one it rose after, a bearish one it fell after. */
  readonly hitCount: number
  /** A fraction, not a percent: `0.62` is 62% of resolved readings. */
  readonly hitRate?: number
  /** What holding the name long returned on average, so a bearish reading that was right averages
   *  below zero. A fraction despite the name, so it renders through the fraction family like every
   *  other return in the tree. Reading it as a percent is wrong by 100×, and both render plausibly. */
  readonly meanReturnPct?: number
}

/** One factor's record in one market, split by which way it read at the time. A factor that pays is
 *  one whose bullish bucket beats its bearish bucket; a factor whose two buckets are
 *  indistinguishable is carrying weight it has not earned.
 *
 *  Keyed on market as well as id: `trend`, `high-proximity` and `volatility` each appear
 *  in more than one policy, computed from different inputs and weighted differently, so pooling them
 *  would average unrelated measurements into one number. Keyed on strategy version too: a version
 *  changes a factor's inputs or weight, so pooling two would average two definitions of one
 *  factor. */
export interface FactorAttribution {
  readonly market: MarketRef
  readonly factorId: FactorId
  readonly strategyVersion: string
  readonly firedCount: number
  /** The share of the composite this factor carries under its market's current policy, taken from
   *  the newest row that carried one — a weight can change between strategy versions, and the
   *  current one is what the reader is being asked about. Absent when no row in the sample carried
   *  a weight. */
  readonly weight?: number
  readonly buckets: readonly FactorAttributionBucket[]
  readonly caveats: readonly Caveat[]
}
