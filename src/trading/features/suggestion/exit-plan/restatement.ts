import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { SuggestionStore } from '@/trading/features/suggestion/store/suggestion'
import type { InstrumentRef } from '@/trading/kernel/instrument'
import type { RefreshMarketDataResult, SeriesRebase } from '@/trading/kernel/market/refresh'
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

interface RestatedName {
  readonly instrument: InstrumentRef
  readonly rebase?: SeriesRebase
}

type Settled = 'closed' | 'rebased'

/** A rebuilt series leaves every plan priced on the old basis describing a trade that no longer
 *  exists. A clean re-basing (one factor, a dividend or a split) converts them to the new scale and
 *  they keep counting; any other restatement clears them, which is what lets the next exit tick
 *  write fresh levels from the series as it now stands. The operator is told once, because a level
 *  they were watching has moved. Names are settled one at a time rather than in one statement: a
 *  restatement reaches a handful of names at most, and a failure then costs that name rather than
 *  the pass. */
export async function settleRestatedPlans(
  deps: RestatementDeps,
  result: RefreshMarketDataResult,
  signal: AbortSignal
): Promise<void> {
  const now = Date.now()
  const closed: string[] = []
  const rebased: string[] = []

  for (const name of restatedNames(result)) {
    const settled = await settleName(deps, name, { now, signal })

    if (settled === 'closed') {
      closed.push(name.instrument.ticker)
    } else if (settled === 'rebased') {
      rebased.push(name.instrument.ticker)
    }
  }

  if (closed.length > 0) {
    deps.logger.info('trading.plans_expired_on_restatement', { tickers: closed })
  }

  if (rebased.length > 0) {
    deps.logger.info('trading.plans_rebased_on_restatement', { tickers: rebased })
  }

  if (closed.length > 0 || rebased.length > 0) {
    await announce(deps, { closed, rebased }, signal)
  }
}

/** The names a refresh pass rebuilt, as instruments. A kind reports its subjects as plain strings so
 *  the kernel result stays free of a market's own types, and each one came from a `Ticker`, so the
 *  re-brand is a widening back to what the market already held. */
function restatedNames(result: RefreshMarketDataResult): readonly RestatedName[] {
  return result.results.flatMap((kind) =>
    (kind.restatedTargets ?? []).map(({ target, rebase }) => ({
      instrument: { market: result.market, ticker: ticker(target) },
      ...(rebase === undefined ? {} : { rebase }),
    }))
  )
}

/** A clean re-basing converts the name's plans; when that fails, or the restatement has no factor,
 *  they are cleared instead so no plan on the old scale is left standing. */
async function settleName(
  deps: RestatementDeps,
  name: RestatedName,
  at: { readonly now: number; readonly signal: AbortSignal }
): Promise<Settled | undefined> {
  if (name.rebase !== undefined) {
    const rows = await rebaseName(
      deps,
      { instrument: name.instrument, rebase: name.rebase },
      at.signal
    )

    if (rows !== undefined) {
      return rows > 0 ? 'rebased' : undefined
    }
  }

  return (await clearName(deps, name.instrument, at)) ? 'closed' : undefined
}

/** The rows converted, or `undefined` when the conversion failed. */
async function rebaseName(
  deps: RestatementDeps,
  name: { readonly instrument: InstrumentRef; readonly rebase: SeriesRebase },
  signal: AbortSignal
): Promise<number | undefined> {
  try {
    return await deps.suggestions.rebaseOpenCalls({
      market: name.instrument.market,
      ticker: name.instrument.ticker,
      rebase: name.rebase,
      signal,
    })
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    deps.logger.warn('trading.restated_plan_rebase_failed', {
      market: name.instrument.market,
      ticker: name.instrument.ticker,
      err: formatErrForLog(err),
    })

    return undefined
  }
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

async function announce(
  deps: RestatementDeps,
  names: { readonly closed: readonly string[]; readonly rebased: readonly string[] },
  signal: AbortSignal
): Promise<void> {
  const delivery = deps.recipient()

  if (delivery === undefined) {
    return
  }

  const outcome = await sendCaught(
    deps.sender,
    {
      target: delivery,
      locale: deps.defaultLocale,
      payload: { kind: 'series-restated', tickers: names.closed, rebased: names.rebased },
    },
    signal
  )

  if (outcome !== 'accepted') {
    deps.logger.warn('trading.restatement_notice_undelivered', { ...names, outcome })
  }
}
