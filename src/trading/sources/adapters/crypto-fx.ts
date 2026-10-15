// One coin priced in one fiat, shared by every provider that can do it. A provider contributes the
// id it knows the coin under, its request and its row mapping; splitting the pair, deciding
// coverage and stamping the quote are the same wherever the number came from.
import type { CurrencyCode } from '@/trading/kernel/instrument'
import type { FxQuote } from '@/trading/kernel/market/market-data'
import type { SourceId } from '@/trading/kernel/source/source-id'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import type { SourceRequest } from '@/trading/sources/types'
import { ValidationError } from '@/core/errors'
import { MS_PER_SECOND } from '@/core/utils/time'
import { currencyCode, FIAT_CODE_LENGTH } from '@/trading/kernel/instrument'
import { createSource, parsedSource } from '@/trading/sources/define'
import { dayFromEpochSeconds, positive } from '@/trading/sources/rows/normalization'

/** Both legs must match the currency brand's own shape. Checked before `currencyCode` is called,
 *  because `covers` runs on every routed request and a predicate that throws is not a predicate. */
const CODE_RE = /^[A-Z]{3,4}$/
/** A coin pair trades continuously and belongs to no exchange, so its day is the UTC one — the same
 *  clock the crypto calendar keeps. */
const FX_DAY_TIMEZONE = 'UTC'

interface CryptoFxPair {
  readonly base: CurrencyCode
  readonly fiat: CurrencyCode
}

interface CryptoFxRequestInput {
  readonly coinId: string
  readonly fiat: CurrencyCode
}

/** `createSource` supplies `sourceId` and the caller's `signal`, so a spec never names either. */
type CryptoFxRequest = Omit<SourceRequest, 'sourceId' | 'signal'>

/** What one provider answered: the price of one coin in the fiat asked for, and when it observed
 *  it. `observedAt` is absent when the payload carries no usable stamp. */
export interface CryptoFxReading {
  readonly rate: number
  readonly observedAt?: number
}

/** What a provider must supply to price a coin in a fiat. `coinId` is how the provider names the
 *  coin — `tether` on one, `usdt-tether` on another — and returning `undefined` is how it says it
 *  cannot price that one. `request` declines the same way once it sees the fiat leg, which is the
 *  only place a venue listing a coin against one currency alone can say so. */
export interface CryptoFxSpec {
  readonly id: SourceId
  coinId(base: CurrencyCode): string | undefined
  request(input: CryptoFxRequestInput): CryptoFxRequest | null
  parse(raw: unknown): CryptoFxReading
}

/** An FX rate for a pair whose base is a coin. The fiat providers split a pair into two ISO codes
 *  and so never cover one, which is what keeps the routes from overlapping. */
export function createCryptoFx(
  options: SourceAdapterOptions,
  spec: CryptoFxSpec
): RegisteredSource {
  return createSource({
    id: spec.id,
    kind: 'fx',
    format: 'json',
    http: options.http,
    covers: (context) => coinIdFor(context, spec) !== undefined,
    request: (context) => {
      const pair = toCryptoFxPair(context.ticker)
      const coinId = coinIdFor(context, spec)

      return pair === undefined || coinId === undefined
        ? null
        : spec.request({ coinId, fiat: pair.fiat })
    },
    parse: (raw, context, fetchedAt) => {
      const pair = toCryptoFxPair(context.ticker)

      if (pair === undefined) {
        throw new ValidationError(`${spec.id} fx requires a coin-fiat pair ticker`)
      }

      return parsedSource(
        toFxQuote({ reading: spec.parse(raw), pair, sourceId: spec.id, fetchedAt })
      )
    },
  })
}

function coinIdFor(context: SourceContext, spec: CryptoFxSpec): string | undefined {
  const pair = toCryptoFxPair(context.ticker)

  return pair === undefined ? undefined : spec.coinId(pair.base)
}

/** `USDTVND` to its two legs, or nothing when the ticker is not a pair this shape can read. The
 *  fiat leg is ISO 4217, so the pair splits at a fixed offset from its end and the coin leg is
 *  whatever precedes it — `USDTVND` is USDT in VND, not USD in TVND. */
function toCryptoFxPair(raw: string | undefined): CryptoFxPair | undefined {
  if (raw === undefined) {
    return undefined
  }

  const base = raw.slice(0, -FIAT_CODE_LENGTH)
  const fiat = raw.slice(-FIAT_CODE_LENGTH)

  if (!(CODE_RE.test(base) && CODE_RE.test(fiat))) {
    return undefined
  }

  return { base: currencyCode(base), fiat: currencyCode(fiat) }
}

interface FxQuoteInput {
  readonly reading: CryptoFxReading
  readonly pair: CryptoFxPair
  readonly sourceId: SourceId
  readonly fetchedAt: number
}

/** The fetch instant when the provider published no usable stamp: a continuously traded pair read
 *  now is honestly dated now, and a missing stamp must not cost the whole reading. */
function toFxQuote(input: FxQuoteInput): FxQuote {
  const { fetchedAt, pair, sourceId } = input
  const observedAt = input.reading.observedAt ?? fetchedAt

  return {
    fromCurrency: pair.base,
    toCurrency: pair.fiat,
    rate: positive(input.reading.rate, 'rate'),
    asOf: dayFromEpochSeconds(observedAt / MS_PER_SECOND, FX_DAY_TIMEZONE),
    sourceId,
    fetchedAt,
  }
}
