import type {
  FillSource,
  LedgerTxnDraft,
  LedgerTxnDraftInput,
} from '@/trading/features/ledger/types'
import type { PortfolioSegment, TickerRequest } from '@/trading/kernel/instrument'
import type { TypedPrice } from '@/trading/kernel/surface/surface'

export interface RecordLedgerOptions {
  /** Wider than an edit's: only a new sale may name the whole position instead of a count. */
  readonly draft: LedgerTxnDraftInput
  readonly idempotencyKey: string
  /** Declared by a caller whose figures are already the venue's own, which both records the
   *  provenance and stops the write path from asking the venue for a fill it just read. */
  readonly fillSource?: FillSource
  readonly typedPrice?: TypedPrice
  /** Refuses a row in another currency that states no rate where one applies, as an edit is. */
  readonly requiresStatedRate?: true
  readonly now: number
  readonly signal: AbortSignal
}

export interface RemoveLedgerOptions {
  /** A full entry id or the short handle `/transactions` prints. */
  readonly ref: string
  readonly now: number
  readonly signal: AbortSignal
}

export interface UpdateLedgerOptions {
  /** A full entry id or the short handle `/transactions` prints. */
  readonly ref: string
  readonly draft: LedgerTxnDraft
  readonly typedPrice?: TypedPrice
  readonly now: number
  readonly signal: AbortSignal
}

export interface PortfolioAtOptions {
  readonly now: number
  readonly signal: AbortSignal
}

export interface RebalanceOptions extends PortfolioAtOptions {
  /** Sized in place of the saved watchlist for this run only, and never persisted. Held positions
   *  are always sized: advice for a book whose holdings are not candidates cannot be produced. */
  readonly tickers?: readonly TickerRequest[]
  readonly segments?: readonly PortfolioSegment[]
}
