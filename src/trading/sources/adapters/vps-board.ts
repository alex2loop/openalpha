// Source class: scraping-risky. `bgapidatafeed.vps.com.vn` is VPS Securities' own price-board feed —
// undocumented and with no SLA, on a different host from the `vps` chart feed, so it registers under
// its own id. The endpoint is code-owned because it is a provider fact.
import { z } from 'zod'

import type { Ticker, VnIndexTier } from '@/trading/kernel/instrument'
import type { IndexMembership } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { BasketReader } from '@/trading/sources/rows/index-baskets'
import type { SourceFetchOutcome } from '@/trading/sources/types'
import { ValidationError } from '@/core/errors'
import { ticker } from '@/trading/kernel/instrument'
import { sourceId } from '@/trading/kernel/source/source-id'
import { createSource } from '@/trading/sources/define'
import { loadMemberships } from '@/trading/sources/rows/index-baskets'
import { dropInvalid, parseRow } from '@/trading/sources/rows/normalization'

export const VPS_BOARD_DEFAULT_ENDPOINT = 'https://bgapidatafeed.vps.com.vn'

const VPS_BOARD_ID = sourceId('vps-board')
const LIST_PATH = '/getlistckindex'
const INDEX_CODES = Object.freeze({
  vn30: 'VN30',
  vn100: 'VN100',
} as const satisfies Readonly<Record<VnIndexTier, string>>)

const SYMBOL_ROW = z.string().min(1)

export function createVpsBoardSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [indexMembershipSource(options)]
}

/** Behind `vietcap`, which has no second opinion to disagree with. The VN30 lists are identical, but
 *  this feed's VN100 list ran behind: on 2026-11-03 nine names differed and four of its own VN30
 *  names were missing from it, so a basket pair that does not nest is refused rather than stamped. */
function indexMembershipSource(options: SourceAdapterOptions): RegisteredSource {
  const reader: BasketReader = {
    http: options.http,
    request: (tier, signal) => ({
      sourceId: VPS_BOARD_ID,
      path: `${LIST_PATH}/${INDEX_CODES[tier]}`,
      signal,
    }),
    parse: toSymbols,
  }

  return createSource({
    id: VPS_BOARD_ID,
    kind: 'indexMembership',
    http: options.http,
    covers: (context: SourceContext) => context.market !== undefined,
    load: (context, signal) => loadNestedMemberships(reader, context, signal),
  })
}

async function loadNestedMemberships(
  reader: BasketReader,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<readonly IndexMembership[]>>> {
  const outcome = await loadMemberships(reader, context, signal)

  return outcome.kind === 'ok' && !isNested(outcome.value.value)
    ? { kind: 'error', code: 'source.payload-rejected' }
    : outcome
}

function isNested(memberships: readonly IndexMembership[]): boolean {
  const wide = new Set(
    memberships.filter(({ tier }) => tier === 'vn100').map(({ instrument }) => instrument.ticker)
  )

  return memberships
    .filter(({ tier }) => tier === 'vn30')
    .every(({ instrument }) => wide.has(instrument.ticker))
}

/** A malformed row costs that symbol, never the basket. */
function toSymbols(raw: unknown): readonly Ticker[] {
  if (!Array.isArray(raw)) {
    throw new ValidationError('vps basket payload is not an array')
  }

  return dropInvalid(raw, (row) => ticker(parseRow(SYMBOL_ROW, row, 'vps basket')))
}
