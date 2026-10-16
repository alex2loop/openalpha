import type { Rates } from '@/trading/features/portfolio/folds/currency-cash'
import type { Book } from '@/trading/kernel/operator/book'

export function totalCostBase(book: Book): number {
  return book.positions.reduce((sum, position) => sum + position.costBasisBase, 0)
}

export function totalFeesBase(book: Book): number {
  return book.positions.reduce((sum, position) => sum + position.costBasisFeesBase, 0)
}

/** Currency-move share of unrealized P/L; undefined, not zero, for an all-base book. */
export function unrealizedFxPnlBase(book: Book, rates: Rates): number | undefined {
  const foreign = book.positions.filter((position) => position.currency !== book.baseCurrency)

  if (foreign.length === 0) {
    return undefined
  }

  return foreign.reduce((sum, position) => {
    const rate = rates.get(position.currency)

    if (rate === undefined || rate.kind === 'unavailable') {
      return sum
    }

    return sum + (position.costBasisNative * rate.value.rate - position.costBasisBase)
  }, 0)
}
