import type { Logger } from '@/core/logging/logger'
import type { LedgerStore } from '@/trading/features/ledger/store/ledger'
import type { SyncListing } from '@/trading/features/ledger/sync-listing'
import type { LedgerEntry, TradeTxnDraft } from '@/trading/features/ledger/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { InstrumentRef, Ticker, TradingDay, VenueRef } from '@/trading/kernel/instrument'
import type { OrderReceipt, SpotAdapter } from '@/trading/kernel/venue/spot-adapter'
import type { Market, MarketRegistry } from '@/trading/markets/types'
import type { Venue, VenueExecution } from '@/trading/venues/types'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { adjacentDays, QUANTITY_TOLERANCE } from '@/trading/features/ledger/fills'
import { listingOnce } from '@/trading/features/ledger/sync-listing'
import { resolveDay, resolveInstrument } from '@/trading/features/market-data/resolve'
import { currencyCode, isSameInstrument, ticker } from '@/trading/kernel/instrument'
import { isBookableFill, toBookedFill } from '@/trading/kernel/venue/fee'

/** A fill the book already counts is one this must not book twice, and the exchange's own order id
 *  is the only key that survives two trades of the same size on one day. */
const KEY_SEPARATOR = ':'
// What a detector's own caveat says went wrong, for the cases where "no market resolved this" is
// not the fact. Anything unnamed here stays `unlisted`, which is the only one that is a statement
// about the ticker rather than about the attempt.
const SKIP_BY_CAVEAT: Readonly<Record<string, SkipReason>> = Object.freeze({
  'market.detector-failed': 'unreachable',
  'market.ticker-shared': 'ambiguous',
})

/** Why one fill the venue reported did not become a row. Each is a fact about that fill, never a
 *  guess to book on. A tuple, because every arm needs a line in both locale catalogs and only a
 *  runtime list can be held against them. */
export const SYNC_SKIP_REASONS = Object.freeze([
  'unlisted',
  'ambiguous',
  'unreachable',
  'undated',
  'unpriced',
  'beforeBook',
  'dayMismatch',
  'partial',
  'fee',
  'refused',
] as const)

export type SkipReason = (typeof SYNC_SKIP_REASONS)[number]

export interface SkippedFill {
  readonly symbol: string
  readonly reason: SkipReason
}

export interface SyncedFill {
  readonly draft: TradeTxnDraft
  readonly idempotencyKey: string
  readonly symbol: string
}

/** What booking a fill and recognising one already booked both read. */
export type VenueFill = Pick<SyncedFill, 'draft' | 'idempotencyKey'>

export interface VenueSyncResult {
  readonly venue: VenueRef
  readonly fills: readonly SyncedFill[]
  /** Fills the book already holds. Counted rather than listed, and reported: a run that recognised
   *  twelve of them must not read like a venue that reported nothing. */
  readonly alreadyBooked: number
  /** Fills the venue reported that no row could be built from, each with what stopped it, so the
   *  operator reads which trades are missing rather than only how many. */
  readonly skipped: readonly SkippedFill[]
  /** The day the venue was asked from, so a reader is never told a window was searched that
   *  never was. */
  readonly fromDay: TradingDay
  /** How the venue listed its fills. `by-symbol` read only the names the book and the account point
   *  at, which the reply says rather than implying a full sweep. */
  readonly coverage: VenueExecution['fills']
}

interface VenueSyncInput {
  readonly venue: Venue
  readonly adapter: SpotAdapter
  readonly markets: MarketRegistry
  readonly ledger: Pick<LedgerStore, 'findByIdempotency'>
  readonly recorded: readonly LedgerEntry[]
  readonly since: number
  /** The book's first row. The fetch starts here and nothing before it is booked — everything
   *  earlier is already counted in the opening snapshot that row states. */
  readonly fromDay: TradingDay
  readonly logger: Logger
  readonly signal: AbortSignal
}

/** What the venue filled in the window that the book has no row for. Ordered oldest first, so a
 *  buy is booked before the sale that closes it and the fold never sees a sell it cannot cover. */
