import type { RegisteredSource } from '@/trading/kernel/source/source-result'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import { secEventsSource } from '@/trading/sources/adapters/sec/filings'
import { secAccountsSource } from '@/trading/sources/adapters/sec/frames'
import { createTickerMapReader } from '@/trading/sources/adapters/sec/tickers'

/** Both sources read the same ticker map. `sec-data`'s sources call the `sec` host for it and for
 *  the filing archive - the first requests in this codebase made under another source's id - because
 *  those paths are served there and nowhere else. */
export function createSecSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  const readTickers = createTickerMapReader(options.http)

  return [secAccountsSource(options, readTickers), secEventsSource(options, readTickers)]
}
