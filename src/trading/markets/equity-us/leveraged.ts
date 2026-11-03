import type { InstrumentRecord } from '@/trading/kernel/market/market-data'
import { ETF_KIND } from '@/trading/kernel/instrument'

/** Nasdaq carries no leverage field, so the fund's name is the only signal, and the store keeps
 *  only its first 62 characters, so the exclusions match word stems ("dur" for "duration"). They
 *  keep out the funds that say "short" or "leveraged" about something else: a short maturity, a
 *  long-short strategy, a loan. */
const LEVERAGED_FUND_NAME_PATTERN = new RegExp(
  [
    String.raw`\bultrapro\b`,
    String.raw`\bproshares (?:trust )?(?:proshares )?ultra\b`,
    String.raw`\b(?:[2-9]|1\.[1-9])x\b`,
    String.raw`\bleveraged\b(?! loan)`,
    String.raw`\binverse\b`,
    String.raw`\bbear\b`,
    String.raw`\bbull\b`,
    String.raw`(?<!ultra[ -]|long[ -]|/)\bshort\b(?![ -]?(term|dur|maturit|horizon|treasur|bond|income|muni|government|high))`,
  ].join('|'),
  'i'
)

/** ProShares writes its inverse funds as one camel-case word; a bond fund writes "Ultrashort" in
 *  lower case, so only this spelling is read case-sensitively. */
const ULTRA_SHORT_FUND_NAME_PATTERN = /\bUltraShort\b(?! (Income|Bond|Fixed|Municipal))/

/** A leveraged or inverse fund resets daily, so held for weeks it drifts from the index it tracks. */
export function isLeveragedFund(record: Pick<InstrumentRecord, 'kind' | 'name'>): boolean {
  return (
    record.kind === ETF_KIND &&
    (LEVERAGED_FUND_NAME_PATTERN.test(record.name) ||
      ULTRA_SHORT_FUND_NAME_PATTERN.test(record.name))
  )
}
