import type { Caveat } from '@/trading/kernel/caveat'
import type { MarketRef, TradingDay } from '@/trading/kernel/instrument'
import type { SectorStrength } from '@/trading/kernel/market/market-capability'
import type { SourceSummary } from '@/trading/kernel/source/source-result'

export interface TradingSectorsRequest {
  readonly market: MarketRef
  readonly signal: AbortSignal
}

/** A market's sectors strongest first, each named in the operator's language. */
export interface TradingSectorsView {
  readonly asOf: TradingDay
  readonly sectors: readonly (SectorStrength & { readonly label: string })[]
  readonly caveats: readonly Caveat[]
}

/** A source's health with its last failure in words rather than as a transport code. */
export interface SourceStatus extends SourceSummary {
  readonly failure?: string
}
