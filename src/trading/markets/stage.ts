import type { ValuedBook } from '@/trading/features/portfolio/types'
import type { Suggestion } from '@/trading/features/suggestion/types'
import type { Caveat, HoldReasonCode } from '@/trading/kernel/caveat'
import type { ConvictionBand } from '@/trading/kernel/conviction'
import type { FactorResult, TradeLevels } from '@/trading/kernel/factor'
import type { InstrumentKind } from '@/trading/kernel/instrument'
import type { RegimeScale } from '@/trading/kernel/market/market-data'
import type { MarketEvent } from '@/trading/kernel/market/market-event'
import type { TapeReading } from '@/trading/kernel/market/tape'
import type { ClosedRoundTrip } from '@/trading/kernel/operator/book'
import type { UserProfile } from '@/trading/kernel/operator/profile'
import type { ScreenGateCode } from '@/trading/kernel/screen-codes'
import type { Market } from '@/trading/markets/types'
import { BAND_RANK } from '@/trading/kernel/conviction'

export const STAGE_PHASES = Object.freeze(['gate', 'tradeability', 'risk'] as const)
export type StagePhase = (typeof STAGE_PHASES)[number]

export interface StageInput {
  readonly suggestion: Suggestion
  readonly market: Market
  readonly profile: UserProfile
  readonly valued: ValuedBook
  /** The operator's closed round trips, oldest first. */
  readonly closedRoundTrips: readonly ClosedRoundTrip[]
  readonly regime: RegimeScale
  readonly factors: readonly FactorResult[]
  /** What the market filed this ticker as, where it files kinds at all. An ETF is the one kind a
   *  stage may judge differently: an index carries no single-name thesis to be wrong about. */
  readonly instrumentKind?: InstrumentKind
  readonly levels?: TradeLevels
  /** This name's dated corporate actions, past ones included. */
  readonly events?: readonly MarketEvent[]
  /** The corporate calendar could not be read, so an empty `events` is not "nothing happened". */
  readonly calendarFailed?: true
  /** From `FactorScore.failedGates`, threaded so the admission stage judges the same evidence read
   *  the score was built from rather than fetching the market's universe a second time. */
  readonly failedGates?: readonly ScreenGateCode[]
  /** The tape readings the factor score carried, threaded so a stage reads the same session the
   *  score was built from rather than fetching the series a second time. */
  readonly signals?: readonly TapeReading[]
  /** The run's single clock read, threaded rather than taken again: a stage asking a market whether
   *  its tape is still serving a session must measure that against the instant the run began. */
  readonly now: number
  readonly signal: AbortSignal
}

export type StageDecision =
  | { readonly kind: 'pass'; readonly caveats: readonly Caveat[] }
  | {
      readonly kind: 'lower'
      readonly conviction: ConvictionBand
      readonly caveats: readonly Caveat[]
    }
  | {
      readonly kind: 'block'
      readonly reasonCode: HoldReasonCode
      readonly caveats: readonly Caveat[]
    }

export interface Stage {
  readonly id: string
  readonly phase: StagePhase
  readonly order: number
  evaluate(input: StageInput): Promise<StageDecision>
}

export interface StageRegistry {
  register(stage: Stage): void
  close(): void
  list(): readonly Stage[]
}

/** The decision a stage returns when it has nothing to say. Frozen and shared so four stages do
 *  not each build their own. */
export const STAGE_PASS: StageDecision = Object.freeze({ kind: 'pass', caveats: [] })

/** A stage that wants to lower to `target` but is already at or below it still reports its
 *  caveats: `applyDecision` rejects a band it cannot lower, and dropping the caveats would hide
 *  the finding on exactly the weakest candidates. */
export function loweredDecision(
  current: ConvictionBand,
  target: ConvictionBand,
  caveats: readonly Caveat[]
): StageDecision {
  return BAND_RANK[target] < BAND_RANK[current]
    ? { kind: 'lower', conviction: target, caveats }
    : { kind: 'pass', caveats }
}
