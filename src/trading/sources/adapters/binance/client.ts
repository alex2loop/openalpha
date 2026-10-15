import { sourceId } from '@/trading/kernel/source/source-id'

export const BINANCE_ID = sourceId('binance')
export const BINANCE_FUTURES_ID = sourceId('binance-futures')

export const BINANCE_DEFAULT_ENDPOINT = 'https://api.binance.com'
export const BINANCE_FUTURES_DEFAULT_ENDPOINT = 'https://fapi.binance.com'

/** Every pair this adapter reads is quoted in USDT on both the spot and the futures board. */
export const QUOTE_ASSET = 'USDT'

/** Binance documents an unlisted symbol as HTTP 400. The core seam discards non-2xx bodies, so the
 *  status is the only signal available — and a mistyped ticker must not take the provider offline
 *  for every other symbol. */
export const SYMBOL_MISS_STATUSES: readonly number[] = Object.freeze([400])

/** A halted pair keeps answering its last trade indefinitely — LITUSDT still quoted its 2025-02-10
 *  close after the delisting, against a series another venue was still publishing. Asking for the
 *  status turns that into the 400 the failover already reads. */
export const TRADING_STATUS = 'TRADING'
