import type { Caveat } from '@/trading/kernel/caveat'
import type { InstrumentKind, InstrumentRef, Ticker } from '@/trading/kernel/instrument'

export type TickerCandidacy = 'impossible' | 'possible'

export interface DetectInstrumentOptions {
  readonly ticker: Ticker
  readonly signal: AbortSignal
  /** The ranked board only, no per-symbol lookup: a note on a ticker another market settled. */
  readonly boardOnly?: true
}

/** A no-match may carry caveats because "this market does not list the name" and "this market has
 *  nothing to compare the name against" are different answers that a bare `no-match` conflates. */

export type MarketDetection =
  | {
      readonly kind: 'match'
      readonly instrument: InstrumentRef
      readonly name?: string
      /** What the market's own record files this name under, when it keeps one. Carried from
       *  detection because that lookup already holds the record, and the exposure caps a buy is
       *  sized against are grouped by it. */
      readonly sector?: string
      /** The benchmark basket the name sits in, where the market keeps one. Same reason as
       *  `sector`: the record is already in hand, and refetching it downstream would cost a read. */
      readonly indexTier?: string
      /** The record's own kind, carried for the same reason as `sector`: the detection lookup
       *  already holds the record, and a segment's ETF ceiling is measured by it. */
      readonly instrumentKind?: InstrumentKind
    }
  | {
      readonly kind: 'no-match'
      readonly caveats?: readonly Caveat[]
      /** A populated stored listing missed the name, so the miss is a real check. */
      readonly listingChecked?: true
    }
