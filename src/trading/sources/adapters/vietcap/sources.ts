import type { RegisteredSource } from '@/trading/kernel/source/source-result'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import { boardQuotesSource, boardRoomSource } from '@/trading/sources/adapters/vietcap/board'
import { chartBarsSource, chartQuoteSource } from '@/trading/sources/adapters/vietcap/chart'
import { indexMembershipSource } from '@/trading/sources/adapters/vietcap/index-membership'
import { statementsSource } from '@/trading/sources/adapters/vietcap/statements'
import { tradeSidesSource } from '@/trading/sources/adapters/vietcap/trade-sides'

export function createVietcapSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [
    indexMembershipSource(options),
    tradeSidesSource(options),
    boardQuotesSource(options),
    boardRoomSource(options),
    chartBarsSource(options),
    chartQuoteSource(options),
    statementsSource(options),
  ]
}
