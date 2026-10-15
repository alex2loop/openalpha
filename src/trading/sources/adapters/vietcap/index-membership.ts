import { z } from 'zod'

import type { CaveatCode } from '@/trading/kernel/caveat'
import type { MarketRef, Ticker, VnIndexTier } from '@/trading/kernel/instrument'
import type { IndexMembership } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { SourceFetchOutcome, SourceHttp } from '@/trading/sources/types'
import { ValidationError } from '@/core/errors'
import { ticker, VN_INDEX_TIERS } from '@/trading/kernel/instrument'
import { VIETCAP_ID } from '@/trading/sources/adapters/vietcap/client'
import { createSource, parsedSource } from '@/trading/sources/define'
import { dropInvalid, parseRow } from '@/trading/sources/rows/normalization'

const GROUP_PATH = '/api/price/symbols/getByGroup'
const GROUP_CODES = Object.freeze({
  vn30: 'VN30',
  vn100: 'VN100',
} as const satisfies Readonly<Record<VnIndexTier, string>>)

const MEMBERSHIP_ROW = z.object({ symbol: z.string().min(1) })

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
export function indexMembershipSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: VIETCAP_ID,
    kind: 'indexMembership',
    http: options.http,
    covers: (context: SourceContext) => context.market !== undefined,
    load: (context, signal) => loadMemberships(options.http, context, signal),
  })
}

async function loadMemberships(
  http: SourceHttp,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<readonly IndexMembership[]>>> {
  const market = context.market

  if (market === undefined) {
    throw new ValidationError('index membership request carries no market')
  }

  const outcomes = await Promise.all(
    VN_INDEX_TIERS.map(async (tier): Promise<BasketOutcome> => {
      const outcome = await http.getJson(
        { sourceId: VIETCAP_ID, path: GROUP_PATH, query: { group: GROUP_CODES[tier] }, signal },
        (raw) => toSymbols(raw)
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
  // caps, a wrong tier rather than a missing one. A basket this host stopped serving answers []
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

/** A malformed row costs that symbol, never the basket. */
function toSymbols(raw: unknown): readonly Ticker[] {
  if (!Array.isArray(raw)) {
    throw new ValidationError('vietcap basket payload is not an array')
  }

  return dropInvalid(raw, (row) => ticker(parseRow(MEMBERSHIP_ROW, row, 'vietcap basket').symbol))
}
