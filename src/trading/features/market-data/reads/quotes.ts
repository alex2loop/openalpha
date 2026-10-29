import type { MarketDataRunDeps } from '@/trading/features/market-data/market-data-run'
import type {
  MarketDataBarsRequest,
  MarketDataEventsRequest,
  MarketDataInstrumentRequest,
  MarketDataQuoteRequest,
} from '@/trading/features/market-data/types'
import type { InstrumentKind } from '@/trading/kernel/instrument'
import type { AccountsHistory } from '@/trading/kernel/market/annual-accounts'
import type { InstrumentRequest, QuoteView } from '@/trading/kernel/market/market-capability'
import type {
  AnalystRecommendation,
  Candle,
  FundingSnapshot,
} from '@/trading/kernel/market/market-data'
import type { MarketEvent } from '@/trading/kernel/market/market-event'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { Market, MarketManifest } from '@/trading/markets/types'
import type { QuoteConvention } from '@/trading/render/money'
import { withinRange } from '@/trading/features/market-data/market-data-run'
import { freshnessOf } from '@/trading/features/market-data/reads/freshness'
import { settledCloseBefore } from '@/trading/features/market-data/reads/previous-close'
import {
  calendarSessionsBetween,
  resolveDay,
  resolveInstrument,
  unsupportedCapability,
} from '@/trading/features/market-data/resolve'
import { isLevelKind } from '@/trading/kernel/instrument'
import { available } from '@/trading/kernel/source/source-result'

export async function runQuote(
  deps: MarketDataRunDeps,
  options: MarketDataQuoteRequest
): Promise<SourceResult<QuoteView>> {
  const resolved = await resolveInstrument(deps.markets, options)

  if (resolved.kind === 'unresolved') {
    return resolved.result
  }

  const { market, instrument } = resolved
  const asOf = resolveDay(market, options.now)
  const result = await market.capabilities.quote?.run({
    instrument,
    asOf,
    now: options.now,
    signal: options.signal,
  })

  if (result === undefined) {
    return unsupportedCapability()
  }

  if (result.kind !== 'available') {
    return result
  }

  const observed = freshnessOf(
    { calendar: market.manifest.calendar, timezone: market.manifest.calendar.timezone },
    result.value.observedAt,
    options.now
  )
  const previousClose =
    options.withPreviousClose === true
      ? await settledCloseBefore(market, instrument, {
          observed,
          now: options.now,
          signal: options.signal,
        })
      : undefined

  return available(
    {
      quote: result.value,
      observed,
      ...quotedFieldsOf(market.manifest, resolved.instrumentKind),
      ...(previousClose === undefined ? {} : { previousClose }),
    },
    result.provenance,
    result.caveats
  )
}

/** The convention `runQuote` would stamp, without fetching a price. Absent for a level, which prints
 *  as a bare number, and for a name the registry cannot resolve. */
export async function runQuoteConvention(
  deps: MarketDataRunDeps,
  options: Pick<MarketDataInstrumentRequest, 'ticker' | 'market' | 'signal'>
): Promise<QuoteConvention | undefined> {
  const resolved = await resolveInstrument(deps.markets, options)

  if (resolved.kind === 'unresolved') {
    return undefined
  }

  const { unit, currency, display } = quotedFieldsOf(
    resolved.market.manifest,
    resolved.instrumentKind
  )

  if (unit === undefined || currency === undefined) {
    return undefined
  }

  return { unit, currency, ...(display === undefined ? {} : { display }) }
}

/** Absent for a level: labelling it in đồng and dividing it by the board scale is exactly the
 *  misreading the convention exists to prevent. */
function quotedFieldsOf(
  manifest: MarketManifest,
  kind: InstrumentKind | undefined
): Pick<QuoteView, 'unit' | 'currency' | 'display'> {
  if (isLevelKind(kind)) {
    return {}
  }

  return {
    unit: manifest.quoteUnit,
    currency: manifest.currency,
    ...(manifest.priceDisplay === undefined ? {} : { display: manifest.priceDisplay }),
  }
}

type InstrumentRead<T> = (
  market: Market,
  request: InstrumentRequest
) => Promise<SourceResult<T>> | undefined

/** Resolve the name, then ask its market. A market that does not publish the read says so. */
async function runInstrumentRead<T>(
  deps: MarketDataRunDeps,
  options: MarketDataInstrumentRequest,
  read: InstrumentRead<T>
): Promise<SourceResult<T>> {
  const resolved = await resolveInstrument(deps.markets, options)

  if (resolved.kind === 'unresolved') {
    return resolved.result
  }

  const { market, instrument } = resolved
  const request = {
    instrument,
    asOf: resolveDay(market, options.now),
    now: options.now,
    signal: options.signal,
  }

  return (await read(market, request)) ?? unsupportedCapability()
}

export function runFunding(
  deps: MarketDataRunDeps,
  options: MarketDataInstrumentRequest
): Promise<SourceResult<FundingSnapshot>> {
  return runInstrumentRead(deps, options, (market, request) =>
    market.capabilities.funding?.run(request)
  )
}

export function runRecommendations(
  deps: MarketDataRunDeps,
  options: MarketDataInstrumentRequest
): Promise<SourceResult<readonly AnalystRecommendation[]>> {
  return runInstrumentRead(deps, options, (market, request) =>
    market.capabilities.recommendations?.run(request)
  )
}

export function runAccounts(
  deps: MarketDataRunDeps,
  options: MarketDataInstrumentRequest
): Promise<SourceResult<AccountsHistory>> {
  return runInstrumentRead(deps, options, (market, request) =>
    market.capabilities.accounts?.run(request)
  )
}

/** The bars capability counts sessions; the surface names two days. The owning market's calendar
 *  performs that conversion, because only it knows which days between them were sessions. The window
 *  it reads opens one session before the first, so the rows are filtered back to the two days. */
export async function runBars(
  deps: MarketDataRunDeps,
  options: MarketDataBarsRequest
): Promise<SourceResult<readonly Candle[]>> {
  const resolved = await resolveInstrument(deps.markets, options)

  if (resolved.kind === 'unresolved') {
    return resolved.result
  }

  const { market, instrument } = resolved
  const sessions = calendarSessionsBetween(market, options.fromDay, options.toDay)

  if (sessions === 0) {
    return unsupportedCapability([{ code: 'market-data.insufficient-history' }])
  }

  const result =
    (await market.capabilities.bars?.run({
      instrument,
      sessions,
      asOf: options.toDay,
      now: options.now,
      signal: options.signal,
    })) ?? unsupportedCapability()

  return withinRange(result, options, (candle) => candle.at)
}

/** Corporate events are published per instrument, so the range narrows the answer rather than
 *  selecting it: the capability is asked as of the range end and the rows are filtered back. */
export async function runEvents(
  deps: MarketDataRunDeps,
  options: MarketDataEventsRequest
): Promise<SourceResult<readonly MarketEvent[]>> {
  const resolved = await resolveInstrument(deps.markets, {
    ticker: options.ticker,
    ...(options.market === undefined ? {} : { market: options.market }),
    signal: options.signal,
  })

  if (resolved.kind === 'unresolved') {
    return resolved.result
  }

  const capability = resolved.market.capabilities.events

  if (capability === undefined) {
    return unsupportedCapability()
  }

  const result = await capability.run({
    instrument: resolved.instrument,
    fromDay: options.fromDay,
    asOf: options.toDay,
    now: options.now,
    signal: options.signal,
  })

  return withinRange(result, options, (event) => event.at)
}
