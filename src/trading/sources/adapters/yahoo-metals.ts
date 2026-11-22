import type { TradingDay } from '@/trading/kernel/instrument'
import { fromCodeTable } from '@/trading/sources/rows/normalization'

/** CME month codes, indexed by calendar month. */
const FUTURES_MONTH_CODES = 'FGHJKMNQUVXZ'
const COMEX_SUFFIX = '.CMX'
const FUTURES_ROOT_SUFFIX = '=F'

/** Yahoo lists neither metal at its spot symbol, and the undated root charts the spot month running
 *  into expiry while answering a quote from the active one — 73 gold lots against December's
 *  201,300 on 2026-09-11. The delivery months each metal actually trades in size are the research
 *  decision that keeps one instrument on both legs; measure volume before changing either tuple. */
const METAL_DELIVERY_MONTHS: Readonly<Record<string, { root: string; months: readonly number[] }>> =
  Object.freeze({
    XAUUSD: { root: 'GC', months: [2, 4, 6, 8, 12] },
    XAGUSD: { root: 'SI', months: [3, 5, 7, 9, 12] },
  })

/** The symbol Yahoo lists a metal's futures under, or undefined for a ticker that is not a metal. */
export function metalSymbolOf(ticker: string, day: TradingDay | undefined): string | undefined {
  const metal = fromCodeTable(METAL_DELIVERY_MONTHS, ticker)

  return metal === undefined ? undefined : metalSymbol(metal, day)
}

/** The nearest delivery month strictly after the one being read, which is never the spot month in
 *  expiry. A request carrying no day is the quote, and the undated root answers that one from the
 *  active contract through `meta` — measured 2026-09-11, `GC=F` meta 4.408,90 against `GCZ26.CMX`
 *  4.408,90 — so both legs read the same instrument. The root's own bar series does not, which is
 *  why the dated symbol is what the window asks for. */
function metalSymbol(
  metal: { readonly root: string; readonly months: readonly number[] },
  day: TradingDay | undefined
): string {
  const year = day === undefined ? Number.NaN : Number(day.slice(0, 4))
  const month = day === undefined ? Number.NaN : Number(day.slice(5, 7))

  if (!(Number.isInteger(year) && Number.isInteger(month))) {
    return `${metal.root}${FUTURES_ROOT_SUFFIX}`
  }

  const next = metal.months.find((candidate) => candidate > month)
  const delivery = next ?? metal.months[0]

  if (delivery === undefined) {
    return `${metal.root}${FUTURES_ROOT_SUFFIX}`
  }

  const code = FUTURES_MONTH_CODES[delivery - 1]
  const deliveryYear = String((next === undefined ? year + 1 : year) % 100).padStart(2, '0')

  return `${metal.root}${code}${deliveryYear}${COMEX_SUFFIX}`
}