export async function resolveVenueSync(input: VenueSyncInput): Promise<VenueSyncResult> {
  const coverage = input.venue.manifest.execution?.fills ?? 'none'
  const listFilledOrders = input.adapter.listFilledOrders

  if (listFilledOrders === undefined) {
    return {
      venue: input.venue.manifest.id,
      fills: [],
      alreadyBooked: 0,
      skipped: [],
      fromDay: input.fromDay,
      coverage,
    }
  }

  const receipts = await listFilledOrders({
    since: input.since,
    symbols: bookSymbolsAt(input),
    signal: input.signal,
  })
  const claimed = new Set<string>()
  const fills: SyncedFill[] = []
  const skipped: SkippedFill[] = []
  let alreadyBooked = 0

  const listed = listingOnce(input)

  for (const receipt of [...receipts].sort((left, right) => stampOf(left) - stampOf(right))) {
    const outcome = await toSyncedFill(input, receipt, listed)

    if (typeof outcome === 'string') {
      skipped.push({ symbol: receipt.symbol, reason: outcome })
      continue
    }

    if (await isAlreadyBooked(input, outcome, claimed)) {
      alreadyBooked += 1
      continue
    }

    if (isDayMismatch(input, outcome, claimed)) {
      skipped.push({ symbol: receipt.symbol, reason: 'dayMismatch' })
      continue
    }

    fills.push(outcome)
  }

  return {
    venue: input.venue.manifest.id,
    fills,
    alreadyBooked,
    skipped,
    fromDay: input.fromDay,
    coverage,
  }
}

/** The venue's own symbol for every instrument the book has ever recorded there. */
function bookSymbolsAt(input: VenueSyncInput): readonly string[] {
  const symbols = new Set<string>()

  for (const entry of input.recorded) {
    const txn = entry.transaction

    if ('instrument' in txn && txn.venue === input.venue.manifest.id) {
      symbols.add(input.adapter.toSymbol(txn.instrument))
    }
  }

  return [...symbols]
}

/** The key a venue fill is booked under, whichever writer books it: this sync, the order mirror or
 *  the exit tick. One fill has one identity, so the writer that comes second is recognised inside
 *  the ledger's write lock and books nothing. Exported so every writer, and the order path asking
 *  whether a fill it lost has since been recovered, spell the key the same way. */
export function buildVenueFillKey(venue: VenueRef, orderId: string): string {
  return `${venue}${KEY_SEPARATOR}${orderId}`
}

/** Whether the book already holds this fill, under the venue's own key or as a row the operator
 *  typed for the same trade. Asked before booking a fired exit, since a second sale would never
 *  settle. A typed-row match errs toward not booking: `/record sync` fills the gap, where a
 *  second sale corrupts the book silently. */
export async function isVenueFillBooked(
  ledger: Pick<LedgerStore, 'findByIdempotency' | 'listAll'>,
  fill: VenueFill,
  signal: AbortSignal
): Promise<boolean> {
  const stored = await ledger.findByIdempotency({ idempotencyKey: fill.idempotencyKey, signal })

  if (stored !== null) {
    return true
  }

  return (await ledger.listAll(signal)).some((entry) => isSameTrade(entry, fill))
}

function stampOf(receipt: OrderReceipt): number {
  return receipt.filledAt ?? 0
}

/** A reason for a fill no row can state: one the venue left undated or priced at nothing, a symbol
 *  this tree lists no market for or that two of them claim, a market this venue cannot hold, a
 *  detector that could not be reached to answer either way, a day before the book opens, or a fee
 *  the booking convention refuses. Each guard names its own, because a fill reported as skipped without one is a trade the
 *  operator cannot go looking for — and one reported under another's name sends them looking for
 *  the wrong thing. */
