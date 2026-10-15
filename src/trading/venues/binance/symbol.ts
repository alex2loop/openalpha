import { BINANCE_QUOTE_ASSET } from '@/trading/venues/binance/transport'

/** The pair Binance addresses a base asset by, against the one currency this venue settles in. */
export function toBinancePair(asset: string): string {
  return `${asset}${BINANCE_QUOTE_ASSET}`
}

/** The base asset a pair names, or undefined where the pair settles in anything else. */
export function toBinanceTicker(symbol: string): string | undefined {
  if (!symbol.endsWith(BINANCE_QUOTE_ASSET)) {
    return undefined
  }

  const base = symbol.slice(0, -BINANCE_QUOTE_ASSET.length)

  return base === '' ? undefined : base
}
