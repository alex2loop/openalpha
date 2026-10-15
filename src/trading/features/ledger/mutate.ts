import type { Logger } from '@/core/logging/logger'
import type { AssertLedgerValid, LedgerStore } from '@/trading/features/ledger/store/ledger'
import type {
  FillSource,
  LedgerEntry,
  LedgerTxnDraft,
  LedgerTxnDraftInput,
  LedgerWriteResult,
  TradeTxnDraft,
  TradeTxnDraftInput,
} from '@/trading/features/ledger/types'
import type { LedgerWriteDeps } from '@/trading/features/ledger/write'
import type { ExitPlanner } from '@/trading/features/suggestion/exit-plan/types'
import type { StoredSuggestion } from '@/trading/features/suggestion/types'
import type { TradingCosts } from '@/trading/kernel/config'
import type { Region, TradingDay } from '@/trading/kernel/instrument'
import type { Book, LedgerEntryId } from '@/trading/kernel/operator/book'
import type { VenueRegistry } from '@/trading/venues/types'
import { ConflictError, isAbortError, ValidationError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { foldBook } from '@/trading/features/ledger/book'
import { isResolvedDraft, isTradeDraft } from '@/trading/features/ledger/draft'
import { resolveVenueFill } from '@/trading/features/ledger/fills'
import { isSellAllDraft, type SELL_ALL } from '@/trading/features/ledger/types'
import { assertLedgerValid, orderLedger } from '@/trading/features/ledger/validate'
import { buildRequestFingerprint, finalizeTransaction } from '@/trading/features/ledger/write'
import { resolveRegionDay } from '@/trading/features/market-data/resolve'
import { isSameInstrument } from '@/trading/kernel/instrument'
import { buildLedgerEntryId } from '@/trading/kernel/operator/book'
import { estimatedFee, resolveTradeCost } from '@/trading/markets/cost'
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
}

/** What a full UUIDv7 id or a slice of its tail can be made of. Checked before the lookup because
 *  the store matches a handle with `LIKE`, where an unfiltered `%` or `_` from an operator would
 *  become a wildcard and could resolve to a row they never named. */
const ENTRY_REF_RE = /^[0-9a-f-]{1,36}$/
/** How the full ids of an ambiguous handle are listed, so the operator can copy one back. */
const ENTRY_ID_SEPARATOR = ', '

/** Narrowed here rather than exported from the ledger's types: only this file resolves a close, so
 *  the shape it resolves has no second reader. */
type CloseDraft = Extract<LedgerTxnDraftInput, { readonly quantity: typeof SELL_ALL }>

/** The written row, plus the earlier one holding its exact content when there is one. */
interface RecordedEntry {
  readonly entry: LedgerEntry
  readonly duplicateOf?: LedgerEntryId
}

type RecordMutation = Extract<LedgerMutation, { readonly kind: 'record' }>
type ResolvedRecord = Omit<RecordMutation, 'draft'> & { readonly draft: LedgerTxnDraft }

/** The row as it will be stored, and where each of its figures came from. */
interface ResolvedDraft {
  readonly draft: LedgerTxnDraft
  readonly fillSource: FillSource
}

/** The trade paths resolve to a trade, so a caller may read the quantity they just resolved without
 *  re-narrowing the whole draft union. */
interface ResolvedTrade extends ResolvedDraft {
  readonly draft: TradeTxnDraft
}

