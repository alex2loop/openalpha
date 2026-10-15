import type { FoldState } from '@/trading/features/ledger/book'
import type {
  DividendTxn,
  LedgerEntry,
  LedgerTxn,
  LedgerTxnKind,
  TradeTxn,
} from '@/trading/features/ledger/types'
import type { CurrencyCode, MarketRef, TradingDay, VenueRef } from '@/trading/kernel/instrument'
import type { MarketManifest } from '@/trading/markets/types'
import type { VenueManifest } from '@/trading/venues/types'
import { ValidationError } from '@/core/errors'
import {
  applyTransaction,
  createFoldState,
  positionAt,
  promoteSettled,
} from '@/trading/features/ledger/book'
import { closingOvershootOf, settledQuantityAt } from '@/trading/features/ledger/position'
import { CASH_TXN_KINDS } from '@/trading/features/ledger/types'
import { venueParam } from '@/trading/render/format'

// Cash and quantity comparisons run against float sums, so an exact `>` would reject a sale of
// exactly the position it holds. Relative to the operands, because the same book holds share counts
// near 1 and VND sums near 1e10, whose ULP alone is larger than any fixed tolerance worth applying
// to a quantity.
const COMPARISON_EPSILON = 1e-9

// The kinds whose correctness rests on settling the day they are recorded: the cash kinds and a
// dividend clear on the same pass through the pending path, and a transfer moves both legs at once
// without one. A lagged settlement day would mis-time either.
const SAME_DAY_SETTLEMENT_KINDS: ReadonlySet<LedgerTxnKind> = new Set([
  ...CASH_TXN_KINDS,
  'dividend',
  'transfer',
])

interface LedgerValidationOptions {
  readonly baseCurrency: CurrencyCode
  /** Today on the home region's calendar; a row dated after it is a typo, not a trade. */
  readonly today: TradingDay
  marketFor(market: MarketRef): MarketManifest | undefined
  venueFor(venue: VenueRef): VenueManifest | undefined
}

/** Chronological order, with entry id breaking ties within a day. Rows are editable, so an entry's
 *  day can move freely and the stored order is not the trading order — this is the one place that
 *  reconciles them, and every fold and replay goes through it. The id is a UUIDv7, so the tie-break
 *  is append order down to the millisecond and no finer; a batch minted from one clock read would
 *  need a real sequence. */
export function orderLedger(entries: readonly LedgerEntry[]): readonly LedgerEntry[] {
  return [...entries].sort(compareEntries)
}

function compareEntries(left: LedgerEntry, right: LedgerEntry): number {
  const byDay = left.transaction.at.localeCompare(right.transaction.at)

  return byDay === 0 ? left.id.localeCompare(right.id) : byDay
}

/** The pure callback the store runs inside its write transaction, against history reloaded inside
 *  that transaction. That placement closes the concurrent-overdraw race; this function only has to
 *  be correct and total.
 *
 *  `pending` is the whole ledger as it will stand once the write lands — an insert appends to it, an
 *  update replaces one row, a delete removes one. Every case replays the same way, because a book
 *  that was valid before an edit can be invalid after it: shrinking a January buy can overdraw a
 *  February withdrawal that was affordable when it was recorded. */
export function assertLedgerValid(
  pending: readonly LedgerEntry[],
  options: LedgerValidationOptions
): void {
  const ordered = orderLedger(pending)

  for (const entry of ordered) {
    assertVenueHoldsMarket(entry.transaction, options)
    assertVenueRegistered(entry.transaction, options)
    assertTransferCrossesVenues(entry.transaction)
    assertCurrencyMatchesMarket(entry.transaction, options)
    assertSettlesOnItsDay(entry.transaction)
    assertNotAhead(entry.transaction, options.today)
  }

  replayForValidity(ordered)
}

function replayForValidity(ordered: readonly LedgerEntry[]): void {
  const state = createFoldState()

  for (const entry of ordered) {
    promoteSettled(state, entry.transaction.at)
    assertAffordable(state, entry.transaction)
    assertSellable(state, entry.transaction)
    applyTransaction(state, entry)
  }
}

