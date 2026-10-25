import type { MessageKey } from '@/i18n'
import { type BookTab, bookTab } from '@/web/state/book'
import { ledgerRevision } from '@/web/state/trade'
import { tr } from '@/web/text/tr'
import { History } from '@/web/ui/book/history'
import { Overview } from '@/web/ui/book/overview'
import { Performance } from '@/web/ui/book/performance'
import { Rebalance } from '@/web/ui/book/rebalance'
import { Watch } from '@/web/ui/book/watch'
import { Segmented } from '@/web/ui/kit/segmented'

import './book.css'

const BOOK_TABS: readonly { readonly value: BookTab; readonly label: MessageKey }[] = Object.freeze(
  [
    { value: 'overview', label: 'ui.office.book.overview' },
    { value: 'performance', label: 'ui.office.book.performance' },
    { value: 'history', label: 'ui.office.book.history' },
    { value: 'rebalance', label: 'ui.office.book.rebalance' },
    { value: 'watch', label: 'ui.office.book.watch' },
  ]
)

/** Danh mục: five sub-tabs over the operator's book. The one open is remembered. */
export function Book() {
  return (
    <>
      <Segmented
        label={tr('trading.render.affordance.portfolio')}
        value={bookTab.value}
        options={BOOK_TABS.map((tab) => ({ value: tab.value, label: tr(tab.label) }))}
        onChange={(value) => {
          bookTab.value = value
        }}
      />
      <BookView tab={bookTab.value} />
    </>
  )
}

function BookView({ tab }: { readonly tab: BookTab }) {
  switch (tab) {
    case 'overview':
      return <Overview />
    case 'performance':
      return <Performance />
    case 'history':
      // A saved, edited or deleted row starts the ledger over, so the list shows it.
      return <History key={ledgerRevision.value} />
    case 'rebalance':
      return <Rebalance />
    case 'watch':
      return <Watch />
  }
}
