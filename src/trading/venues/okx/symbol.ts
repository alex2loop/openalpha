import { OKX_QUOTE_ASSET } from '@/trading/venues/okx/transport'

const SYMBOL_SEPARATOR = '-'

/** The instrument OKX addresses a base asset by, against the one currency this venue settles in. */
export function toPair(asset: string): string {
  return `${asset}${SYMBOL_SEPARATOR}${OKX_QUOTE_ASSET}`
}

/** The base asset an `instId` names, or undefined where the pair settles in anything else: one base
 *  carries a different floor and a different book against each quote it trades in. */
export function toTicker(symbol: string): string | undefined {
  const [base, quote] = symbol.split(SYMBOL_SEPARATOR)

  return quote === OKX_QUOTE_ASSET && base !== undefined && base !== '' ? base : undefined
}