function assertAffordable(state: FoldState, txn: LedgerTxn): void {
  const outflow = cashOutflowBase(txn)

  if (outflow === 0) {
    return
  }

  const venue = payingVenue(txn)
  const available = state.byVenue.get(venue)?.available ?? 0

  if (isShortfall(available, outflow)) {
    throw new ValidationError(
      `${txn.kind} on ${txn.at} needs more settled cash than ${venue} holds`,
      { key: 'errors.ledgerCashShort', params: { venue: venueParam(venue), day: { day: txn.at } } }
    )
  }
}

/** Which venue's cash a row spends. Every kind but a transfer spends where it sits; a transfer
 *  spends at its source and credits its destination. */
function payingVenue(txn: LedgerTxn): VenueRef {
  return txn.kind === 'transfer' ? txn.fromVenue : txn.venue
}

function cashOutflowBase(txn: LedgerTxn): number {
  if (txn.kind === 'transfer') {
    return (txn.amount + txn.fee) * txn.conversion.rate
  }

  if (txn.kind === 'buy' || txn.kind === 'rights') {
    return (txn.quantity * txn.unitPrice + txn.fee) * txn.conversion.rate
  }

  if (txn.kind === 'withdrawal' || txn.kind === 'fee' || txn.kind === 'loss') {
    return txn.amount * txn.conversion.rate
  }

  return 0
}

/** Sells are limited by settled quantity, which is how T+2 is expressed once rather than as a VN
 *  special case. */
function assertSellable(state: FoldState, txn: LedgerTxn): void {
  if (txn.kind !== 'sell') {
    return
  }

  const position = positionAt(state, txn.instrument, txn.venue)
  const settled = position ? settledQuantityAt(position, txn.at) : 0

  // Not `isShortfall`: cash has no dust, a quantity does. A full exit comes back from the exchange
  // rounded to the instrument's lot while the book netted the buy's in-kind fee down, so the order
  // that sold everything reads a hair above the position — and refusing it strands the name, since
  // every later sale of it then has a phantom parcel to clear first.
  if (txn.quantity > settled + closingOvershootOf(settled)) {
    throw new ValidationError(
      `sell of ${txn.instrument.ticker} at ${txn.venue} exceeds the quantity settled on ${txn.at}`,
      {
        key: 'errors.ledgerOversell',
        params: {
          ticker: txn.instrument.ticker,
          venue: venueParam(txn.venue),
          day: { day: txn.at },
        },
      }
    )
  }
}

/** A cash movement debits `cashBase` at once but reaches available cash only when `promoteSettled`
 *  clears it, which happens on the same pass only while its settled day is its own. A lagged row
 *  would let a withdrawal spend money the book has not received. */
function assertSettlesOnItsDay(txn: LedgerTxn): void {
  if (!SAME_DAY_SETTLEMENT_KINDS.has(txn.kind) || txn.settledAt === txn.at) {
    return
  }

  throw new ValidationError(
    `${txn.kind} on ${txn.at} settles on ${txn.settledAt}; cash clears the day it is recorded`,
    { key: 'errors.ledgerCashSettlement', params: { day: { day: txn.at } } }
  )
}

function assertNotAhead(txn: LedgerTxn, today: TradingDay): void {
  if (txn.at <= today) {
    return
  }

  throw new ValidationError(`${txn.kind} on ${txn.at} is after ${today}`, {
    key: 'errors.ledgerFutureDay',
    params: { day: { day: txn.at } },
  })
}

/** Currency is structural: the market declares it in its manifest, so "VN equities record in VND"
 *  is a consequence of `equity-vn` declaring VND rather than a rule written down anywhere. */
