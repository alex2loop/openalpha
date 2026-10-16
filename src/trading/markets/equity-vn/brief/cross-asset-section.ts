import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { BriefContext } from '@/trading/markets/equity-vn/brief/context'
import { absent, omitted, ready } from '@/trading/markets/equity-vn/brief/sections'
import { quoteBoardMoveOf } from '@/trading/render/price-pair'

/** One instrument failing omits its row, not the section; every instrument failing is the only case
 *  that makes the section unavailable. With nothing watchlisted the section is omitted: every market
 *  now carries its own block, so a brief is never silent about gold or crypto. */
export async function buildCrossAssetPulse(context: BriefContext): Promise<BriefSectionResult> {
  const { names, caveats: capped } = context.crossAssetNames

  if (names.length === 0) {
    return omitted('cross-asset-pulse')
  }

  const quoteBoard = await context.services.quoteBoard({
    instruments: names,
    signal: context.request.signal,
  })
  const caveats = [...capped, ...quoteBoard.caveats]

  return quoteBoard.items.length === 0
    ? absent('cross-asset-pulse', caveats)
    : ready(
        'cross-asset-pulse',
        // The one section whose rows can come from different markets, so each carries the currency
        // its price is in, and the market it belongs to wherever the list spans more than one -
        // USD/oz, VND/lượng and USD/coin otherwise read as one column of comparable numbers.
        quoteBoard.items.map((item) => {
          const changePct = quoteBoardMoveOf(item)

          return {
            ticker: item.ticker,
            ...(spansMarkets(quoteBoard.items) ? { market: item.market } : {}),
            last: item.last,
            currency: item.currency,
            ...(changePct === undefined ? {} : { changePct }),
          }
        }),
        { caveats }
      )
}

function spansMarkets(items: readonly { readonly market: string }[]): boolean {
  return new Set(items.map((item) => item.market)).size > 1
}
