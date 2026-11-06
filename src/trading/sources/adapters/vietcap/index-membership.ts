import { z } from 'zod'

import type { Ticker, VnIndexTier } from '@/trading/kernel/instrument'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import type { BasketReader } from '@/trading/sources/rows/index-baskets'
import { ValidationError } from '@/core/errors'
import { ticker } from '@/trading/kernel/instrument'
import { VIETCAP_ID } from '@/trading/sources/adapters/vietcap/client'
import { createSource } from '@/trading/sources/define'
import { loadMemberships } from '@/trading/sources/rows/index-baskets'
import { dropInvalid, parseRow } from '@/trading/sources/rows/normalization'

const GROUP_PATH = '/api/price/symbols/getByGroup'
const GROUP_CODES = Object.freeze({
  vn30: 'VN30',
  vn100: 'VN100',
} as const satisfies Readonly<Record<VnIndexTier, string>>)

const MEMBERSHIP_ROW = z.object({ symbol: z.string().min(1) })

export function indexMembershipSource(options: SourceAdapterOptions): RegisteredSource {
  const reader: BasketReader = {
    http: options.http,
    request: (tier, signal) => ({
      sourceId: VIETCAP_ID,
      path: GROUP_PATH,
      query: { group: GROUP_CODES[tier] },
      signal,
    }),
    parse: toSymbols,
  }

  return createSource({
    id: VIETCAP_ID,
    kind: 'indexMembership',
    http: options.http,
    covers: (context: SourceContext) => context.market !== undefined,
    load: (context, signal) => loadMemberships(reader, context, signal),
  })
}

/** A malformed row costs that symbol, never the basket. */
function toSymbols(raw: unknown): readonly Ticker[] {
  if (!Array.isArray(raw)) {
    throw new ValidationError('vietcap basket payload is not an array')
  }

  return dropInvalid(raw, (row) => ticker(parseRow(MEMBERSHIP_ROW, row, 'vietcap basket').symbol))
}