function assertCurrencyMatchesMarket(txn: LedgerTxn, options: LedgerValidationOptions): void {
  switch (txn.kind) {
    case 'split':
    case 'distribution':
      return
    case 'deposit':
    case 'withdrawal':
    case 'fee':
    case 'loss':
    case 'transfer':
      if (txn.currency !== options.baseCurrency) {
        throw new ValidationError('cash movements must use the book base currency', {
          key: 'errors.ledgerCashCurrency',
          params: { currency: options.baseCurrency },
        })
      }

      return
    default:
      assertMarketCurrency(txn, options)
  }
}

function assertMarketCurrency(txn: TradeTxn | DividendTxn, options: LedgerValidationOptions): void {
  const market = options.marketFor(txn.instrument.market)

  // Two different mistakes: a market that was never registered, and a real market quoted in another
  // currency. One shared message sends an operator who mistyped the market id hunting a currency bug.
  if (!market) {
    throw new ValidationError(`no registered market ${txn.instrument.market}`, {
      key: 'errors.ledgerUnknownMarket',
      params: { market: txn.instrument.market },
    })
  }

  if (txn.currency !== market.currency) {
    throw new ValidationError(
      `market ${txn.instrument.market} trades in ${market.currency}, not ${txn.currency}`,
      {
        key: 'errors.ledgerMarketCurrency',
        params: { market: txn.instrument.market, currency: market.currency },
      }
    )
  }

  if (txn.conversion.source === 'identity' && txn.currency !== options.baseCurrency) {
    throw new ValidationError('identity conversion requires matching currencies', {
      key: 'errors.ledgerIdentityConversion',
    })
  }
}

/** Every instrument-bearing row, splits included: a venue that does not hold the market holds no
 *  position to adjust either, and the fold would key one under a custodian that cannot have it. A
 *  registered venue only ever lists registered markets, so this proves the market too.
 *
 *  Here rather than in the parser, deliberately: the parser stays pure and config-free, and this is
 *  already the one place holding the whole book and its registries. */
function assertVenueHoldsMarket(txn: LedgerTxn, options: LedgerValidationOptions): void {
  if (!('instrument' in txn)) {
    return
  }

  const venue = options.venueFor(txn.venue)

  if (venue === undefined) {
    throw new ValidationError(`no registered venue ${txn.venue}`, {
      key: 'errors.ledgerUnknownVenue',
      params: { venue: txn.venue },
    })
  }

  if (!venue.markets.includes(txn.instrument.market)) {
    throw new ValidationError(`venue ${txn.venue} does not hold ${txn.instrument.market}`, {
      key: 'errors.ledgerVenueMarket',
      params: {
        venue: venueParam(txn.venue),
        market: { key: `trading.market.${txn.instrument.market}` },
      },
    })
  }
}

/** A cash row names a custodian but no instrument, so there is no market to hold and only the
 *  venue's existence can be checked. It must be: money at a name no registry knows is unreachable. */
function assertVenueRegistered(txn: LedgerTxn, options: LedgerValidationOptions): void {
  if ('instrument' in txn) {
    return
  }

  if (txn.kind === 'transfer') {
    assertRegistered(txn.fromVenue, options)
  }

  assertRegistered(txn.venue, options)
}

function assertRegistered(venue: VenueRef, options: LedgerValidationOptions): void {
  if (options.venueFor(venue) === undefined) {
    throw new ValidationError(`no registered venue ${venue}`, {
      key: 'errors.ledgerUnknownVenue',
      params: { venue },
    })
  }
}

function assertTransferCrossesVenues(txn: LedgerTxn): void {
  if (txn.kind === 'transfer' && txn.fromVenue === txn.venue) {
    throw new ValidationError(
      `transfer on ${txn.at} names ${txn.venue} as both source and destination`,
      { key: 'errors.ledgerTransferSameVenue', params: { venue: venueParam(txn.venue) } }
    )
  }
}

/** Tolerance scaled to the operands: a fixed one is either meaningless against a large float sum or
 *  too coarse for a share count. */
function isShortfall(available: number, required: number): boolean {
  const tolerance = COMPARISON_EPSILON * Math.max(1, Math.abs(available), Math.abs(required))

  return available + tolerance < required
}
