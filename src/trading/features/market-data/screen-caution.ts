import type {
  PreviousClose,
  ScreenCandidate,
  ScreenPrice,
} from '@/trading/kernel/market/market-capability'
import type { Quote, QuoteFreshness } from '@/trading/kernel/market/market-data'
import type { ScreenCautionCode } from '@/trading/kernel/screen-codes'
import { isGappedPastClose } from '@/trading/markets/statistics'
import { changeAgainstClose } from '@/trading/sources/rows/normalization'

/** The candidate with its live price stamped on, and the caution that price raises. */
export function pricedCandidate(
  candidate: ScreenCandidate,
  quote: Quote,
  observed: QuoteFreshness
): ScreenCandidate {
  const price = { quote: sessionMoved(quote, observed, candidate.previousClose), observed }
  const caution = cautionOf(candidate, price)

  return { ...candidate, price, ...(caution === undefined ? {} : { caution }) }
}

/** What contradicts the rank: a caution the market already published off stored evidence, else
 *  what the live price says against the close the rank was built on. It never re-ranks — a rank
 *  recomputed from an intraday tick would import that tick's noise into factors measured over
 *  months — and only a live reading answers at all, because a close is the price the rank was built
 *  on and cannot contradict it. A published caution outranks both, and locked outranks gapped: a
 *  name nobody can buy today is a stronger statement than one that has merely moved. */
function cautionOf(candidate: ScreenCandidate, price: ScreenPrice): ScreenCautionCode | undefined {
  if (candidate.caution !== undefined) {
    return candidate.caution
  }

  if (price.observed.kind !== 'live') {
    return undefined
  }

  if (isCeilingLocked(candidate, price.quote.price)) {
    return 'ceiling-locked'
  }

  return hasGappedPastClose(candidate, price.quote.price) ? 'gapped-past-close' : undefined
}

function isCeilingLocked(candidate: ScreenCandidate, price: number): boolean {
  const { lockPrice } = candidate

  return lockPrice !== undefined && lockPrice > 0 && price >= lockPrice
}

/** An unmeasured volatility abstains rather than falling back to a fixed percentage: what counts as
 *  a gap on a band-capped VN board and on an uncapped crypto board are different numbers, and one
 *  constant standing for both would be wrong on at least one of them.
 *
 *  Deliberately asymmetric on a continuous market, in the safe direction: `previousClose` is a UTC
 *  boundary a market that never closes does not observe, so the window measured runs from minutes
 *  to a full day, and one daily sigma asks far less of it early in that day than late. A
 *  close-to-close sigma understates crypto besides — a wick that fills inside one day is a zero
 *  return to it. Both miss a caution rather than invent one, which is the side to err on while no
 *  backtest stands behind the threshold. Scaling by elapsed time is the fix, and wants that
 *  measurement first. */
function hasGappedPastClose(candidate: ScreenCandidate, price: number): boolean {
  const { previousClose, volatilityDaily } = candidate

  if (previousClose === undefined || volatilityDaily === undefined) {
    return false
  }

  return isGappedPastClose(price, previousClose.price, volatilityDaily)
}

/** A live row's move is measured against the settled close printed beside it, never a sweep's
 *  rolling 24-hour figure. */
function sessionMoved(
  quote: Quote,
  observed: QuoteFreshness,
  previousClose: PreviousClose | undefined
): Quote {
  if (observed.kind !== 'live' || previousClose === undefined || previousClose.at >= observed.day) {
    return quote
  }

  const changePct = changeAgainstClose(quote.price, previousClose.price, quote.changePct)

  return changePct === undefined ? quote : { ...quote, changePct }
}
