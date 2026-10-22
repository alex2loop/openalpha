import type { Locale } from '@/core/types/locale'
import type {
  LedgerDayRange,
  LedgerEntry,
  LedgerTxn,
  LedgerTxnDraftInput,
  LedgerTxnKind,
} from '@/trading/features/ledger/types'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type {
  CurrencyCode,
  InstrumentRef,
  MarketRef,
  TradingDay,
  VenueRef,
} from '@/trading/kernel/instrument'
import type { Book, LedgerEntryId } from '@/trading/kernel/operator/book'
import type { Page } from '@/trading/kernel/store/page'
import type { QuoteConvention } from '@/trading/render/money'
import { formatDay, t } from '@/i18n'
import { cashDeltaBase } from '@/trading/features/ledger/book'
import { paysFromCurrencyCash } from '@/trading/features/ledger/fx-rate'
import { quoteConventionsFor } from '@/trading/features/market-data/command/quote-conventions'
import { toIdHandle } from '@/trading/kernel/instrument'
import { SELL_ALL } from '@/trading/kernel/surface/surface'
import {
  formatCount,
  formatQuantity,
  renderDeclaredValue,
  renderVenueName,
  SECTION_ICONS,
} from '@/trading/render/format'
import {
  INDENT,
  INLINE_SEPARATOR,
  joinSections,
  renderEmptyLine,
  renderSectionTitle,
} from '@/trading/render/layout'
import {
  formatRecordedMoney,
  formatRecordedPrice,
  formatSignedMoney,
  quotedInOf,
  renderBoardScaleNotes,
} from '@/trading/render/money'
import { ABSENT_CELL } from '@/trading/render/number'

/** The row a recorded transaction prints as, shared by the history page, an approval prompt and
 *  the sync confirmation, so no two surfaces describe one transaction differently. */
const PRICE_AT = '@'
const NOTE_DASH = '—'
/** A note is the operator's own free text; on a page of rows only its start is read, and the full
 *  text stays on the row `/update` shows. */
const NOTE_PREVIEW_CHARACTERS = 60
const NOTE_ELLIPSIS = '…'

interface LedgerView {
  readonly baseCurrency: CurrencyCode
  /** The book today, to tell which rows moved cash at the venue's currency-cash cost. */
  readonly book: Book
  readonly quoteConventions: ReadonlyMap<MarketRef, QuoteConvention>
  readonly range?: LedgerDayRange
}

export function renderLedgerText(
  locale: Locale,
  page: Page<LedgerEntry, LedgerEntryId>,
  view: LedgerView
): string {
  const range = renderDayRange(locale, view.range)

  if (page.items.length === 0) {
    const empty =
      range === undefined
        ? t(locale, 'trading.render.ledger.empty')
        : t(locale, 'trading.render.ledger.rangeEmpty', { range })

    return renderEmptyLine(SECTION_ICONS.ledger, empty)
  }

  const title =
    range === undefined
      ? t(locale, 'trading.render.ledger.title')
      : t(locale, 'trading.render.ledger.rangeTitle', { range })

  return joinSections([
    [renderSectionTitle(SECTION_ICONS.ledger, title)],
    ...dayGroups(page.items).map(([day, entries]) => [
      formatDay(locale, day),
      ...entries.map((entry) => `${INDENT[1]}${renderDayEntry(locale, entry, view)}`),
    ]),
    [
      renderPageSummary(locale, page.items, view),
      ...(page.nextCursor === undefined ? [] : [renderMoreLine(locale)]),
      ...renderBoardScaleLines(locale, page.items, view),
    ],
  ])
}

/** The window is part of the title, so a page read for one stretch never passes for the latest
 *  rows. Absent where neither end is bound. */
function renderDayRange(locale: Locale, range: LedgerDayRange | undefined): string | undefined {
  const from = range?.fromDay === undefined ? undefined : formatDay(locale, range.fromDay)
  const to = range?.toDay === undefined ? undefined : formatDay(locale, range.toDay)

  if (from !== undefined && to !== undefined) {
    return from === to
      ? t(locale, 'trading.render.ledger.range.day', { day: from })
      : t(locale, 'trading.render.ledger.range.between', { from, to })
  }

  if (from !== undefined) {
    return t(locale, 'trading.render.ledger.range.since', { from })
  }

  return to === undefined ? undefined : t(locale, 'trading.render.ledger.range.until', { to })
}

