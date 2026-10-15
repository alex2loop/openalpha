import type { Logger } from '@/core/logging/logger'
import type { ActiveAlert } from '@/trading/features/alerts/types'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { QuoteView } from '@/trading/kernel/market/market-capability'
import type { AlertId } from '@/trading/kernel/operator/alert'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { OperationTickOptions } from '@/trading/kernel/store/page'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { parseExitLevel } from '@/trading/features/alerts/types'

export interface PriceObservation {
  readonly price: number
  readonly high: number
  readonly low: number
  /** What a holder is paid to sell, where a dealer board quotes it apart from `price`. */
  readonly exitPrice?: number
  /** When the session behind `high` and `low` began, where the reading says. */
  readonly sessionFromAt?: number
}

interface ObservationDeps {
  readonly marketData: MarketDataService
  readonly logger: Logger
}

/** Whether the alert's threshold was reached, read on the side and session span it watches, and
 *  the price that reached it. */
export function toCrossing(
  alert: ActiveAlert,
  quoted: PriceObservation
): { readonly crossed: boolean; readonly price: number } {
  const observation = watchedObservation(alert, quoted)

  return { crossed: hasCrossed(alert, observation), price: crossingPrice(alert, observation) }
}

/** An exit level sits on the price a holder is paid, so a dealer board's exit alert reads its buy
 *  price. An alert armed after its session opened reads the last price alone: the session's
 *  extremes include moves from before it was watching. Every other alert reads the quote as
 *  printed. */
function watchedObservation(alert: ActiveAlert, observation: PriceObservation): PriceObservation {
  const { exitPrice, price, sessionFromAt } = observation

  if (exitPrice !== undefined && parseExitLevel(alert.origin) !== null) {
    return { price: exitPrice, high: exitPrice, low: exitPrice }
  }

  if (sessionFromAt !== undefined && alert.createdAt > sessionFromAt) {
    return { price, high: price, low: price }
  }

  return observation
}

function hasCrossed(alert: ActiveAlert, observation: PriceObservation): boolean {
  return alert.condition === 'above'
    ? observation.high >= alert.threshold
    : observation.low <= alert.threshold
}

/** The extremum that crossed, not the last trade: the notice must show a price that satisfies the
 *  condition it announces. */
function crossingPrice(alert: ActiveAlert, observation: PriceObservation): number {
  return alert.condition === 'above' ? observation.high : observation.low
}

/** One instrument's quote as the alert pass reads it; undefined when it cannot be priced. */
export async function observePrice(
  deps: ObservationDeps,
  alert: ActiveAlert,
  options: OperationTickOptions<AlertId>
): Promise<PriceObservation | undefined> {
  const quote = await readQuote(deps, alert, options)

  if (quote?.kind !== 'available' || !Number.isFinite(quote.value.quote.price)) {
    return undefined
  }

  const { price, session, board } = quote.value.quote
  const high = session !== undefined && Number.isFinite(session.high) ? session.high : price
  const low = session !== undefined && Number.isFinite(session.low) ? session.low : price

  return {
    price,
    high: Math.max(price, high),
    low: Math.min(price, low),
    ...(board === undefined ? {} : { exitPrice: board.buyPrice }),
    ...(session?.fromAt === undefined ? {} : { sessionFromAt: session.fromAt }),
  }
}

/** One instrument's read failing leaves only its alerts unpriced: an escaped error would stop the
 *  whole tick, so its cursor would never advance and every other alert would stall behind it. */
async function readQuote(
  deps: ObservationDeps,
  alert: ActiveAlert,
  options: OperationTickOptions<AlertId>
): Promise<SourceResult<QuoteView> | undefined> {
  try {
    return await deps.marketData.quote({
      ticker: alert.instrument.ticker,
      market: alert.instrument.market,
      now: options.now,
      signal: options.signal,
    })
  } catch (err: unknown) {
    if (options.signal.aborted || isAbortError(err)) {
      throw err
    }

    deps.logger.warn('trading.alert_quote_failed', {
      market: alert.instrument.market,
      ticker: alert.instrument.ticker,
      err: formatErrForLog(err),
    })

    return undefined
  }
}
