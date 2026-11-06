import type { CaveatCode } from '@/trading/kernel/caveat'
import type { MarketRef, Ticker, VnIndexTier } from '@/trading/kernel/instrument'
import type { IndexMembership } from '@/trading/kernel/market/market-data'
import type { SourceContext } from '@/trading/kernel/source/source-result'
import type { ParsedSource } from '@/trading/sources/define'
import type { SourceFetchOutcome, SourceHttp, SourceRequest } from '@/trading/sources/types'
import { ValidationError } from '@/core/errors'
import { VN_INDEX_TIERS } from '@/trading/kernel/instrument'
import { parsedSource } from '@/trading/sources/define'

/** What one provider contributes to a basket read: where each tier's list lives and how its payload
 *  turns into tickers. */
export interface BasketReader {
  readonly http: SourceHttp
  request(tier: VnIndexTier, signal: AbortSignal): SourceRequest
  parse(raw: unknown): readonly Ticker[]
}

interface Basket {
  readonly tier: VnIndexTier
  readonly symbols: readonly Ticker[]
  readonly fetchedAt: number
}

interface BasketOutcome {
  readonly tier: VnIndexTier
  readonly outcome: SourceFetchOutcome<readonly Ticker[]>
}

/** The baskets nest, so the narrowest one a name appears in is the one that counts. Both are
 *  fetched together and admitted together — a half-resolved pair cannot be stamped. */
export async function loadMemberships(
  reader: BasketReader,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<readonly IndexMembership[]>>> {
  const market = context.market

  if (market === undefined) {
    throw new ValidationError('index membership request carries no market')
  }

  const outcomes = await Promise.all(
    VN_INDEX_TIERS.map(async (tier): Promise<BasketOutcome> => {
      const outcome = await reader.http.getJson(reader.request(tier, signal), (raw) =>
        reader.parse(raw)
      )

      return { tier, outcome }
    })
  )
  const usable = outcomes.flatMap((entry): readonly Basket[] =>
    entry.outcome.kind === 'ok' && entry.outcome.value.length > 0
      ? [{ tier: entry.tier, symbols: entry.outcome.value, fetchedAt: entry.outcome.fetchedAt }]
      : []
  )

  // Every basket or none: a VN100 list without its VN30 list would stamp thirty large caps as mid
  // caps, a wrong tier rather than a missing one. A basket a host stopped serving answers []
  // rather than an error, so an empty one is refused the same way.
  if (usable.length !== VN_INDEX_TIERS.length) {
    return firstFailure(outcomes)
  }

  return {
    kind: 'ok',
    value: parsedSource(toMemberships(usable, market), []),
    fetchedAt: Math.max(...usable.map((basket) => basket.fetchedAt)),
  }
}

/** The transport's own code where a basket failed outright, so a timeout is not reported as a bad
 *  payload. An empty basket carries no error and is the rejection itself. */
function firstFailure(outcomes: readonly BasketOutcome[]): {
  readonly kind: 'error'
  readonly code: CaveatCode
} {
  for (const { outcome } of outcomes) {
    if (outcome.kind === 'error') {
      return outcome
    }
  }

  return { kind: 'error', code: 'source.payload-rejected' }
}

/** Flat rows, one per membership: a name in both baskets appears twice, and choosing between them
 *  is the market's call, not this adapter's. */
function toMemberships(baskets: readonly Basket[], market: MarketRef): readonly IndexMembership[] {
  return baskets.flatMap(({ tier, symbols }) =>
    symbols.map((symbol): IndexMembership => ({ instrument: { market, ticker: symbol }, tier }))
  )
}