type LedgerMutation =
  | {
      readonly kind: 'record'
      readonly draft: LedgerTxnDraftInput
      readonly idempotencyKey: string
      readonly fillSource?: FillSource
      readonly now: number
      readonly signal: AbortSignal
    }
  | {
      readonly kind: 'update'
      readonly ref: string
      readonly draft: LedgerTxnDraft
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
  const resolved = await resolveDraft(deps, mutation)
  const recorded = await recordEntry(
    deps,
    { ...mutation, draft: resolved.draft },
    context.assertValid
  )
  const planned = await planExit(deps, recorded.entry, mutation)

  return {
    kind: 'recorded',
    entry: recorded.entry,
    book: await bookAfter(deps, context.folded, mutation),
    fillSource: resolved.fillSource,
    ...(recorded.duplicateOf === undefined ? {} : { duplicateOf: recorded.duplicateOf }),
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

/** A stored row states its quantity and its fee. A close resolves the quantity first, because it
 *  has no notional to price a fee against until the book has answered how much it holds. */
async function resolveDraft(
  deps: LedgerMutateDeps,
  mutation: RecordMutation
): Promise<ResolvedDraft> {
  const { draft } = mutation

  // The order path mirrors a fill it just read; asking the venue again would re-fetch its own work.
  if (mutation.fillSource !== undefined && isResolvedDraft(draft)) {
    return { draft, fillSource: mutation.fillSource }
  }

  if (isSellAllDraft(draft)) {
    return resolveClose(deps, draft, mutation.signal)
  }

  return isTradeDraft(draft)
    ? resolveTrade(deps, draft, mutation.signal)
    : { draft, fillSource: 'operator' }
}

/** A close sells what the book holds, so the venue prices it but never sizes it above that. The two
 *  differ by any residue the book never recorded, and a close sized above the book is one the
 *  validator can never admit - leaving a position no close can ever clear. A venue that filled less
 *  keeps its own figure: that is a partial sale, not a residue. */
async function resolveClose(
  deps: LedgerMutateDeps,
  draft: CloseDraft,
  signal: AbortSignal
): Promise<ResolvedDraft> {
  const sized = await resolveCloseQuantity(deps, draft, signal)
  const resolved = await resolveTrade(deps, sized, signal)

  if (resolved.draft.quantity <= sized.quantity) {
    return resolved
  }

  return { draft: { ...resolved.draft, quantity: sized.quantity }, fillSource: 'venuePriced' }
}

/** The venue's own figures whenever it can name the fill, and the configured rate when it cannot.
 *  An unreachable venue degrades to the rate rather than refusing the write: the operator made this
 *  trade whether or not the exchange answers.
 *
 *  A stated fee survives the venue's answer. Quantity and price are facts of execution the operator
 *  cannot hold, but the fee is one they can - a rebate or a tier the config does not know - so the
 *  venue sizes the row and their figure prices it. */
async function resolveTrade(
  deps: LedgerMutateDeps,
  draft: TradeTxnDraftInput,
  signal: AbortSignal
): Promise<ResolvedTrade> {
  try {
    const filled = await resolveVenueFill({
      markets: deps.markets,
      venues: deps.venues,
      draft,
      logger: deps.logger,
      signal,
    })

    if (filled !== undefined) {
      return draft.fee === undefined
        ? { draft: filled, fillSource: 'venue' }
        : { draft: { ...filled, fee: draft.fee }, fillSource: 'venueSized' }
    }
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    deps.logger.warn('ledger.venue_fill_unavailable', {
      venue: draft.venue,
      ticker: draft.instrument.ticker,
      at: draft.at,
      err: formatErrForLog(err),
    })
  }

  return { draft: withFee(draft, deps.costs), fillSource: 'operator' }
}

/** A close carries no count, so the book supplies one: the settled quantity on the day the sale
 *  happened, which is both what the operator held and the largest sell the validator admits. Folded
 *  at that day rather than today, so recording a past close is not sized by a later book. */
async function resolveCloseQuantity(
  deps: LedgerMutateDeps,
  draft: CloseDraft,
  signal: AbortSignal
): Promise<TradeTxnDraftInput> {
  const { instrument, venue, at } = draft
  const entries = await deps.ledger.listAll(signal)
  const book = foldBook(orderLedger(entries), at, deps.baseCurrency)
  const held = book.positions.find(
    (position) => position.venue === venue && isSameInstrument(position.instrument, instrument)
  )

  if (held === undefined || held.settledQuantity <= 0) {
    throw new ValidationError(
      `close of ${instrument.ticker} at ${venue} has nothing settled on ${at}`,
      {
        key: 'errors.ledgerNothingSettled',
        params: { ticker: instrument.ticker, venue: venueParam(venue), day: { day: at } },
      }
    )
  }

  return { ...draft, quantity: held.settledQuantity }
}

/** The one place a fee the operator did not state comes from. A venue with no configured rate has
 *  nothing to derive it from, and a guessed zero would understate the book forever.
 *
 *  The quantity is never derived alongside it. A venue billing in the delivered asset charges the
 *  maker or the taker rate depending on how the order filled, which only the exchange knows, so a
 *  quantity computed from the configured rate would be a guess stored as a recorded fact. */
function withFee(draft: TradeTxnDraftInput, costs: TradingCosts): TradeTxnDraft {
  const { fee } = draft

  if (fee !== undefined) {
    return { ...draft, fee }
  }

  const cost = resolveTradeCost(draft.venue, costs)

  if (cost === undefined) {
    throw new ValidationError(`no configured cost rate for ${draft.venue} - state the fee`, {
      key: 'errors.ledgerNoCostRate',
      params: { venue: venueParam(draft.venue) },
    })
  }

  const rate = draft.kind === 'sell' ? cost.sellRate : cost.buyRate

  return { ...draft, fee: estimatedFee(draft.quantity * draft.unitPrice, rate) }
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

    return { entry: existing.entry }
  }

  const entry: LedgerEntry = {
    id: buildLedgerEntryId(mutation.now),
    recordedAt: mutation.now,
    transaction: await finalizeTransaction(deps, {
      draft: mutation.draft,
      signal: mutation.signal,
    }),
  }
  const result = await deps.ledger.insertValidated(
    { entry, idempotencyKey: mutation.idempotencyKey, requestFingerprint },
    assertValid,
    mutation.signal
  )

  return result.kind === 'inserted' && result.duplicateOf !== undefined
    ? { entry: result.entry, duplicateOf: result.duplicateOf }
    : { entry: result.entry }
}

/** Accepts the full id the agent reads out of history, or the short handle a human copies from a
 *  chat line. Ambiguity is refused rather than guessed — two entries answering to one handle is the
 *  case where picking either would silently edit the wrong trade. */
async function resolveEntryId(
  deps: LedgerMutateDeps,
  ref: string,
  signal: AbortSignal
): Promise<LedgerEntryId> {
  const wanted = ref.trim().toLowerCase()
  // A ref the pattern rejects never reaches the store, and reads to the operator as the entry it
  // names not existing — which is what a ref no row can answer to means either way.
  const matches = ENTRY_REF_RE.test(wanted) ? await deps.ledger.listIdsMatching(wanted, signal) : []
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

/** Validates, then keeps the fold it just proved valid. Two passes over the same rows rather than
 *  one, because `assertLedgerValid` owns what "valid" means and must not also own the book. */
function validatorFor(
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
      venueFor: (venue) => deps.venues.find(venue)?.manifest,
    })

    folded.book = foldBook(orderLedger(pending), today, deps.baseCurrency)
  }
}

function dayOf(deps: LedgerMutateDeps, now: number): TradingDay {
  return resolveRegionDay(deps.markets, deps.defaultRegion, now)
}
