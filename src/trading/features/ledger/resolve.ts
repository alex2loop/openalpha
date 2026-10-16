import type { Logger } from '@/core/logging/logger'
import type { LedgerStore } from '@/trading/features/ledger/store/ledger'
import type {
  FillSource,
  LedgerTxnDraft,
  LedgerTxnDraftInput,
  SELL_ALL,
  TradeTxnDraft,
  TradeTxnDraftInput,
} from '@/trading/features/ledger/types'
import type { TradingCosts } from '@/trading/kernel/config'
import type { CurrencyCode } from '@/trading/kernel/instrument'
import type { MarketRegistry } from '@/trading/markets/types'
import type { VenueRegistry } from '@/trading/venues/types'
import { isAbortError, ValidationError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { foldBook } from '@/trading/features/ledger/book'
import { isTradeDraft } from '@/trading/features/ledger/draft'
import { resolveVenueFill } from '@/trading/features/ledger/fills'
import { isSellAllDraft } from '@/trading/features/ledger/types'
import { orderLedger } from '@/trading/features/ledger/validate'
import { isSameInstrument } from '@/trading/kernel/instrument'
import { estimatedFee, resolveTradeCost } from '@/trading/markets/cost'
import { venueParam } from '@/trading/render/format'

/** What resolving a draft reads. `LedgerMutateDeps` satisfies it, which keeps this file from
 *  importing the write path it feeds. */
interface ResolveDeps {
  readonly markets: MarketRegistry
  readonly venues: VenueRegistry
  readonly costs: TradingCosts
  readonly logger: Logger
  readonly ledger: Pick<LedgerStore, 'listAll'>
  readonly baseCurrency: CurrencyCode
}

/** Narrowed here rather than exported from the ledger's types: only this file resolves a close, so
 *  the shape it resolves has no second reader. */
type CloseDraft = Extract<LedgerTxnDraftInput, { readonly quantity: typeof SELL_ALL }>

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

/** A stored row states its quantity and its fee. A close resolves the quantity first, because it
 *  has no notional to price a fee against until the book has answered how much it holds. */
export async function resolveDraft(
  deps: ResolveDeps,
  draft: LedgerTxnDraftInput,
  signal: AbortSignal
): Promise<ResolvedDraft> {
  if (isSellAllDraft(draft)) {
    return resolveClose(deps, draft, signal)
  }

  return isTradeDraft(draft) ? resolveTrade(deps, draft, signal) : { draft, fillSource: 'operator' }
}

/** A close sells what the book holds, so the venue prices it but never sizes it above that. The two
 *  differ by any residue the book never recorded, and a close sized above the book is one the
 *  validator can never admit - leaving a position no close can ever clear. A venue that filled less
 *  keeps its own figure: that is a partial sale, not a residue. */
async function resolveClose(
  deps: ResolveDeps,
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
  deps: ResolveDeps,
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
  deps: ResolveDeps,
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
