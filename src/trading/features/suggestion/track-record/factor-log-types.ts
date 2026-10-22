import type { BrandTag } from '@/core/ids'
import type { FactorComposite, FactorId } from '@/trading/kernel/factor'
import type { InstrumentRef, MarketRef, TradingDay } from '@/trading/kernel/instrument'
import type { TapeSignal } from '@/trading/kernel/market/tape'
import type { InvestmentHorizon } from '@/trading/kernel/operator/profile'
import type { SourceId } from '@/trading/kernel/source/source-id'
import type { OperationTickOptions, Page } from '@/trading/kernel/store/page'

export const FACTOR_LOG_EXIT_REASONS = Object.freeze(['window-end', 'stopped-trading'] as const)
export type FactorLogExitReason = (typeof FACTOR_LOG_EXIT_REASONS)[number]

interface FactorLogFactor {
  readonly id: FactorId
  readonly score: number
  readonly weight?: number
}

export interface FactorLogEntry {
  readonly instrument: InstrumentRef
  readonly day: TradingDay
  readonly strategyVersion: string
  readonly horizon: InvestmentHorizon
  readonly close: number
  readonly composite: FactorComposite
  readonly factors: readonly FactorLogFactor[]
  /** What the session's tape said beyond the factors. Empty where the market publishes no read. */
  readonly signals: readonly TapeSignal[]
  /** The providers the board was read from, so a session a fallback answered can be told apart from
   *  one the lead provider did. Absent on rows logged before it was recorded. */
  readonly sources?: readonly SourceId[]
}

export interface FactorLogOutcome {
  readonly resolvedAt: number
  readonly exitDay: TradingDay
  /** A fraction: 0.05 is five percent. */
  readonly returnPct: number
  readonly benchmarkReturnPct?: number
  readonly exitReason: FactorLogExitReason
}

export interface ResolvedFactorLogEntry extends FactorLogEntry {
  readonly outcome: FactorLogOutcome
}

export interface PendingFactorLogEntry extends FactorLogEntry {
  readonly id: FactorLogId
}

export type FactorLogId = string & BrandTag<'FactorLogId'>

export interface FactorLogStore {
  hasDay(market: MarketRef, day: TradingDay, signal: AbortSignal): Promise<boolean>
  insertMany(entries: readonly FactorLogEntry[], signal: AbortSignal): Promise<number>
  listPending(
    options: OperationTickOptions<FactorLogId>
  ): Promise<Page<PendingFactorLogEntry, FactorLogId>>
  resolve(id: FactorLogId, outcome: FactorLogOutcome, signal: AbortSignal): Promise<boolean>
  /** Deletes a pending row; a resolved one keeps its verdict. */
  closeUnscorable(id: FactorLogId, signal: AbortSignal): Promise<boolean>
  listResolved(options: {
    readonly limit: number
    readonly signal: AbortSignal
  }): Promise<readonly ResolvedFactorLogEntry[]>
}

export interface FactorLogService {
  capture(options: {
    readonly now: number
    readonly signal: AbortSignal
  }): Promise<FactorLogCaptureResult>
  resolvePending(options: OperationTickOptions<FactorLogId>): Promise<FactorLogResolveBatch>
  listResolved(options: {
    readonly limit: number
    readonly signal: AbortSignal
  }): Promise<readonly ResolvedFactorLogEntry[]>
}

export interface FactorLogCaptureResult {
  readonly captured: readonly {
    readonly market: MarketRef
    readonly day: TradingDay
    readonly rows: number
  }[]
  readonly skipped: readonly {
    readonly market: MarketRef
    readonly reason: FactorLogSkipReason
    /** Set for `capture-failed`: what the market's capture threw. */
    readonly error?: unknown
  }[]
}

export type FactorLogSkipReason =
  | 'already-captured'
  | 'no-screen'
  | 'evidence-lagging'
  | 'universe-empty'
  | 'capture-failed'

export interface FactorLogResolveBatch {
  readonly resolved: number
  readonly pending: number
  readonly nextCursor?: FactorLogId
}
