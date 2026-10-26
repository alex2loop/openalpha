import { type Signal, useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

import type { LedgerEntryWire } from '@/app/server/wire/money'
import { ROUTES } from '@/web/api/routes'
import { state } from '@/web/state/session'
import { clearFlashedEntry, flashedEntry, type LedgerKind } from '@/web/state/trade'
import { boardScaleNotes } from '@/web/text/market-price'
import { tr } from '@/web/text/tr'
import { EmptyBookActions } from '@/web/ui/book/empty-actions'
import { FailureStrip } from '@/web/ui/book/failure-strip'
import { LedgerRow } from '@/web/ui/book/ledger-row'
import { openReconcileDialog } from '@/web/ui/book/reconcile-dialog'
import { useLedger } from '@/web/ui/book/use-ledger'
import { openTradeDialog } from '@/web/ui/dialogs/trade-dialog'
import { OTHER_KINDS } from '@/web/ui/dialogs/trade-kinds'
import { Button } from '@/web/ui/kit/button'
import { Pager } from '@/web/ui/kit/pager'
import { Skeleton } from '@/web/ui/kit/skeleton'

const LEDGER_PAGE = 6
// The row just saved stays marked this long, which covers the read that brings it in.
const FLASH_CLEAR_MS = 4_000

type KindFilter = 'all' | LedgerKind

const KIND_FILTERS: readonly KindFilter[] = Object.freeze([
  'all',
  'buy',
  'sell',
  ...OTHER_KINDS.map((other) => other.kind),
])

/** Lịch sử: the ledger, newest first, six lines a page, filtered by what happened. */
export function History() {
  const ledger = useLedger()
  const filter = useSignal<KindFilter>('all')
  const page = useSignal(0)

  useClearedFlash()

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
      <div class="step-actions">
        <Button size="small" onClick={() => openTradeDialog()}>
          {tr('ui.office.common.recordTrade')}
        </Button>
        <Button size="small" onClick={openReconcileDialog}>
          {tr('ui.office.reconcile.open')}
        </Button>
        <FilterMenu filter={filter} page={page} />
      </div>
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

// The many kinds read as one menu at any width, as the trade dialog's other kinds do.
function FilterMenu({
  filter,
  page,
}: {
  readonly filter: Signal<KindFilter>
  readonly page: Signal<number>
}) {
  return (
    <select
      aria-label={tr('ui.office.book.filterKind')}
      title={tr('ui.office.book.filterKind')}
      value={filter.value}
      onChange={(event) => {
        const picked = KIND_FILTERS.find((value) => value === event.currentTarget.value)

        if (picked !== undefined) {
          filter.value = picked
          page.value = 0
        }
      }}
    >
      {KIND_FILTERS.map((value) => (
        <option key={value} value={value}>
          {value === 'all' ? tr('ui.office.book.filterAll') : tr(`trading.ledger.kind.${value}`)}
        </option>
      ))}
    </select>
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
        <FailureStrip failure={ledger.failure.value} retry={ledger.loadMore} />
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

  return (
    <>
      <p class="meta">{tr(key)}</p>
      {key === 'ui.office.book.empty' && <EmptyBookActions />}
    </>
  )
}

function LedgerRows({ shown }: { readonly shown: readonly LedgerEntryWire[] }) {
  const notes = boardScaleNotes(
    shown.flatMap((entry) => ('instrument' in entry ? [entry.instrument.market] : []))
  )

  return (
    <>
      <div class="ledger">
        {shown.map((entry) => (
          <LedgerRow key={entry.id} entry={entry} isFlashed={entry.id === flashedEntry.value} />
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

// The saved row is marked once; the mark goes when the time has passed or the tab is left.
function useClearedFlash(): void {
  const flashed = flashedEntry.value

  useEffect(() => {
    if (flashed === undefined) {
      return undefined
    }

    const timer = setTimeout(clearFlashedEntry, FLASH_CLEAR_MS)

    return () => clearTimeout(timer)
  }, [flashed])
}
