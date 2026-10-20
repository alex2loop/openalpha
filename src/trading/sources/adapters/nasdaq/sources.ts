import type { RegisteredSource } from '@/trading/kernel/source/source-result'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import { nasdaqBarsSource } from '@/trading/sources/adapters/nasdaq/bars'
import { nasdaqEventsSource } from '@/trading/sources/adapters/nasdaq/dividends'
import { nasdaqQuoteSource } from '@/trading/sources/adapters/nasdaq/quote'
import {
  nasdaqFundamentalsSource,
  nasdaqInstrumentsSource,
} from '@/trading/sources/adapters/nasdaq/screener'

export function createNasdaqSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [
    nasdaqInstrumentsSource(options),
    nasdaqFundamentalsSource(options),
    nasdaqQuoteSource(options),
    nasdaqBarsSource(options),
    nasdaqEventsSource(options),
  ]
}
