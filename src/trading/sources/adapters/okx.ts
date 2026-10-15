// Source class: free and keyless, and a venue rather than an aggregator - the one this book's
// crypto orders are actually routed to. It leads the crypto quote order so a plan names a price the
// operator can reach, rather than one from an exchange they hold nothing on. OKX answers a pair it
// does not list as HTTP 200 carrying a code, so the miss mapping lives in the fold rather than in
// `businessMissStatuses`, which only sees transport statuses.
import { z } from 'zod'

import type { InstrumentRef } from '@/trading/kernel/instrument'
import type { Quote } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { CryptoFxReading, CryptoFxSpec } from '@/trading/sources/adapters/crypto-fx'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { SourceFetchOutcome } from '@/trading/sources/types'
import { sourceId } from '@/trading/kernel/source/source-id'
import { createCryptoFx } from '@/trading/sources/adapters/crypto-fx'
import { createSource, parsedSource } from '@/trading/sources/define'
import { dayChangePct, finite, positive } from '@/trading/sources/rows/normalization'
import { QUOTE_ATTEMPT_LIMITS } from '@/trading/sources/transport/http'

export const OKX_DEFAULT_ENDPOINT = 'https://www.okx.com'

const OKX_ID = sourceId('okx')
/** Every pair this adapter reads is USDT-quoted, so a price is already a USD-equivalent one. */
const QUOTE_ASSET = 'USDT'
const OK_CODE = '0'
const SYMBOL_MISS_CODE = '51001'
const TICKER_PATH = '/api/v5/market/ticker'

/** The coin this venue prices against a fiat is the asset its pairs are quoted in: a book marked
 *  through those pairs holds its crypto value in that asset and converts from there. */
const FX_COINS: ReadonlySet<string> = new Set([QUOTE_ASSET])
/** The fiat leg of every coin cross, because `bridgedRate` splits a coin-fiat pair at USD before a
 *  provider is asked. Declined rather than attempted: OKX answers an unlisted pair with 200 and a
 *  code, which no transport miss mapping reads. */
const FX_FIAT = 'USD'

/** `last` is the last trade and `ts` the instant it printed. `sodUtc0` is the price at 00:00 UTC,
 *  which on a market whose day is the UTC day is the previous session's close - the `open24h`
 *  beside it is a rolling window that measures from a price appearing on no surface. */
const TICKER = z.object({
  last: z.string().min(1),
  sodUtc0: z.string().optional(),
  ts: z.string().min(1),
})

// `data` is `[]` on an error code, so it cannot be required: demanding a row rejects the payload
// before the code below can name the miss, turning "no such pair" into "unparseable".
const ENVELOPE = z.object({ code: z.string(), data: z.array(TICKER).optional() })

/** The fx read asks only for a pair this venue lists, so a payload with no row is a broken answer
 *  rather than a miss and is rejected here instead of being folded into a rate. */
const FX_ENVELOPE = z.object({ data: z.tuple([TICKER]).rest(TICKER) })

export function createOkxSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [quoteSource(options), createCryptoFx(options, FX)]
}

/** The peg the crypto book is valued through, read off the venue that actually holds its coins.
 *  Declining every fiat but USD keeps the request to a pair this tape is known to carry, so the
 *  parse below can require its row. */
const FX: CryptoFxSpec = {
  id: OKX_ID,
  coinId: (base) => (FX_COINS.has(base) ? base : undefined),
  request: (input) =>
    input.fiat === FX_FIAT
      ? {
          ...QUOTE_ATTEMPT_LIMITS,
          path: TICKER_PATH,
          query: { instId: `${input.coinId}-${input.fiat}` },
        }
      : null,
  parse: (raw) => toFxReading(FX_ENVELOPE.parse(raw)),
}

function toFxReading(envelope: z.infer<typeof FX_ENVELOPE>): CryptoFxReading {
  const [row] = envelope.data
  const observedAt = Number(row.ts)

  // An unusable stamp leaves the reading undated rather than dating it `NaN`: the pair trades
  // continuously, so the fetch instant the caller falls back to is honest, and a rate is worth
  // more than the instant it was read at.
  return { rate: Number(row.last), ...(Number.isFinite(observedAt) ? { observedAt } : {}) }
}

function quoteSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: OKX_ID,
    kind: 'quote',
    http: options.http,
    covers: (context) => context.instrument !== undefined,
    load: (context, signal) => loadQuote(options, context, signal),
    observedAt: (value) => value.observedAt,
  })
}

async function loadQuote(
  options: SourceAdapterOptions,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<Quote>>> {
  const instrument = context.instrument

  if (instrument === undefined) {
    return { kind: 'error', code: 'source.symbol-not-found' as const }
  }

  const outcome = await options.http.getJson(
    {
      ...QUOTE_ATTEMPT_LIMITS,
      sourceId: OKX_ID,
      path: TICKER_PATH,
      query: { instId: `${instrument.ticker}-${QUOTE_ASSET}` },
      signal,
    },
    (raw) => ENVELOPE.parse(raw)
  )

  if (outcome.kind !== 'ok') {
    return outcome
  }

  if (outcome.value.code === SYMBOL_MISS_CODE) {
    return { kind: 'error', code: 'source.symbol-not-found' as const }
  }

  if (outcome.value.code !== OK_CODE) {
    return { kind: 'error', code: 'source.unavailable' as const }
  }

  const row = outcome.value.data?.[0]

  // An accepted request that carried no row is a pair this venue does not list, not a failure to
  // answer, so it must not count against the provider.
  if (row === undefined) {
    return { kind: 'error', code: 'source.symbol-not-found' as const }
  }

  return { kind: 'ok', value: parsedSource(toQuote(row, instrument)), fetchedAt: outcome.fetchedAt }
}

function toQuote(row: z.infer<typeof TICKER>, instrument: InstrumentRef): Quote {
  const price = positive(Number(row.last), 'last')
  const previousClose = Number(row.sodUtc0)
  const changePct = dayChangePct(price, previousClose > 0 ? previousClose : undefined)

  return {
    instrument,
    price,
    observedAt: finite(Number(row.ts), 'ts'),
    ...(changePct === undefined ? {} : { changePct }),
  }
}
