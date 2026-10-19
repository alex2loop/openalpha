import type { Locale } from '@/core/types/locale'
import type { MessageKey } from '@/i18n'
import type { WriteAudience } from '@/trading/features/ledger/fee-rows'
import type { LedgerTxn, LedgerWriteResult } from '@/trading/features/ledger/types'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { StoredSuggestion } from '@/trading/features/suggestion/types'
import type { TradingCosts } from '@/trading/kernel/config'
import type {
  InstrumentRef,
  MarketRef,
  PriceDisplay,
  QuoteUnit,
  Ticker,
  VenueRef,
} from '@/trading/kernel/instrument'
import type { Position } from '@/trading/kernel/operator/book'
import type { QuoteConvention } from '@/trading/render/money'
import { t } from '@/i18n'
import { renderFeeRows } from '@/trading/features/ledger/fee-rows'
import { renderEntryFields } from '@/trading/features/ledger/fields'
import { quoteConventionsFor } from '@/trading/features/market-data/command/quote-conventions'
import { renderLevelLines } from '@/trading/features/suggestion/render/hold-levels'
import { isSameInstrument, toIdHandle } from '@/trading/kernel/instrument'
import {
  formatCount,
  formatQuantity,
  renderVenueName,
  SECTION_ICONS,
} from '@/trading/render/format'
import { INDENT, joinSections, renderSectionTitle } from '@/trading/render/layout'
import { formatMoney, formatQuotedPrice, quotedInOf } from '@/trading/render/money'

/** What the agent's receipt needs: the row and its fee check, and nothing about where it lands. */
interface WriteReceiptOptions {
  readonly marketData: Pick<MarketDataService, 'quoteConvention'>
  readonly costs: TradingCosts
}

/** The operator's confirmation also prints the plan's levels, so it states where it is going. */
interface WriteRenderOptions extends WriteReceiptOptions {
  readonly marketData: Pick<MarketDataService, 'quoteConvention' | 'trailsStop' | 'boardLot'>
}

/** One field-list shape for write, edit and delete. The operator's form: it closes with the book
 *  as it now stands. */
export function renderWriteConfirmation(
  locale: Locale,
  result: LedgerWriteResult,
  options: WriteRenderOptions
): string {
  const quoteConventions = writeQuoteConventions(result, options)

  return joinSections([
    [
      renderWriteTitle(locale, result),
      ...renderWriteBody(locale, result, {
        costs: options.costs,
        quoteConventions,
        audience: 'confirmation',
      }),
      ...renderBookAfter(locale, result, quoteConventions),
    ],
    ...(result.planned === undefined
      ? []
      : [
          plannedSection(locale, result.planned, {
            transaction: result.entry.transaction,
            quoteConventions,
            marketData: options.marketData,
          }),
        ]),
  ])
}

/** The plan's levels under one title, in the shape `/suggest` prints them. */
function plannedSection(
  locale: Locale,
  planned: StoredSuggestion,
  display: {
    readonly transaction: LedgerTxn
    readonly quoteConventions: ReadonlyMap<MarketRef, QuoteConvention>
    readonly marketData: Pick<MarketDataService, 'trailsStop' | 'boardLot'>
  }
): readonly string[] {
  const boardLot = display.marketData.boardLot(planned.instrument.market)
  const quoted = {
    ...quotedInOf(display.quoteConventions.get(planned.instrument.market)),
    ...('currency' in display.transaction ? { currency: display.transaction.currency } : {}),
  }

  return [
    t(locale, 'trading.render.ledger.exitPlanned'),
    ...renderLevelLines({
      locale,
      suggestion: planned,
      quoted,
      trailsStop: display.marketData.trailsStop(planned.instrument.market),
      operatorFigures: 'shown',
      ...(boardLot === undefined ? {} : { boardLot }),
    }),
  ]
}

/** The agent's form of the same confirmation: the row and its fee check, never the cash or the
 *  position behind it, which are absolute money an agent may not see. */
export function renderWriteReceipt(
  locale: Locale,
  result: LedgerWriteResult,
  options: WriteReceiptOptions
): string {
  const quoteConventions = writeQuoteConventions(result, options)

  return joinSections([
    [
      renderWriteTitle(locale, result),
      ...renderWriteBody(locale, result, {
        costs: options.costs,
        quoteConventions,
        audience: 'receipt',
      }),
    ],
  ])
}

/** Which write it was — recorded, updated or deleted — is the whole title. */
function renderWriteTitle(locale: Locale, result: LedgerWriteResult): string {
  return renderSectionTitle(SECTION_ICONS.ledger, t(locale, `trading.render.ledger.${result.kind}`))
}

function writeQuoteConventions(
  result: LedgerWriteResult,
  options: WriteReceiptOptions
): ReadonlyMap<MarketRef, QuoteConvention> {
  const { transaction } = result.entry

  return quoteConventionsFor(
    options.marketData,
    'instrument' in transaction ? [transaction.instrument] : []
  )
}

/** The operator is told which command undoes it; the agent is told to ask before touching a row
 *  the operator may have meant. */
const DUPLICATE_KEYS = {
  confirmation: 'trading.render.ledger.duplicate',
  receipt: 'trading.render.ledger.duplicateReceipt',
} satisfies Record<WriteAudience, MessageKey>

interface WriteBodyOptions {
  readonly costs: TradingCosts
  readonly quoteConventions: ReadonlyMap<MarketRef, QuoteConvention>
  readonly audience: WriteAudience
}

