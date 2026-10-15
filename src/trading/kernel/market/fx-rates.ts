import type { CurrencyCode, TradingDay } from '@/trading/kernel/instrument'
import type { FxQuote } from '@/trading/kernel/market/market-data'
import type { SourceResult } from '@/trading/kernel/source/source-result'

export interface FxConvertOptions {
  readonly fromCurrency: CurrencyCode
  readonly toCurrency: CurrencyCode
  readonly asOf: TradingDay
  /** The rate `asOf` itself closed at, not the latest: a trade booked after its day. */
  readonly onDay?: true
  readonly signal: AbortSignal
}

/** The one path every currency conversion goes through - the ledger's, the portfolio's, and the
 *  evidence a market reads for itself. Declared in the kernel because those consumers sit in
 *  different modules and none of them may hold a source registry. */
export interface FxRates {
  convert(options: FxConvertOptions): Promise<SourceResult<FxQuote>>
}
