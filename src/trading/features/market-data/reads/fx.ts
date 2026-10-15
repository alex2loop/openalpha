import type { Logger } from '@/core/logging/logger'
import type { FxRateStore } from '@/trading/features/market-data/store/fx-rate'
import type { Caveat } from '@/trading/kernel/caveat'
import type { FxConvertOptions, FxRates } from '@/trading/kernel/market/fx-rates'
import type { FxConversion } from '@/trading/kernel/market/market-capability'
import type { FxQuote } from '@/trading/kernel/market/market-data'
import type { SourceResult, SourceUnavailable } from '@/trading/kernel/source/source-result'
import type { SourceRegistry } from '@/trading/markets/types'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { dedupeCaveats, sourcedCaveat } from '@/trading/kernel/caveat'
import { currencyCode, fxPair, isFiatCurrency } from '@/trading/kernel/instrument'
import { sourceId } from '@/trading/kernel/source/source-id'
import { available } from '@/trading/kernel/source/source-result'
import { shiftCalendarDay } from '@/trading/markets/calendar'

/** A same-currency rate is arithmetic, not a provider answer; it still needs a stamp so callers
 *  never special-case a missing one. */
const IDENTITY_SOURCE_ID = sourceId('identity')
/** How old a rate may be and still stand for a day: a stored one marking a book through a provider
 *  outage, or a dated close answering a day the pair did not trade. A weekend plus a holiday is the
 *  longest gap worth papering over; past that the refusal is the honest answer. */
const RATE_MAXIMUM_AGE_DAYS = 3
/** What a pair with no direct route is bridged through. Every fiat provider quotes against it, and
 *  the coin providers price their coins in it. */
const BRIDGE_CURRENCY = currencyCode('USD')

interface FxRatesDeps {
  readonly sources: SourceRegistry
  readonly store: FxRateStore
  readonly logger: Logger
}

/** A pair travels as `context.ticker`, never as an instrument; an FX quote has no owning market,
 *  so the context carries none. */
export function createFxRates(deps: FxRatesDeps): FxRates {
  return {
    async convert(options): Promise<SourceResult<FxQuote>> {
      if (options.fromCurrency === options.toCurrency) {
        return available(identityQuote(options), [])
      }

      const bridged = await bridgedRate(deps, options)

      if (bridged.result !== null) {
        return bridged.result
      }

      // The legs' own refusals ride along: a caller told only that the pair is unavailable cannot
      // tell a dead coin provider from a dead fiat one, and they fail over differently.
      return withCaveats(await directRate(deps, options), bridged.caveats)
    },
  }
}

interface BridgedRate {
  readonly result: SourceResult<FxQuote> | null
  readonly caveats: readonly Caveat[]
}

/** Tried before the pair itself, because no venue quotes a coin against a local fiat: every provider
 *  composes that cross internally, so composing it here reads each leg from the provider that
 *  genuinely quotes it, and leaves both legs stored. The coin leg is a peg that ages in basis points
 *  while the fiat leg stays live, which is what carries a book through an outage of the one provider
 *  family that covers coins. The product is never stored — a rate nobody quoted must not later
 *  answer as one that was.
 *
 *  A cross of two ISO codes is left alone: the fiat providers cover exactly that shape, so bridging
 *  it would spend two calls on the same providers that answer in one. */
async function bridgedRate(deps: FxRatesDeps, options: FxConvertOptions): Promise<BridgedRate> {
  if (options.fromCurrency === BRIDGE_CURRENCY || options.toCurrency === BRIDGE_CURRENCY) {
    return { result: null, caveats: [] }
  }
  if (isFiatCurrency(options.fromCurrency) && isFiatCurrency(options.toCurrency)) {
    return { result: null, caveats: [] }
  }

  const [base, quote] = await Promise.all([
    directRate(deps, { ...options, toCurrency: BRIDGE_CURRENCY }),
    directRate(deps, { ...options, fromCurrency: BRIDGE_CURRENCY }),
  ])
  const caveats = dedupeCaveats([...base.caveats, ...quote.caveats])

  if (base.kind === 'unavailable' || quote.kind === 'unavailable') {
    return { result: null, caveats }
  }

  return {
    result: available(
      composedQuote(options, base.value, quote.value),
      [...base.provenance, ...quote.provenance],
      caveats
    ),
    caveats: [],
  }
}

function withCaveats(
  result: SourceResult<FxQuote>,
  extra: readonly Caveat[]
): SourceResult<FxQuote> {
  return extra.length === 0
    ? result
    : { ...result, caveats: dedupeCaveats([...extra, ...result.caveats]) }
}

/** The whole stamp comes from the weaker leg, so `asOf` and `sourceId` describe one reading rather
 *  than two that disagree about how old the answer is. */
function composedQuote(options: FxConvertOptions, base: FxQuote, quote: FxQuote): FxQuote {
  const weaker = base.asOf <= quote.asOf ? base : quote

  return {
    fromCurrency: options.fromCurrency,
    toCurrency: options.toCurrency,
    rate: base.rate * quote.rate,
    asOf: weaker.asOf,
    sourceId: weaker.sourceId,
    fetchedAt: weaker.fetchedAt,
  }
}

/** The pair as a provider quotes it: live when one answers, the last stored reading when none does.
 *  A bridge leg resolves through here too and never bridges again, because a product of two derived
 *  legs is not a rate anyone quoted. */
