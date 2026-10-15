import type { RegisteredSource } from '@/trading/kernel/source/source-result'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import { binanceFundingSource } from '@/trading/sources/adapters/binance/futures'
import { binanceBarsSource, binanceQuoteSource } from '@/trading/sources/adapters/binance/spot'

export function createBinanceSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [binanceBarsSource(options), binanceQuoteSource(options)]
}

export function createBinanceFuturesSources(
  options: SourceAdapterOptions
): readonly RegisteredSource[] {
  return [binanceFundingSource(options)]
}
