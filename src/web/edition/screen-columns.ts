import type { MessageKey } from '@/i18n'
import type { BaseSortKey } from '@/web/edition/screen-sort'
import { tr } from '@/web/text/tr'

/** What names each sort, in the sort menu. */
export const SORT_LABELS: Readonly<Record<BaseSortKey, MessageKey>> = Object.freeze({
  ticker: 'ui.office.edition.screen.sort.ticker',
  price: 'ui.office.edition.screen.sort.price',
  change: 'ui.office.edition.screen.sort.change',
  month: 'ui.office.edition.screen.sort.month',
  turnover: 'ui.office.edition.screen.sort.turnover',
  marketCap: 'ui.office.edition.screen.sort.marketCap',
  foreignNet: 'ui.office.edition.screen.sort.foreignNet',
})

/** A label that may name the span its figure is measured over (`{sessions}`), as the wire states it. */
export function labelled(label: MessageKey, sessions?: number): string {
  return tr(label, sessions === undefined ? {} : { sessions })
}
