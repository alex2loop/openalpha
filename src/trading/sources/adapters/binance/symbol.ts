import type { Caveat } from '@/trading/kernel/caveat'
import type { SourceContext } from '@/trading/kernel/source/source-result'
import { BINANCE_ID, QUOTE_ASSET } from '@/trading/sources/adapters/binance/client'
import { fromCodeTable } from '@/trading/sources/rows/normalization'

/** A different asset served in place of the one asked for. The substitution declares itself
 *  through `spotProxyCaveats` rather than leaving every reader to discover it. */
const SPOT_PROXY_SYMBOLS: Readonly<Record<string, string>> = Object.freeze({
  XAUUSD: 'PAXGUSDT',
})

const TOKEN_PROXY_CAVEAT: Caveat = { code: 'source.token-proxy', detail: { source: BINANCE_ID } }

export function spotSymbol(ticker: string): string {
  return fromCodeTable(SPOT_PROXY_SYMBOLS, ticker) ?? `${ticker}${QUOTE_ASSET}`
}

/** Contracts the futures board lists under a scaled base — `1000SHIBUSDT` holds a thousand SHIB.
 *  The scale never reaches a caller: a funding rate is a percentage and the open-interest reading
 *  is a ratio against its own mean, so both are contract-size invariant. It is a name, not a proxy,
 *  so it carries no substitution caveat. Re-derive with /fapi/v1/exchangeInfo when a contract is
 *  added; a name missing here leaves funding absent, which is the behaviour without the table. */
const FUTURES_CONTRACT_SYMBOLS: Readonly<Record<string, string>> = Object.freeze({
  BABYDOGE: '1MBABYDOGEUSDT',
  BOB: '1000000BOBUSDT',
  BONK: '1000BONKUSDT',
  CAT: '1000CATUSDT',
  CHEEMS: '1000CHEEMSUSDT',
  FLOKI: '1000FLOKIUSDT',
  LUNC: '1000LUNCUSDT',
  MOG: '1000000MOGUSDT',
  PEPE: '1000PEPEUSDT',
  RATS: '1000RATSUSDT',
  SATS: '1000SATSUSDT',
  SHIB: '1000SHIBUSDT',
  XEC: '1000XECUSDT',
})

export function futuresSymbol(ticker: string): string {
  return fromCodeTable(FUTURES_CONTRACT_SYMBOLS, ticker) ?? `${ticker}${QUOTE_ASSET}`
}

/** Set only where the override table answers: the one case where the symbol served is not the
 *  instrument asked for. */
export function spotProxyCaveats(context: SourceContext): readonly Caveat[] {
  const ticker = context.instrument?.ticker

  return ticker !== undefined && fromCodeTable(SPOT_PROXY_SYMBOLS, ticker) !== undefined
    ? [TOKEN_PROXY_CAVEAT]
    : []
}
