import type { MessageKey } from '@/i18n'
import { BASE_SORTS, type BaseSortKey, type Candidate } from '@/web/edition/screen-sort'
import {
  formatCompactAmount,
  formatFixed,
  formatSignedCompactAmount,
  formatSignedFixed,
  formatSignedPercent,
} from '@/web/text/figures'
import { sectorName } from '@/web/text/segment'
import { tr } from '@/web/text/tr'

const FACTOR_VALUE_DIGITS = 2
const PERCENTILE_DIGITS = 0

/** What names each sort, in the sort menu, the figures under a name and the CSV header. */
export const SORT_LABELS: Readonly<Record<BaseSortKey, MessageKey>> = Object.freeze({
  ticker: 'ui.office.edition.screen.sort.ticker',
  price: 'ui.office.edition.screen.sort.price',
  change: 'ui.office.edition.screen.sort.change',
  month: 'ui.office.edition.screen.sort.month',
  turnover: 'ui.office.edition.screen.sort.turnover',
  marketCap: 'ui.office.edition.screen.sort.marketCap',
  foreignNet: 'ui.office.edition.screen.sort.foreignNet',
})

/** The figures a name carries beyond its price and day's move, in the order they print, each with
 *  how the page writes it. */
const FIGURE_FORMATS: readonly (readonly [BaseSortKey, (value: number | undefined) => string])[] =
  Object.freeze([
    ['month', formatSignedPercent],
    ['turnover', formatCompactAmount],
    ['marketCap', formatCompactAmount],
    ['foreignNet', formatSignedCompactAmount],
  ])

/** One thing the board says about a name: its label, where it has one, and the reading that must
 *  not be split from it. */
export interface Fact {
  readonly label?: string
  readonly value: string
}

/** The sector, then each figure the name has beyond its price and day's move. */
export function figureFacts(candidate: Candidate): readonly Fact[] {
  const figures = FIGURE_FORMATS.flatMap(([key, format]): readonly Fact[] => {
    const field = BASE_SORTS[key]
    const value = field === undefined ? undefined : candidate[field]

    return value === undefined ? [] : [{ label: tr(SORT_LABELS[key]), value: format(value) }]
  })

  return [
    ...(candidate.sector === undefined ? [] : [{ value: sectorName(candidate.sector) }]),
    ...figures,
  ]
}

/** What each factor read for the name and where that sits on the board. */
export function factorFacts(candidate: Candidate): readonly Fact[] {
  return (candidate.factors ?? []).map(({ label, value, percentile }) => {
    const reading = formatSignedFixed(value, FACTOR_VALUE_DIGITS)

    return {
      label,
      value:
        percentile === undefined
          ? reading
          : tr('ui.office.edition.screen.factorValue', {
              value: reading,
              pct: formatFixed(percentile, PERCENTILE_DIGITS),
            }),
    }
  })
}