async function toSyncedFill(
  input: VenueSyncInput,
  receipt: OrderReceipt,
  listed: SyncListing
): Promise<SyncedFill | SkipReason> {
  const named = (await listed()).bySymbol.get(receipt.symbol)
  const asset = named?.ticker ?? input.adapter.toTicker(receipt.symbol)

  if (asset === undefined) {
    return 'unlisted'
  }

  if (!isBookableFill(receipt)) {
    return 'unpriced'
  }

  if (receipt.filledAt === undefined) {
    return 'undated'
  }

  const market = await marketOf(input, { ...(named === undefined ? {} : { named }), asset, listed })

  if (typeof market === 'string') {
    return market
  }

  const at = resolveDay(market, receipt.filledAt)

  if (at < input.fromDay) {
    return 'beforeBook'
  }

  return toDraftedFill(input, {
    receipt,
    asset,
    at,
    instrument: { market: market.manifest.id, ticker: ticker(asset) },
  })
}

/** The catalog's own answer where it has one, and the detectors otherwise. The venue naming the
 *  instrument its `instId` addresses is stronger evidence than polling every market about a bare
 *  ticker - it is the venue's own fill - so a catalog hit is authoritative over a stored market's
 *  claim on the same name, and no cross-market ambiguity arises to report. It is also what keeps a
 *  burst of fills from spending one `detection: 'fetched'` provider call each. */
async function marketOf(
  input: VenueSyncInput,
  found: { readonly named?: InstrumentRef; readonly asset: string; readonly listed: SyncListing }
): Promise<Market | SkipReason> {
  const market = found.named === undefined ? null : input.markets.find(found.named.market)

  return market ?? (await resolvedMarket(input, found.asset, found.listed))
}

interface DraftedFillInput {
  readonly receipt: OrderReceipt
  readonly asset: string
  readonly at: TradingDay
  readonly instrument: InstrumentRef
}

/** The venue's own figures, converted by the one fee convention every recorded fill goes through:
 *  quantity net of an in-kind fee, and the fee priced in the transaction currency. */
async function toDraftedFill(
  input: VenueSyncInput,
  parts: DraftedFillInput
): Promise<SyncedFill | SkipReason> {
  const { receipt } = parts
  const booked = await toBookedFill({
    receipt,
    side: receipt.side,
    baseAsset: parts.asset,
    quoteAsset: input.adapter.quoteAsset,
    priceOf: (named, signal) => input.adapter.fetchAssetPrice(named, signal),
    signal: input.signal,
  })

  if (booked === undefined) {
    return 'fee'
  }

  return {
    idempotencyKey: buildVenueFillKey(input.venue.manifest.id, receipt.orderId),
    symbol: receipt.symbol,
    draft: {
      kind: receipt.side,
      at: parts.at,
      instrument: parts.instrument,
      venue: input.venue.manifest.id,
      currency: currencyCode(input.adapter.quoteAsset),
      quantity: booked.quantity,
      unitPrice: receipt.averagePrice,
      fee: booked.fee,
    },
  }
}

/** Two ways the book may already hold a fill. Its own key answers a re-run of this command; a row
 *  the operator typed carries the request's key instead, so the figures have to be compared. Each
 *  stored row absorbs at most one fill, or the second of two identical trades in a day would be
 *  dropped as a duplicate of the first. */
async function isAlreadyBooked(
  input: VenueSyncInput,
  fill: SyncedFill,
  claimed: Set<string>
): Promise<boolean> {
  const stored = await input.ledger.findByIdempotency({
    idempotencyKey: fill.idempotencyKey,
    signal: input.signal,
  })

  if (stored !== null) {
    claimed.add(stored.entry.id)

    return true
  }

  const match = input.recorded.find((entry) => !claimed.has(entry.id) && isSameTrade(entry, fill))

  if (match === undefined) {
    return false
  }

  claimed.add(match.id)

  return true
}

/** A row the book holds for this trade on a neighbouring day. Reported rather than booked: booking
 *  it duplicates a trade the operator already recorded under a day their own clock named, and
 *  skipping it silently hides a fill that really is missing. Either way the date is what they have
 *  to look at, so the run says so and books nothing. */
function isDayMismatch(input: VenueSyncInput, fill: SyncedFill, claimed: Set<string>): boolean {
  const days = adjacentDays(fill.draft.at)

  return input.recorded.some(
    (entry) =>
      !claimed.has(entry.id) &&
      isSameTradeApartFromDay(entry, fill) &&
      days.includes(entry.transaction.at)
  )
}