/** The date leads its group instead of repeating on every row: a page of eighty-four rows restated
 *  one day eleven times. Ordered as the store answered, which is newest first. */
function dayGroups(
  entries: readonly LedgerEntry[]
): readonly (readonly [TradingDay, readonly LedgerEntry[]])[] {
  const groups = new Map<TradingDay, LedgerEntry[]>()

  for (const entry of entries) {
    const day = entry.transaction.at
    const held = groups.get(day)

    if (held === undefined) {
      groups.set(day, [entry])
      continue
    }

    held.push(entry)
  }

  return [...groups]
}

/** The handle trails the row it belongs to: `/update` and `/delete` need it, and scanning a page
 *  does not. */
function renderDayEntry(locale: Locale, entry: LedgerEntry, view: LedgerView): string {
  const detail = renderTxnDetail(locale, entry.transaction, view.quoteConventions)
  const kind = t(locale, `trading.ledger.kind.${entry.transaction.kind}`)
  const { note: raw } = entry.transaction
  const note = raw === undefined ? '' : ` ${NOTE_DASH} ${notePreview(raw)}`

  return `${kind} ${detail}${note}${INLINE_SEPARATOR}${toIdHandle(entry.id)}`
}

/** Counted in characters, not UTF-16 units, so a cut never splits an emoji. */
function notePreview(note: string): string {
  const characters = Array.from(note)

  return characters.length <= NOTE_PREVIEW_CHARACTERS
    ? note
    : `${characters.slice(0, NOTE_PREVIEW_CHARACTERS).join('').trimEnd()}${NOTE_ELLIPSIS}`
}

/** A board-scaled price prints no currency, so the page says once what scale those rows are in, as
 *  every other list mixing boards does. */
function renderBoardScaleLines(
  locale: Locale,
  entries: readonly LedgerEntry[],
  view: LedgerView
): readonly string[] {
  const quotes = entries.flatMap(({ transaction: txn }) => {
    if (!('unitPrice' in txn)) {
      return []
    }

    const display = view.quoteConventions.get(txn.instrument.market)?.display

    return [
      {
        market: txn.instrument.market,
        currency: txn.currency,
        ...(display === undefined ? {} : { display }),
      },
    ]
  })

  return renderBoardScaleNotes(locale, quotes).map((line) => `${INDENT[1]}${line}`)
}

function renderMoreLine(locale: Locale): string {
  return `${INDENT[1]}${t(locale, 'trading.render.ledger.more')}`
}

/** What this page holds, never the book: a running balance would need a fold from the first row
 *  ever written, and the page is a newest-first window of the most recent rows. Each row's cash
 *  moves at its own recorded rate, so a row that moved currency cash at its cost is called out. */
function renderPageSummary(
  locale: Locale,
  entries: readonly LedgerEntry[],
  view: Pick<LedgerView, 'baseCurrency' | 'book'>
): string {
  const counts = new Map<LedgerTxnKind, number>()
  let cash = 0
  let hasCash = false
  let foreign: CurrencyCode | undefined

  for (const entry of entries) {
    const { transaction } = entry

    counts.set(transaction.kind, (counts.get(transaction.kind) ?? 0) + 1)
    cash += cashDeltaBase(transaction)
    if ('conversion' in transaction) {
      hasCash = true

      if (movesAtCurrencyCashCost(view.book, transaction)) {
        foreign ??= transaction.conversion.fromCurrency
      }
    }
  }

  const kinds = [...counts].map(([kind, count]) =>
    t(locale, 'trading.render.ledger.pageKind', {
      count: formatCount(locale, count),
      kind: renderDeclaredValue(locale, `trading.ledger.kind.${kind}`),
    })
  )

  const summary = `${INDENT[1]}${t(locale, 'trading.render.ledger.pageSummary', {
    kinds: kinds.join(INLINE_SEPARATOR),
    cash: hasCash ? formatSignedMoney(locale, cash, view.baseCurrency) : ABSENT_CELL,
  })}`

  return foreign === undefined
    ? summary
    : `${summary}\n${INDENT[1]}${t(locale, 'trading.render.ledger.pageCashAtRowRates', { currency: foreign })}`
}

