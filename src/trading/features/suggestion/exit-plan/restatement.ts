import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { SuggestionStore } from '@/trading/features/suggestion/store/suggestion'
import type { InstrumentRef } from '@/trading/kernel/instrument'
import type { RefreshMarketDataResult } from '@/trading/kernel/market/refresh'
import type { DeliveryAddress } from '@/trading/kernel/operator/delivery'
import type { TradingNoticeSender } from '@/trading/kernel/operator/notice'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { ticker } from '@/trading/kernel/instrument'
import { sendCaught } from '@/trading/kernel/operator/delivery-retry'

export interface RestatementDeps {
  readonly suggestions: SuggestionStore
  readonly sender: TradingNoticeSender
  recipient(): DeliveryAddress | undefined
  readonly logger: Logger
  readonly defaultLocale: Locale
}

/** The names a refresh pass rebuilt, as instruments. A kind reports its subjects as plain strings so
 *  the kernel result stays free of a market's own types, and each one came from a `Ticker`, so the
 *  re-brand is a widening back to what the market already held. */
function restatedInstruments(result: RefreshMarketDataResult): readonly InstrumentRef[] {
  return result.results.flatMap((kind) =>
    (kind.restatedTargets ?? []).map((name) => ({ market: result.market, ticker: ticker(name) }))
  )
}

async function clearName(
  deps: RestatementDeps,
  instrument: InstrumentRef,
  at: { readonly now: number; readonly signal: AbortSignal }
): Promise<boolean> {
  try {
    const rows = await deps.suggestions.clearRestated({
      market: instrument.market,
      ticker: instrument.ticker,
      now: at.now,
      signal: at.signal,
    })

    return rows > 0
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    deps.logger.warn('trading.restated_plan_clear_failed', {
      market: instrument.market,
      ticker: instrument.ticker,
      err: formatErrForLog(err),
    })

    return false
  }
}

/** A rebuilt series leaves every plan priced on the old basis describing a trade that no longer
 *  exists. Clearing them is what lets the next exit tick write fresh levels from the series as it
 *  now stands; the operator is told once, because a level they were watching has moved. Names are
 *  cleared one at a time rather than in one statement: a restatement reaches a handful of names at
 *  most, and a failure then costs that name rather than the pass. */
export async function clearRestatedPlans(
  deps: RestatementDeps,
  result: RefreshMarketDataResult,
  signal: AbortSignal
): Promise<void> {
  const now = Date.now()
  const closed: string[] = []

  for (const instrument of restatedInstruments(result)) {
    if (await clearName(deps, instrument, { now, signal })) {
      closed.push(instrument.ticker)
    }
  }

  if (closed.length === 0) {
    return
  }

  deps.logger.info('trading.plans_expired_on_restatement', { tickers: closed })

  const delivery = deps.recipient()

  if (delivery === undefined) {
    return
  }

  const outcome = await sendCaught(
    deps.sender,
    {
      target: delivery,
      locale: deps.defaultLocale,
      payload: { kind: 'series-restated', tickers: closed },
    },
    signal
  )

  if (outcome !== 'accepted') {
    deps.logger.warn('trading.restatement_notice_undelivered', { tickers: closed, outcome })
  }
}
