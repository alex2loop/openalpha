import type { Caveat } from '@/trading/kernel/caveat'
import type { Ticker, VnIndexTier } from '@/trading/kernel/instrument'
import type { IndexMembership, InstrumentRecord } from '@/trading/kernel/market/market-data'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import { VN_INDEX_TIERS } from '@/trading/kernel/instrument'
import { unavailable } from '@/trading/kernel/source/source-result'
import { VN_MARKET_REF } from '@/trading/markets/equity-vn/policy'

/** A membership list is a label on the listing, never worth stalling the universe for: a host that
 *  hangs on connect would otherwise hold the whole refresh to its own timeout. */
const MEMBERSHIP_BUDGET_MS = 5_000

type TierByTicker = ReadonlyMap<Ticker, VnIndexTier>

/** Past the budget the read is cancelled and counts as unavailable, so the stored tiers carry
 *  forward. The caller's own abort still travels. */
export async function resolveMemberships(
  deps: MarketDeps,
  signal: AbortSignal
): Promise<SourceResult<readonly IndexMembership[]>> {
  const budget = new AbortController()
  const timer = setTimeout(() => budget.abort(), MEMBERSHIP_BUDGET_MS)

  try {
    return await deps.sources.resolve({
      kind: 'indexMembership',
      context: { market: VN_MARKET_REF },
      signal: AbortSignal.any([signal, budget.signal]),
    })
  } catch (err: unknown) {
    if (budget.signal.aborted && !signal.aborted) {
      return unavailable('failed', [])
    }

    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** Narrowest wins: `VN_INDEX_TIERS` is ordered narrowest first, and VN30 ⊂ VN100. On an
 *  unavailable source the prior scope's tiers carry forward — scope replacement rewrites every
 *  row, so unstamped records would silently wipe what the last refresh stored. */
export function stampIndexTier(
  records: readonly InstrumentRecord[],
  memberships: SourceResult<readonly IndexMembership[]>,
  stored: readonly InstrumentRecord[]
): readonly InstrumentRecord[] {
  const tierByTicker =
    memberships.kind === 'unavailable'
      ? tierByTickerFromStored(stored)
      : tierByTickerFromMemberships(memberships.value)

  return records.map((record) => {
    const tier = record.kind === 'equity' ? tierByTicker.get(record.instrument.ticker) : undefined

    return tier === undefined ? record : { ...record, indexTier: tier }
  })
}

export function membershipCaveats(
  memberships: SourceResult<readonly IndexMembership[]>
): readonly Caveat[] {
  return memberships.kind === 'unavailable'
    ? [...memberships.caveats, { code: 'source.index-membership-unavailable' }]
    : memberships.caveats
}

function tierByTickerFromStored(stored: readonly InstrumentRecord[]): TierByTicker {
  const map = new Map<Ticker, VnIndexTier>()

  for (const record of stored) {
    if (record.indexTier !== undefined) {
      map.set(record.instrument.ticker, record.indexTier)
    }
  }

  return map
}

function tierByTickerFromMemberships(memberships: readonly IndexMembership[]): TierByTicker {
  const map = new Map<Ticker, VnIndexTier>()

  for (const tier of VN_INDEX_TIERS) {
    for (const row of memberships) {
      if (row.tier === tier && !map.has(row.instrument.ticker)) {
        map.set(row.instrument.ticker, tier)
      }
    }
  }

  return map
}
