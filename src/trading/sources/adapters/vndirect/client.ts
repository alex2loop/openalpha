// Source class: scraping-risky. `api-finfo` is a reverse-engineered internal broker endpoint with
// no SLA — it can change or refuse traffic without notice. The endpoint is code-owned rather than
// operator-typed because it is a provider fact, not a judgment call; a failing fetch degrades to a
// caveat through the normal failover path.
import type { IndexCode } from '@/trading/kernel/market/index-reading'
import type { SourceContext } from '@/trading/kernel/source/source-result'
import { currencyCode } from '@/trading/kernel/instrument'
import { isIndexCode } from '@/trading/kernel/market/index-reading'
import { sourceId } from '@/trading/kernel/source/source-id'

export const VNDIRECT_DEFAULT_ENDPOINT = 'https://api-finfo.vndirect.com.vn'
export const VNDIRECT_ID = sourceId('vndirect')
export const VND = currencyCode('VND')
export const DEFAULT_PAGE_SIZE = 500
/** For a market-wide read, where one page per 500 rows would spend the page budget on a window a
 *  refresh takes in one call. Bounded by `MAXIMUM_RESPONSE_BYTES`, not by the endpoint, which
 *  serves far larger pages: 5,000 stock_prices rows measure 1.93MB against the 2MiB ceiling, which
 *  leaves 8% headroom, and 10,000 measure 3.86MB — refused before parsing, so every name silently
 *  fails over. 4,000 keeps a fifth of the ceiling free for wider rows. */
export const MARKET_PAGE_SIZE = 4_000

/** Day, then code, so a single page holds whole sessions in order. It does not make offset paging
 *  safe - the provider still repeats and drops rows across pages - which is why a window that needs
 *  more than one page goes through `readMarketWindow`. */
export function marketSort(dayField: string, direction: 'asc' | 'desc'): string {
  return `${dayField}:${direction},code:asc`
}

/** Codes per `where=code:` list on `/v4/ratios/latest`, which has no market-wide form. The endpoint
 *  costs about 83ms per code on a cold CDN cache, against `REQUEST_TIMEOUT_MS`: 200 codes measured
 *  16.4s and timed out every run, 100 measured 8.3s. 50 answers in 4.3s, so the deadline keeps more
 *  than double the headroom while a universe-wide sweep still costs under ten requests. */
export const RATIO_BATCH_TICKERS = 50

/** The market-watch socket's HTTP face: a second host, so a second source id for the transport to
 *  pin, meter and break on apart from `api-finfo`. Its path prefix is the endpoint's own. */
export const VNDIRECT_MKW_DEFAULT_ENDPOINT = 'https://mkw-socket-v2.vndirect.com.vn/mkwsocketv2'
export const VNDIRECT_MKW_ID = sourceId('vndirect-mkw')
/** The widget this feed backs states its origin; the host answers without it, but a browser's own
 *  request would carry it. */
export const VNDIRECT_MKW_REFERER = 'https://mkw.vndirect.com.vn/'

/** The index a request names, which both index feeds read from `ticker`: an index is a symbol of
 *  its own here, never an instrument of the market. */
export function contextIndex({ ticker }: SourceContext): IndexCode | undefined {
  return ticker !== undefined && isIndexCode(ticker) ? ticker : undefined
}
