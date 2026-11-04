import type { MessageKey } from '@/i18n'
import { BASE_SORTS, type BaseSortKey, type Candidate } from '@/web/edition/screen-sort'
import {
  formatCompactAmount,
  formatSignedCompactAmount,
  formatSignedPercent,
} from '@/web/text/figures'
import { joinInline } from '@/web/text/glyphs'
import { sectorName } from '@/web/text/segment'
import { tr } from '@/web/text/tr'

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

/** The sector, then each figure the name has, as one line; empty when it has none. */
export function figureLine(candidate: Candidate): string {
  const figures = FIGURE_FORMATS.flatMap(([key, format]) => {
    const field = BASE_SORTS[key]
    const value = field === undefined ? undefined : candidate[field]

    return value === undefined ? [] : [`${tr(SORT_LABELS[key])} ${format(value)}`]
  })

  return joinInline([
    ...(candidate.sector === undefined ? [] : [sectorName(candidate.sector)]),
    ...figures,
  ])
}