function isSameTrade(entry: LedgerEntry, fill: Pick<SyncedFill, 'draft'>): boolean {
  return isSameTradeApartFromDay(entry, fill) && entry.transaction.at === fill.draft.at
}

/** The half an exact match and a neighbouring-day one share. */
function isSameTradeApartFromDay(entry: LedgerEntry, fill: Pick<SyncedFill, 'draft'>): boolean {
  const txn = entry.transaction
  const { draft } = fill

  if (txn.kind !== draft.kind || !('venue' in txn) || txn.venue !== draft.venue) {
    return false
  }

  if (!isSameInstrument(txn.instrument, draft.instrument)) {
    return false
  }

  return (
    'quantity' in txn &&
    Math.abs(txn.quantity - draft.quantity) <= draft.quantity * QUANTITY_TOLERANCE
  )
}

/** What the exchange itself says it trades, for a fill it has just reported. The listing endpoint is
 *  public and takes no credentials, so it answers when the ranked providers are all metered out —
 *  and whether this venue trades an instrument is not a question a market-cap index answers better.
 *  It names no market, so `candidacy` picks one: pure, synchronous, and conclusive only when exactly
 *  one of the venue's markets could claim the ticker at all. */
async function listedMarket(
  input: VenueSyncInput,
  symbol: Ticker,
  listed: SyncListing
): Promise<Market | SkipReason> {
  const [only, second] = input.venue.manifest.markets.flatMap((ref) => {
    const market = input.markets.find(ref)

    return market !== null && market.candidacy(symbol) === 'possible' ? [market] : []
  })

  if (only === undefined || second !== undefined) {
    return 'unreachable'
  }

  return (await listed()).tickers.has(symbol) ? only : 'unreachable'
}

/** The first named caveat wins; the two this maps are alternatives, never companions — one says the
 *  detector could not be asked and the other that it answered twice. */
function skipForCaveats(caveats: readonly Caveat[]): SkipReason {
  for (const caveat of caveats) {
    const reason = SKIP_BY_CAVEAT[caveat.code]

    if (reason !== undefined) {
      return reason
    }
  }

  return 'unlisted'
}

/** A symbol no registered market claims is skipped, never guessed at: a row filed under the wrong
 *  market prices against the wrong calendar forever.
 *
 *  Asked of the markets the venue holds and no others. An unqualified ask reaches every registered
 *  market, and resolution is local-first, so a ticker a stored market claims never gets as far as
 *  the one this venue actually trades — UNI is a VN equity and Uniswap both, and a crypto
 *  exchange's UNI fill resolved to the board. Every held market is asked rather than the first
 *  match taken, so registration order decides nothing and a genuine collision is still reported. */
async function resolvedMarket(
  input: VenueSyncInput,
  asset: string,
  listed: SyncListing
): Promise<Market | SkipReason> {
  const symbol = ticker(asset)

  try {
    const resolutions = await Promise.all(
      input.venue.manifest.markets.map((market) =>
        resolveInstrument(input.markets, { ticker: symbol, market, signal: input.signal })
      )
    )
    const [only, second] = resolutions.flatMap((entry) =>
      entry.kind === 'resolved' ? [entry.market] : []
    )

    if (second !== undefined) {
      return 'ambiguous'
    }

    if (only !== undefined) {
      return only
    }

    // A market that detects by fetching answers "no market lists this" the same way it answers
    // "I could not ask" and "two assets answered". Reading any of them as the first tells the
    // operator a listed coin is listed nowhere, and a burst of fills is exactly what exhausts a
    // provider's rate limit.
    const reason = skipForCaveats(
      resolutions.flatMap((entry) => (entry.kind === 'unresolved' ? entry.result.caveats : []))
    )

    // Only a detector nobody could reach earns the venue's own word. `unlisted` and `ambiguous` are
    // answers, and taking the listing over either would file a row against a market that declined it.
    return reason === 'unreachable' ? await listedMarket(input, symbol, listed) : reason
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    input.logger.warn('ledger.sync_instrument_unresolved', {
      venue: input.venue.manifest.id,
      asset,
      err: formatErrForLog(err),
    })

    return 'unreachable'
  }
}
