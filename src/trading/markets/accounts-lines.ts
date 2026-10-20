import type { AccountLines } from '@/trading/kernel/market/annual-accounts'

/** A quotient over a non-positive or non-finite denominator is not a reading. */
export function ratioOf(
  numerator: number | undefined,
  denominator: number | undefined
): number | undefined {
  if (
    numerator === undefined ||
    denominator === undefined ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0
  ) {
    return undefined
  }

  return numerator / denominator
}

export function growthOf(now: number | undefined, before: number | undefined): number | undefined {
  const ratio = ratioOf(now, before)

  return ratio === undefined ? undefined : ratio - 1
}

/** Absent when any part is: a partial sum read as the whole is how an absent line becomes a zero. */
export function sumOf(values: readonly (number | undefined)[]): number | undefined {
  let total = 0

  for (const value of values) {
    if (value === undefined) {
      return undefined
    }

    total += value
  }

  return total
}

export function differenceOf(
  minuend: number | undefined,
  subtrahend: number | undefined
): number | undefined {
  return minuend === undefined || subtrahend === undefined ? undefined : minuend - subtrahend
}

/** Core operating profit is gross profit less selling and admin. The filing's own operating profit
 *  line already nets financial income and interest. */
export function coreOperatingProfitOf(lines: AccountLines): number | undefined {
  return differenceOf(lines.grossProfit, sumOf([lines.sellingExpenses, lines.adminExpenses]))
}

export function averageOf(
  first: number | undefined,
  second: number | undefined
): number | undefined {
  const total = sumOf([first, second])

  return total === undefined ? undefined : total / 2
}

export function totalOf(
  reports: readonly AccountLines[],
  line: keyof AccountLines
): number | undefined {
  return sumOf(reports.map((lines) => lines[line]))
}
