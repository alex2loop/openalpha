import type { Logger } from '@/core/logging/logger'
import type { AssertLedgerValid, LedgerStore } from '@/trading/features/ledger/store/ledger'
import type {
  FillSource,
  LedgerEntry,
  LedgerTxn,
  LedgerTxnDraft,
  LedgerTxnDraftInput,
  LedgerWriteResult,
} from '@/trading/features/ledger/types'
import type { LedgerWriteDeps } from '@/trading/features/ledger/write'
import type { TypedPriceDeps } from '@/trading/features/market-data/reads/typed-price'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { ExitPlanner } from '@/trading/features/suggestion/exit-plan/types'
import type { StoredSuggestion } from '@/trading/features/suggestion/types'
import type { TradingConfig, TradingCosts } from '@/trading/kernel/config'
import type { Region, TradingDay, VenueRef } from '@/trading/kernel/instrument'
import type { Book, LedgerEntryId } from '@/trading/kernel/operator/book'
import type { TypedPrice } from '@/trading/kernel/surface/surface'
import type { VenueManifest, VenueRegistry } from '@/trading/venues/types'
import { ConflictError, isAbortError, ValidationError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { foldBook } from '@/trading/features/ledger/book'
import { isResolvedDraft } from '@/trading/features/ledger/draft'
import { fxRateApplies, namesFxRate } from '@/trading/features/ledger/fx-rate'
import { resolveDraft } from '@/trading/features/ledger/resolve'
import {
  assertLedgerValid,
  assertVenuesKnown,
  orderLedger,
} from '@/trading/features/ledger/validate'
import { buildRequestFingerprint, finalizeTransaction } from '@/trading/features/ledger/write'
import { assertTypedPrice } from '@/trading/features/market-data/reads/typed-price'
import { resolveRegionDay } from '@/trading/features/market-data/resolve'
import { isIdRef } from '@/trading/kernel/instrument'
import { buildLedgerEntryId } from '@/trading/kernel/operator/book'
import { venueParam } from '@/trading/render/format'

/** Consumer-side: the write path needs a store plus the write deps, and nothing else the portfolio
 *  service happens to hold. Declaring it here keeps the two files acyclic. */
export interface LedgerMutateDeps extends LedgerWriteDeps {
  readonly ledger: LedgerStore
  readonly costs: TradingCosts
  readonly venues: VenueRegistry
  readonly logger: Logger
  /** The region whose calendar dates the confirmation book, so it agrees with every other view. */
  readonly defaultRegion: Region
  /** A buy that lands with no plan standing earns one here, so no surface can record a trade the
   *  book then holds unwatched. */
  readonly exitPlans: ExitPlanner
  readonly marketData: Pick<MarketDataService, 'instrumentQuoteConvention' | 'quoteBoard'>
  readonly marketDataStore: LedgerWriteDeps['marketDataStore'] & TypedPriceDeps['marketDataStore']
  readonly config: Pick<TradingConfig, 'typedPrices'>
}

/** All that finding a row by ref needs of the store. */
interface LedgerReader {
  readonly ledger: Pick<LedgerStore, 'findById' | 'listIdsMatching'>
}

/** How the full ids of an ambiguous handle are listed, so the operator can copy one back. */
const ENTRY_ID_SEPARATOR = ', '

/** The written row, plus the earlier one holding its exact content when there is one. */
type RecordedEntry = Pick<LedgerWriteResult, 'entry' | 'duplicateOf' | 'replayed'>

type RecordMutation = Extract<LedgerMutation, { readonly kind: 'record' }>
type ResolvedRecord = Omit<RecordMutation, 'draft'> & { readonly draft: LedgerTxnDraft }

type LedgerMutation =
  | {
      readonly kind: 'record'
      readonly draft: LedgerTxnDraftInput
      readonly idempotencyKey: string
      readonly fillSource?: FillSource
      readonly typedPrice?: TypedPrice
      readonly now: number
      readonly signal: AbortSignal
    }
  | {
      readonly kind: 'update'
      readonly ref: string
      readonly draft: LedgerTxnDraft
      readonly typedPrice?: TypedPrice
      readonly now: number
      readonly signal: AbortSignal
    }
  | {
      readonly kind: 'delete'
      readonly ref: string
      readonly now: number
      readonly signal: AbortSignal
    }

/** The one ledger write path. It reads the clock once (its caller supplies `now`) and validates the
 *  whole book as it will stand after the write, because an edit can invalidate a row it never
 *  touched. */
export async function mutateLedger(
  deps: LedgerMutateDeps,
  mutation: LedgerMutation
): Promise<LedgerWriteResult> {
  // The validator sees the whole ledger as it will stand, which is exactly the fold a confirmation
  // needs. Capturing it here is what keeps the write path from reading the ledger a second time.
  const folded: { book?: Book } = {}
  const assertValid = validatorFor(deps, folded, mutation.now)

  if (mutation.kind === 'record') {
    return recordMutation(deps, mutation, { folded, assertValid })
  }

  const id = await resolveEntryId(deps, mutation.ref, mutation.signal)

  if (mutation.kind === 'delete') {
    const entry = await deps.ledger.deleteValidated(id, assertValid, mutation.signal)

    return { kind: 'deleted', entry, book: await bookAfter(deps, folded, mutation) }
  }

  // Resolved fresh rather than carried over: moving a trade to another day moves its settlement day
  // and may move the FX rate its base-currency value was struck at.
  const transaction = await finalizeTransaction(deps, {
    draft: mutation.draft,
    signal: mutation.signal,
  })

  assertVenuesKnown(transaction, venueManifestOf(deps))
  await assertTradePrice(deps, {
    transaction,
    typedPrice: mutation.typedPrice,
    fillSource: undefined,
    signal: mutation.signal,
  })
  await assertFxRateUsed(deps, {
    draft: mutation.draft,
    transaction,
    replacing: id,
    signal: mutation.signal,
  })

  const entry = await deps.ledger.updateValidated(
    { id, transaction, updatedAt: mutation.now },
    assertValid,
    mutation.signal
  )

  return { kind: 'updated', entry, book: await bookAfter(deps, folded, mutation) }
}

async function recordMutation(
  deps: LedgerMutateDeps,
  mutation: RecordMutation,
  context: { readonly folded: { book?: Book }; readonly assertValid: AssertLedgerValid }
): Promise<LedgerWriteResult> {
  const { draft } = mutation
  // The order path mirrors a fill it just read; asking the venue again would re-fetch its own work.
  const resolved =
    mutation.fillSource !== undefined && isResolvedDraft(draft)
      ? { draft, fillSource: mutation.fillSource }
      : await resolveDraft(deps, draft, mutation.signal)
  const recorded = await recordEntry(
    deps,
    { ...mutation, draft: resolved.draft, fillSource: resolved.fillSource },
    context.assertValid
  )
  const planned = await planExit(deps, recorded.entry, mutation)

  return {
    kind: 'recorded',
    ...recorded,
    book: await bookAfter(deps, context.folded, mutation),
    fillSource: resolved.fillSource,
    ...(planned === undefined ? {} : { planned }),
  }
}

/** A buy that lands with no plan standing gets one at its own fill price, whichever surface
 *  recorded it. A planner that fails must not fail the write the operator already made. */
async function planExit(
  deps: LedgerMutateDeps,
  entry: LedgerEntry,
  mutation: RecordMutation
): Promise<StoredSuggestion | undefined> {
  const { transaction } = entry

  if (transaction.kind !== 'buy') {
    return undefined
  }

  try {
    const planned = await deps.exitPlans.plan({
      instrument: transaction.instrument,
      entry: transaction.unitPrice,
      now: mutation.now,
      signal: mutation.signal,
    })

    return planned.kind === 'planned' ? planned.plan : undefined
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    deps.logger.warn('ledger.exit_plan_failed', {
      ticker: transaction.instrument.ticker,
      err: formatErrForLog(err),
    })

    return undefined
  }
}

/** The captured fold, or one read of its own. A replayed insert never reaches the validator — the
 *  row was already written — so it is the one path with nothing to capture. */
async function bookAfter(
  deps: LedgerMutateDeps,
  folded: { book?: Book },
  clock: { readonly now: number; readonly signal: AbortSignal }
): Promise<Book> {
  if (folded.book !== undefined) {
    return folded.book
  }

  const entries = await deps.ledger.listAll(clock.signal)

  return foldBook(orderLedger(entries), dayOf(deps, clock.now), deps.baseCurrency)
}

/** A replayed insert costs no provider call. The same key carrying different content is a caller
 *  bug: returning the first receipt would tell them the second request succeeded. */
async function recordEntry(
  deps: LedgerMutateDeps,
  mutation: ResolvedRecord,
  assertValid: AssertLedgerValid
): Promise<RecordedEntry> {
  const requestFingerprint = await buildRequestFingerprint({
    draft: mutation.draft,
    signal: mutation.signal,
  })
  const existing = await deps.ledger.findByIdempotency({
    idempotencyKey: mutation.idempotencyKey,
    signal: mutation.signal,
  })

  if (existing !== null) {
    if (existing.requestFingerprint !== requestFingerprint) {
      throw new ConflictError(
        `idempotency key ${mutation.idempotencyKey} was reused with a different request`
      )
    }

    return { entry: existing.entry, replayed: true }
  }

  const entry: LedgerEntry = {
    id: buildLedgerEntryId(mutation.now),
    recordedAt: mutation.now,
    transaction: await finalizeTransaction(deps, {
      draft: mutation.draft,
      signal: mutation.signal,
    }),
  }

  assertVenuesKnown(entry.transaction, venueManifestOf(deps))
  await assertTradePrice(deps, {
    transaction: entry.transaction,
    typedPrice: mutation.typedPrice,
    fillSource: mutation.fillSource,
    signal: mutation.signal,
  })
  await assertFxRateUsed(deps, {
    draft: mutation.draft,
    transaction: entry.transaction,
    signal: mutation.signal,
  })

  const result = await deps.ledger.insertValidated(
    { entry, idempotencyKey: mutation.idempotencyKey, requestFingerprint },
    assertValid,
    mutation.signal
  )

  if (result.kind === 'existing') {
    return { entry: result.entry, replayed: true }
  }

  return result.duplicateOf === undefined
    ? { entry: result.entry }
    : { entry: result.entry, duplicateOf: result.duplicateOf }
}

/** The row a ref names, for a caller that shows it before changing it. */
export async function resolveEntry(
  deps: LedgerReader,
  options: { readonly ref: string; readonly signal: AbortSignal }
): Promise<LedgerEntry> {
  const id = await resolveEntryId(deps, options.ref, options.signal)
  const entry = await deps.ledger.findById(id, options.signal)

  if (entry === null) {
    throw new ValidationError(`no ledger entry ${options.ref}`, {
      key: 'errors.ledgerEntryUnknown',
      params: { ref: options.ref },
    })
  }

  return entry
}

/** Accepts the full id the agent reads out of history, or the short handle a human copies from a
 *  chat line. Ambiguity is refused rather than guessed — two entries answering to one handle is the
 *  case where picking either would silently edit the wrong trade. */
async function resolveEntryId(
  deps: LedgerReader,
  ref: string,
  signal: AbortSignal
): Promise<LedgerEntryId> {
  const wanted = ref.trim().toLowerCase()
  // A ref the pattern rejects never reaches the store, and reads to the operator as the entry it
  // names not existing — which is what a ref no row can answer to means either way.
  const matches = isIdRef(wanted) ? await deps.ledger.listIdsMatching(wanted, signal) : []
  const [found] = matches

  if (found === undefined) {
    throw new ValidationError(`no ledger entry ${ref}`, {
      key: 'errors.ledgerEntryUnknown',
      params: { ref },
    })
  }

  if (matches.length > 1) {
    // The handle is the only id a surface prints, and two rows minted in the same millisecond by an
    // older `randomUUIDv7` share their whole tail, so no longer handle would separate them either.
    const ids = matches.join(ENTRY_ID_SEPARATOR)

    throw new ValidationError(
      `${ref} matches ${matches.length} entries — name one in full: ${ids}`,
      {
        key: 'errors.ledgerEntryAmbiguous',
        params: { ref, ids },
      }
    )
  }

  return found
}

/** A price the venue filled is its own figure, never a typed one, so only the board scale is
 *  checked for it. */
export async function assertTradePrice(
  deps: Pick<LedgerMutateDeps, 'marketData' | 'marketDataStore' | 'config' | 'markets' | 'logger'>,
  check: {
    readonly transaction: LedgerTxn
    readonly typedPrice: TypedPrice | undefined
    readonly fillSource: FillSource | undefined
    readonly signal: AbortSignal
  }
): Promise<void> {
  const { transaction, fillSource } = check

  if (!('unitPrice' in transaction)) {
    return
  }

  // A rights issue is priced by the issuer, often at par far under the market, never by a trade.
  const typedPrice =
    transaction.kind === 'rights' || (fillSource !== undefined && fillSource !== 'operator')
      ? undefined
      : check.typedPrice
  const market = deps.markets.find(transaction.instrument.market)

  // A row is validated against the registry, so its market is always found.
  if (market === null) {
    return
  }

  await assertTypedPrice(deps, {
    instrument: transaction.instrument,
    market,
    price: transaction.unitPrice,
    day: transaction.at,
    typedPrice,
    confirmMultiple: deps.config.typedPrices.confirmMultiple,
    signal: check.signal,
  })
}

/** A named rate the row cannot use is refused rather than dropped, or the operator would believe it
 *  was booked. The ledger is read again only when a rate was named. */
async function assertFxRateUsed(
  deps: LedgerMutateDeps,
  input: {
    readonly draft: LedgerTxnDraft
    readonly transaction: LedgerTxn
    readonly replacing?: LedgerEntryId
    readonly signal: AbortSignal
  }
): Promise<void> {
  const { transaction } = input

  if (!(namesFxRate(input.draft) && 'currency' in transaction)) {
    return
  }

  const entries = await deps.ledger.listAll(input.signal)
  const others = entries.filter((entry) => entry.id !== input.replacing)
  const book = foldBook(orderLedger(others), transaction.at, deps.baseCurrency)

  if (fxRateApplies(book, transaction)) {
    return
  }

  const venue = transaction.kind === 'transfer' ? transaction.fromVenue : transaction.venue

  throw new ValidationError(`${transaction.currency} row at ${venue} takes no exchange rate`, {
    key: 'errors.ledgerFxPaidFromCash',
    params: { currency: transaction.currency, venue: venueParam(venue) },
  })
}

/** Validates, then keeps the fold it just proved valid. Two passes over the same rows rather than
 *  one, because `assertLedgerValid` owns what "valid" means and must not also own the book. */
export function validatorFor(
  deps: LedgerMutateDeps,
  folded: { book?: Book },
  now: number
): AssertLedgerValid {
  return (pending) => {
    const today = dayOf(deps, now)

    assertLedgerValid(pending, {
      baseCurrency: deps.baseCurrency,
      today,
      marketFor: (market) => deps.markets.find(market)?.manifest,
      venueFor: venueManifestOf(deps),
    })

    folded.book = foldBook(orderLedger(pending), today, deps.baseCurrency)
  }
}

function venueManifestOf(deps: LedgerMutateDeps): (venue: VenueRef) => VenueManifest | undefined {
  return (venue) => deps.venues.find(venue)?.manifest
}

export function dayOf(deps: LedgerMutateDeps, now: number): TradingDay {
  return resolveRegionDay(deps.markets, deps.defaultRegion, now)
}
