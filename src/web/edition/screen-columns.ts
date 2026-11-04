import type { MessageKey } from '@/i18n'
import { type BaseSortKey, baseFigureOf, type Candidate } from '@/web/edition/screen-sort'
import {
  formatCompactAmount,
  formatFixed,
  formatSignedCompactAmount,
  formatSignedPercent,
} from '@/web/text/figures'
import { joinList } from '@/web/text/glyphs'
import { sectorName } from '@/web/text/segment'
import { tr } from '@/web/text/tr'

const PERCENTILE_DIGITS = 0
const WORD_BREAK = /\s+/

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
    const value = baseFigureOf(candidate, key)

    return value === undefined ? [] : [{ label: tr(SORT_LABELS[key]), value: format(value) }]
  })

  return [
    ...(candidate.sector === undefined ? [] : [{ value: sectorName(candidate.sector) }]),
    ...figures,
  ]
}

/** The plain values the name's market states beside its factors, as the CLI words them. */
export function readingFacts(candidate: Candidate): readonly Fact[] {
  return (candidate.readings ?? []).map(({ text }) => ({ value: text }))
}

/** What each factor read for the name in the quantities it was scored on, and where that sits on
 *  the board; a factor with neither says nothing. Words the reading opens with that the factor's
 *  name already says (at its start or its end) are said once. */
export function factorFacts(candidate: Candidate): readonly Fact[] {
  return (candidate.factors ?? []).flatMap(({ label, reading, percentile }): readonly Fact[] => {
    const parts = [
      ...(reading === undefined ? [] : [withoutRepeat(label, reading)]),
      ...(percentile === undefined
        ? []
        : [
            tr('ui.office.edition.screen.factorPlace', {
              pct: formatFixed(percentile, PERCENTILE_DIGITS),
            }),
          ]),
    ].filter((part) => part !== '')

    return parts.length === 0 ? [] : [{ label, value: joinList(parts) }]
  })
}

/** The reading without the leading words the label already holds at its start or at its end:
 *  "Dòng tiền khối ngoại" over "ngoại ròng 20 phiên" reads on as "ròng 20 phiên". */
function withoutRepeat(label: string, reading: string): string {
  const named = label.toLowerCase().split(WORD_BREAK)
  const words = reading.split(WORD_BREAK)
  const lead = words.map((word) => word.toLowerCase())

  for (let size = Math.min(named.length, words.length); size > 0; size--) {
    const head = lead.slice(0, size).join(' ')

    if (named.slice(0, size).join(' ') === head || named.slice(-size).join(' ') === head) {
      return words.slice(size).join(' ')
    }
  }

  return reading
}
