// Source class: free and keyless, and a venue rather than an aggregator — it quotes the coin-fiat
// pair it actually trades. It leads the fx route for the coins it lists, so the peg a crypto book is
// valued through does not rest on a metered index alone.
import { z } from 'zod'

import type { RegisteredSource } from '@/trading/kernel/source/source-result'
import type { CryptoFxReading, CryptoFxSpec } from '@/trading/sources/adapters/crypto-fx'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import { sourceId } from '@/trading/kernel/source/source-id'
import { boardObservedAt } from '@/trading/sources/adapters/crypto-board'
import { createCryptoFx } from '@/trading/sources/adapters/crypto-fx'
import { QUOTE_ATTEMPT_LIMITS } from '@/trading/sources/transport/http'

export const COINBASE_DEFAULT_ENDPOINT = 'https://api.exchange.coinbase.com'

const COINBASE_SOURCE = sourceId('coinbase')

/** The coins this venue prices against a fiat. It spells a coin on the wire exactly as the pair's
 *  base is spelled, so there is no mapping to hold here — only which coins are covered. */
const FX_COINS: ReadonlySet<string> = new Set(['USDT'])
/** A product the venue does not list answers 404. That is a property of the request — this venue
 *  trades some pairs and not others — rather than a provider that failed. */
const PRODUCT_MISS_STATUSES: readonly number[] = Object.freeze([404])

/** `price` is the last trade and `time` is when it printed, both as strings. */
const TICKER = z.object({ price: z.string().min(1), time: z.string().min(1) })

export function createCoinbaseSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [createCryptoFx(options, FX)]
}

const FX: CryptoFxSpec = {
  id: COINBASE_SOURCE,
  coinId: (base) => (FX_COINS.has(base) ? base : undefined),
  request: (input) => ({
    ...QUOTE_ATTEMPT_LIMITS,
    path: `/products/${input.coinId}-${input.fiat}/ticker`,
    businessMissStatuses: PRODUCT_MISS_STATUSES,
  }),
  parse: (raw) => toFxReading(TICKER.parse(raw)),
}

function toFxReading(row: z.infer<typeof TICKER>): CryptoFxReading {
  return { rate: Number(row.price), ...boardObservedAt(row.time) }
}
