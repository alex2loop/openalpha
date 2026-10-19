import type { Locale } from '@/core/types/locale'
import type { MarketRef } from '@/trading/kernel/instrument'
import { renderDeclaredValue } from '@/trading/render/format'
import { renderBlockRule } from '@/trading/render/section'

/** Rows that share a quoting market, in the order that market first appeared in the list. Named for
 *  the two signatures below rather than for callers: every caller passes a block straight back. */
interface MarketBlock<T> {
  readonly market: MarketRef
  readonly rows: readonly T[]
}

/** First appearance rather than a sort: the three lists that use this have no comparable magnitude
 *  between them, and the caller's own order is the one the reader has already been given. */
export function toMarketBlocks<T>(
  rows: readonly T[],
  marketOf: (row: T) => MarketRef
): readonly MarketBlock<T>[] {
  const byMarket = new Map<MarketRef, T[]>()

  for (const row of rows) {
    const market = marketOf(row)
    const kept = byMarket.get(market)

    if (kept === undefined) {
      byMarket.set(market, [row])
      continue
    }

    kept.push(row)
  }

  return [...byMarket].map(([market, grouped]) => ({ market, rows: grouped }))
}

/** The rule is what a list spanning markets uses to say which rows belong to which. One market
 *  needs no rule: the reader has nothing to tell it apart from, and a lone rule around the whole
 *  list names what they already knew. */
export function renderMarketBlocks<T>(
  locale: Locale,
  blocks: readonly MarketBlock<T>[],
  options: {
    readonly icons: ReadonlyMap<MarketRef, string>
    readonly renderRows: (rows: readonly T[]) => readonly string[]
  }
): readonly string[] {
  const [only] = blocks

  if (blocks.length <= 1) {
    return only === undefined ? [] : options.renderRows(only.rows)
  }

  return blocks.flatMap((block) => [
    renderBlockRule(
      options.icons.get(block.market),
      renderDeclaredValue(locale, `trading.market.${block.market}`)
    ),
    ...options.renderRows(block.rows),
  ])
}