/** A withdrawal of currency cash leaves at its average cost, like a row paid from it. */
function movesAtCurrencyCashCost(book: Book, txn: LedgerTxn): boolean {
  return (
    paysFromCurrencyCash(book, txn) ||
    (txn.kind === 'withdrawal' && txn.currency !== book.baseCurrency)
  )
}

/** A draft renders through the same line a recorded entry does, so an approval prompt and the
 *  history row that follows it can never describe the same transaction differently. */
export function renderDraftLine(
  locale: Locale,
  draft: LedgerTxn | LedgerTxnDraftInput,
  markets: Pick<MarketDataService, 'quoteConvention'>
): string {
  const instruments = 'instrument' in draft ? [draft.instrument] : []

  return renderTxn(locale, draft, quoteConventionsFor(markets, instruments))
}

/** The handle leads the line because it is what the operator types back into /update or /delete. */
export function renderEntry(
  locale: Locale,
  entry: LedgerEntry,
  quoteConventions: ReadonlyMap<MarketRef, QuoteConvention>
): string {
  return `[${toIdHandle(entry.id)}] ${renderTxn(locale, entry.transaction, quoteConventions)}`
}

function renderTxn(
  locale: Locale,
  txn: LedgerTxn | LedgerTxnDraftInput,
  quoteConventions: ReadonlyMap<MarketRef, QuoteConvention>
): string {
  const day = formatDay(locale, txn.at)
  const line = `${day} ${t(locale, `trading.ledger.kind.${txn.kind}`)} ${renderTxnDetail(locale, txn, quoteConventions)}`

  return txn.note === undefined ? line : `${line} ${NOTE_DASH} ${txn.note}`
}

/** Narrowed by shape rather than by kind: `kind` spans nine values across these four shapes, so a
 *  switch over it would restate the tuples that already define them. Each arm prints only the
 *  fields its own shape carries — a quantity adjustment has no price, and inventing one would
 *  state a cost the operator never paid. */
function renderTxnDetail(
  locale: Locale,
  txn: LedgerTxn | LedgerTxnDraftInput,
  quoteConventions: ReadonlyMap<MarketRef, QuoteConvention>
): string {
  if ('quantityDelta' in txn) {
    return `${renderHeldTicker(locale, txn)} ${formatQuantity(locale, txn.quantityDelta)}`
  }

  if ('unitPrice' in txn) {
    const quantity =
      txn.quantity === SELL_ALL
        ? t(locale, 'trading.render.ledger.quantityAll')
        : formatQuantity(locale, txn.quantity)
    // Stored in currency; rendered board-scaled per the instrument's market, like /price.
    const price = formatRecordedPrice(locale, txn.unitPrice, {
      currency: txn.currency,
      ...quotedInOf(quoteConventions.get(txn.instrument.market)),
    })
    const line = `${renderHeldTicker(locale, txn)} ${quantity} ${PRICE_AT} ${price}`

    return 'closeReason' in txn && txn.closeReason !== undefined
      ? `${line}${INLINE_SEPARATOR}${renderDeclaredValue(locale, `trading.ledger.closeReason.${txn.closeReason}`)}`
      : line
  }

  if ('instrument' in txn) {
    return `${renderHeldTicker(locale, txn)} ${formatRecordedMoney(locale, txn.amount, txn.currency)}`
  }

  if ('fromVenue' in txn) {
    const move = `${renderVenueName(locale, txn.fromVenue)} → ${renderVenueName(locale, txn.venue)}`

    return t(locale, 'trading.render.ledger.transferRow', {
      move,
      amount: formatRecordedMoney(locale, txn.amount, txn.currency),
    })
  }

  return `${renderVenueName(locale, txn.venue)} ${formatRecordedMoney(locale, txn.amount, txn.currency)}`
}

/** Custodian then instrument, the order `/record` takes them in. Both name themselves, so neither
 *  carries a label. */
function renderHeldTicker(
  locale: Locale,
  txn: { instrument: InstrumentRef; venue: VenueRef }
): string {
  return `${renderVenueName(locale, txn.venue)} ${txn.instrument.ticker}`
}
