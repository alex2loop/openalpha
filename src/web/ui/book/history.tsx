import { type Signal, useSignal } from '@preact/signals'

import type { LedgerEntryWire } from '@/app/server/wire/money'
import type { MessageKey } from '@/i18n'
import { ROUTES } from '@/web/api/routes'
import { state } from '@/web/state/session'
import { boardScaleNotes } from '@/web/text/market-price'
import { toFailureText, tr } from '@/web/text/tr'
import { LedgerRow } from '@/web/ui/book/ledger-row'
import { useLedger } from '@/web/ui/book/use-ledger'
import { Button } from '@/web/ui/kit/button'
import { Pager } from '@/web/ui/kit/pager'
import { Segmented } from '@/web/ui/kit/segmented'
import { Skeleton } from '@/web/ui/kit/skeleton'

const LEDGER_PAGE = 6

type KindFilter = 'all' | 'buy' | 'sell' | 'dividend'

const KIND_FILTERS: readonly { readonly value: KindFilter; readonly label: MessageKey }[] =
  Object.freeze([
    { value: 'all', label: 'ui.office.book.filterAll' },
    { value: 'buy', label: 'trading.ledger.kind.buy' },
    { value: 'sell', label: 'trading.ledger.kind.sell' },
    { value: 'dividend', label: 'trading.ledger.kind.dividend' },
  ])

/** Lịch sử: the ledger, newest first, six lines a page, filtered by what happened. */
export function History() {
  const ledger = useLedger()
  const filter = useSignal<KindFilter>('all')
  const page = useSignal(0)

  const capability = ROUTES.ledger.capability

  if (capability !== undefined && state.value?.capabilities[capability] === false) {
    return (
      <p class="meta">{tr('ui.office.today.absent', { what: tr('ui.office.book.history') })}</p>
    )
  }

  const kept = ledger.rows.value.filter(
    (entry) => filter.value === 'all' || entry.kind === filter.value
  )
  const shown = kept.slice(page.value * LEDGER_PAGE, (page.value + 1) * LEDGER_PAGE)

  return (
    <section class="block">
      <h2 class="block-head">{tr('ui.office.book.history')}</h2>
      <Segmented
        label={tr('ui.office.book.history')}
        value={filter.value}
        options={KIND_FILTERS.map((option) => ({
          value: option.value,
          label: tr(option.label),
        }))}
        onChange={(value) => {
          filter.value = value
          page.value = 0
        }}
      />
      <LedgerBody
        ledger={ledger}
        shown={shown}
        isEmpty={kept.length === 0}
        isFiltered={filter.value !== 'all'}
      />
      <LedgerPager ledger={ledger} total={kept.length} page={page} />
    </section>
  )
}

type Ledger = ReturnType<typeof useLedger>

interface LedgerBodyProps {
  readonly ledger: Ledger
  readonly shown: readonly LedgerEntryWire[]
  readonly isEmpty: boolean
  readonly isFiltered: boolean
}

function LedgerBody({ ledger, shown, isEmpty, isFiltered }: LedgerBodyProps) {
  return (
    <>
      {ledger.failure.value !== undefined && (
        <div class="strip is-problem" role="alert">
          <span>{toFailureText(ledger.failure.value)}</span>
          <Button size="small" onClick={ledger.loadMore}>
            {tr('ui.office.common.retry')}
          </Button>
        </div>
      )}
      {isEmpty ? (
        <EmptyLedger ledger={ledger} isFiltered={isFiltered} />
      ) : (
        <LedgerRows shown={shown} />
      )}
    </>
  )
}

function EmptyLedger({
  ledger,
  isFiltered,
}: {
  readonly ledger: Ledger
  readonly isFiltered: boolean
}) {
  if (ledger.failure.value !== undefined) {
    return null
  }

  if (ledger.isLoading.value && ledger.rows.value.length === 0) {
    return <Skeleton />
  }

  // Loaded rows with none of this kind say so; the book itself is empty only when nothing loaded.
  const key =
    isFiltered && ledger.rows.value.length > 0
      ? 'ui.office.book.filterEmpty'
      : 'ui.office.book.empty'

  return <p class="meta">{tr(key)}</p>
}

function LedgerRows({ shown }: { readonly shown: readonly LedgerEntryWire[] }) {
  const notes = boardScaleNotes(
    shown.flatMap((entry) => ('instrument' in entry ? [entry.instrument.market] : []))
  )

  return (
    <>
      <div class="ledger">
        {shown.map((entry) => (
          <LedgerRow key={entry.id} entry={entry} />
        ))}
      </div>
      {notes.map((note) => (
        <p key={note} class="meta">
          {note}
        </p>
      ))}
    </>
  )
}

interface LedgerPagerProps {
  readonly ledger: Ledger
  readonly total: number
  readonly page: Signal<number>
}

function LedgerPager({ ledger, total, page }: LedgerPagerProps) {
  return (
    <Pager
      page={page}
      size={LEDGER_PAGE}
      total={total}
      hasMore={ledger.hasMore.value}
      isLoading={ledger.isLoading.value}
      onLoadMore={ledger.loadMore}
    />
  )
}
