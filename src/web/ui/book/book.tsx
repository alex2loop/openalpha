import type { MessageKey } from '@/i18n'
import { type BookTab, bookTab } from '@/web/state/book'
import { state } from '@/web/state/session'
import { ledgerRevision } from '@/web/state/trade'
import { tr } from '@/web/text/tr'
import { History } from '@/web/ui/book/history'
import { Orders } from '@/web/ui/book/orders'
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
    { value: 'orders', label: 'ui.office.book.orders' },
  ]
)

/** Danh mục: sub-tabs over the operator's book, Lệnh only where a venue places orders. The one
 *  open is remembered; Lệnh falls back to the overview once orders go away. */
export function Book() {
  const hasOrders = state.value?.capabilities.orders === true
  const tabs = BOOK_TABS.filter((tab) => tab.value !== 'orders' || hasOrders)
  const shown = tabs.some((tab) => tab.value === bookTab.value) ? bookTab.value : 'overview'

  return (
    <>
      <Segmented
        label={tr('trading.render.affordance.portfolio')}
        value={shown}
        options={tabs.map((tab) => ({ value: tab.value, label: tr(tab.label) }))}
        onChange={(value) => {
          bookTab.value = value
        }}
      />
      <BookView tab={shown} />
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
    case 'orders':
      return <Orders />
  }
}