/** The written row and its checks, under no title of its own: an order fill prints the same parts
 *  under the order surface's header. */
export function renderWriteBody(
  locale: Locale,
  result: LedgerWriteResult,
  options: WriteBodyOptions
): readonly string[] {
  return [
    ...renderEntryFields(locale, result.entry, {
      quoteConventions: options.quoteConventions,
      audience: options.audience,
      book: result.book,
    }),
    ...renderFeeRows(locale, result.entry.transaction, {
      costs: options.costs,
      audience: options.audience,
      fillSource: result.fillSource ?? 'operator',
    }),
    ...renderPriceScaleRow(locale, result.entry.transaction, options.quoteConventions),
    ...renderDuplicateRow(locale, result, options.audience),
  ]
}

/** A price a board-scaled market would print as a fraction of one board unit was almost certainly
 *  typed in board units. Said beside the figure, never rewritten: a sub-unit price is rare but real. */
function renderPriceScaleRow(
  locale: Locale,
  txn: LedgerTxn,
  quoteConventions: ReadonlyMap<MarketRef, QuoteConvention>
): readonly string[] {
  if (!('unitPrice' in txn)) {
    return []
  }

  const display = quoteConventions.get(txn.instrument.market)?.display

  if (display === undefined || display.divisor <= 1 || txn.unitPrice >= display.divisor) {
    return []
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.render.ledger.priceBelowBoardScale', {
      divisor: formatCount(locale, display.divisor),
      currency: txn.currency,
    })}`,
  ]
}

/** Said rather than refused: two identical fills in one day are real. The reader is the only one
 *  who knows which this was, so the row names the earlier one and leaves the choice with them. */
function renderDuplicateRow(
  locale: Locale,
  result: LedgerWriteResult,
  audience: WriteAudience
): readonly string[] {
  if (result.duplicateOf === undefined) {
    return []
  }

  return [
    `${INDENT[1]}${t(locale, DUPLICATE_KEYS[audience], {
      handle: toIdHandle(result.duplicateOf),
    })}`,
  ]
}

/** The book as the write leaves it, which only an operator may read: cash and a position are
 *  absolute money. The re-fold sentence rides on an edit and a delete only — a fresh record
 *  invalidates nothing behind it. */
export function renderBookAfter(
  locale: Locale,
  result: LedgerWriteResult,
  quoteConventions: ReadonlyMap<MarketRef, QuoteConvention>
): readonly string[] {
  const { book } = result
  const subject = subjectOf(result.entry.transaction)
  const position =
    subject === undefined
      ? undefined
      : book.positions.find(
          (entry) =>
            entry.venue === subject.venue && isSameInstrument(entry.instrument, subject.instrument)
        )

  return [
    `${INDENT[1]}${t(locale, 'trading.render.ledger.cashAfter', {
      cash: formatMoney(locale, book.cashBase, book.baseCurrency),
    })}`,
    ...(subject === undefined
      ? []
      : renderPositionAfter(locale, {
          venue: subject.venue,
          board: boardOf(subject.instrument, quoteConventions),
          ...(position === undefined ? {} : { position }),
        })),
    ...(result.kind === 'recorded'
      ? []
      : [`${INDENT[1]}${t(locale, 'trading.render.ledger.refold')}`]),
  ]
}

function boardOf(
  instrument: InstrumentRef,
  quoteConventions: ReadonlyMap<MarketRef, QuoteConvention>
): TickerQuote {
  const convention = quoteConventions.get(instrument.market)

  return { ticker: instrument.ticker, ...quotedInOf(convention) }
}

/** A ticker and how its market prints a price, which is everything a position line needs beyond
 *  the numbers it already holds. */
interface TickerQuote {
  readonly ticker: Ticker
  readonly unit?: QuoteUnit
  readonly display?: PriceDisplay
}

interface PositionAfter {
  readonly venue: VenueRef
  readonly board: TickerQuote
  /** Absent once the row closed the venue's holding out. */
  readonly position?: Position
}

/** One venue's holding after the row, named in both arms - "closed" said of a coin still sitting at
 *  another exchange is the reading that keeps out. The cost per unit reads in the market's own quote
 *  convention, board scale included, the same number `/portfolio` prints: base-currency money would
 *  stamp the book's currency on a price that market never quoted. */
function renderPositionAfter(locale: Locale, after: PositionAfter): readonly string[] {
  const { board, position } = after
  const ticker = board.ticker
  const venue = renderVenueName(locale, after.venue)

  if (position === undefined || position.quantity <= 0) {
    return [`${INDENT[1]}${t(locale, 'trading.render.ledger.positionClosed', { ticker, venue })}`]
  }

  const quotedIn = {
    currency: position.currency,
    ...(board.unit === undefined ? {} : { unit: board.unit }),
    ...(board.display === undefined ? {} : { display: board.display }),
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.render.ledger.positionAfter', {
      ticker,
      venue,
      quantity: formatQuantity(locale, position.quantity),
      cost: formatQuotedPrice(locale, position.costBasisNative / position.quantity, quotedIn),
    })}`,
  ]
}

interface PositionSubject {
  readonly instrument: InstrumentRef
  readonly venue: VenueRef
}

/** The holding a row moved, custodian included: the same coin at two venues is two positions, and
 *  the confirmation states the one the operator just changed. */
function subjectOf(txn: LedgerTxn): PositionSubject | undefined {
  return 'instrument' in txn ? { instrument: txn.instrument, venue: txn.venue } : undefined
}