async function directRate(
  deps: FxRatesDeps,
  options: FxConvertOptions
): Promise<SourceResult<FxQuote>> {
  const live = await liveRate(deps, options)

  if (live.kind === 'available') {
    return options.onDay === true && live.value.asOf > options.asOf
      ? ((await datedRate(deps, options)) ?? live)
      : live
  }

  return (await storedRate(deps, options, live)) ?? live
}

/** The pair's own close on or before the day. A pair no provider carries history for keeps the live
 *  quote, which states its own later day. */
async function datedRate(
  deps: FxRatesDeps,
  options: FxConvertOptions
): Promise<SourceResult<FxQuote> | null> {
  const history = await deps.sources.resolve({
    kind: 'fxHistory',
    context: {
      ticker: fxPair(options.fromCurrency, options.toCurrency),
      fromDay: shiftCalendarDay(options.asOf, -RATE_MAXIMUM_AGE_DAYS),
      toDay: options.asOf,
    },
    signal: options.signal,
  })

  if (history.kind !== 'available') {
    return null
  }

  const point = history.value.at(-1)
  const [source] = history.provenance

  if (point === undefined || source === undefined) {
    return null
  }

  return available(
    {
      fromCurrency: options.fromCurrency,
      toCurrency: options.toCurrency,
      rate: point.rate,
      asOf: point.day,
      sourceId: source.sourceId,
      fetchedAt: source.fetchedAt,
    },
    history.provenance,
    history.caveats
  )
}

/** Remembered whenever a provider answers, so the next outage has a reading to fall back on. */
async function liveRate(
  deps: FxRatesDeps,
  options: FxConvertOptions
): Promise<SourceResult<FxQuote>> {
  const live = await deps.sources.resolve({
    kind: 'fx',
    context: { ticker: fxPair(options.fromCurrency, options.toCurrency) },
    signal: options.signal,
  })

  if (live.kind === 'available') {
    await remember(deps, live.value, options.signal)
  }

  return live
}

/** NAV is all-or-nothing, so a declined rate costs the whole book while one a day or two old costs
 *  basis points and says which reading it is. The failed providers' own caveats ride along: what
 *  went wrong and what was served instead are different facts.
 *
 *  A store that cannot be read leaves the providers' own refusal standing: this is a cache, and one
 *  that takes down the read it exists to protect is worse than no cache at all. */
async function storedRate(
  deps: FxRatesDeps,
  options: FxConvertOptions,
  live: SourceUnavailable
): Promise<SourceResult<FxQuote> | null> {
  const stored = await readStored(deps, options)
  const oldest = shiftCalendarDay(options.asOf, -RATE_MAXIMUM_AGE_DAYS)

  if (stored === null || stored.asOf < oldest) {
    return null
  }

  return available(
    stored,
    [{ sourceId: stored.sourceId, fetchedAt: stored.fetchedAt, freshness: 'cached' }],
    [...live.caveats, sourcedCaveat('source.stale-cache', [stored.sourceId], { sourceKind: 'fx' })]
  )
}

async function readStored(deps: FxRatesDeps, options: FxConvertOptions): Promise<FxQuote | null> {
  try {
    return await deps.store.find(options, options.signal)
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    deps.logger.warn('trading.fx_rate_unreadable', {
      pair: fxPair(options.fromCurrency, options.toCurrency),
      err: formatErrForLog(err),
    })

    return null
  }
}

/** The rate is already answered, so a write that fails costs the next outage its fallback and
 *  nothing else. */
async function remember(deps: FxRatesDeps, quote: FxQuote, signal: AbortSignal): Promise<void> {
  try {
    await deps.store.upsert(quote, signal)
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    deps.logger.warn('trading.fx_rate_not_stored', {
      pair: fxPair(quote.fromCurrency, quote.toCurrency),
      err: formatErrForLog(err),
    })
  }
}

/** A same-currency conversion is arithmetic, not a provider call: routing it would make every
 *  base-currency position depend on an FX source being configured. Nothing fetched it, so the stamp
 *  is inert and `toConversion` publishes no provenance for it. */
function identityQuote(options: FxConvertOptions): FxQuote {
  return {
    fromCurrency: options.fromCurrency,
    toCurrency: options.toCurrency,
    rate: 1,
    asOf: options.asOf,
    sourceId: IDENTITY_SOURCE_ID,
    fetchedAt: 0,
  }
}

/** Which of the three answered is read off the quote's own stamp, never re-derived from the rate:
 *  a provider that happens to quote a peg at exactly 1 is still a provider. Identity carries no
 *  provenance because nothing was fetched. */
export function toConversion(quote: FxQuote, operatorRate?: number): FxConversion {
  const pair = {
    fromCurrency: quote.fromCurrency,
    toCurrency: quote.toCurrency,
    asOf: quote.asOf,
  }

  if (operatorRate !== undefined) {
    return { ...pair, rate: operatorRate, source: 'operator' }
  }

  if (quote.sourceId === IDENTITY_SOURCE_ID) {
    return { ...pair, rate: quote.rate, source: 'identity' }
  }

  return {
    ...pair,
    rate: quote.rate,
    source: 'provider',
    sourceId: quote.sourceId,
    fetchedAt: quote.fetchedAt,
  }
}
