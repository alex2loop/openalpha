import type { RegisteredSource } from '@/trading/kernel/source/source-result'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import { barsSource } from '@/trading/sources/adapters/vndirect/bars'
import { commoditiesSource } from '@/trading/sources/adapters/vndirect/commodities'
import { eventsSource } from '@/trading/sources/adapters/vndirect/events'
import { flowsSource } from '@/trading/sources/adapters/vndirect/flows'
import { foreignRoomSource } from '@/trading/sources/adapters/vndirect/foreign-room'
import { fundamentalsSource } from '@/trading/sources/adapters/vndirect/fundamentals'
import { instrumentsSource } from '@/trading/sources/adapters/vndirect/instruments'
import { macroSource } from '@/trading/sources/adapters/vndirect/macro'
import { newsSource } from '@/trading/sources/adapters/vndirect/news'
import { quoteSource } from '@/trading/sources/adapters/vndirect/quote'
import { recommendationsSource } from '@/trading/sources/adapters/vndirect/recommendations'
import { sessionQuotesSource } from '@/trading/sources/adapters/vndirect/session-quotes'
import { valuationSource } from '@/trading/sources/adapters/vndirect/valuation'

export function createVndirectSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [
    instrumentsSource(options),
    barsSource(options),
    quoteSource(options),
    sessionQuotesSource(options),
    flowsSource(options),
    foreignRoomSource(options),
    recommendationsSource(options),
    fundamentalsSource(options),
    eventsSource(options),
    macroSource(options),
    commoditiesSource(options),
    valuationSource(options),
    newsSource(options),
  ]
}
