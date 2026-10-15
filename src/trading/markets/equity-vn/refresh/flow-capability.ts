import type { FlowsRequest, InstrumentRequest } from '@/trading/kernel/market/market-capability'
import type { FlowSnapshot } from '@/trading/kernel/market/market-data'
import type { SourceKindMap, SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import type { CrossSectionCache } from '@/trading/markets/equity-vn/evidence/cross-section-cache'
import type { MarketCapability, MarketManifest } from '@/trading/markets/types'
import { available } from '@/trading/kernel/source/source-result'
import { readFlows } from '@/trading/markets/equity-vn/evidence/flow-evidence'
import { VN_INDEX_INSTRUMENT } from '@/trading/markets/equity-vn/factors/factors'
import { VN_FLOW_SESSIONS } from '@/trading/markets/equity-vn/policy'
import { marketFlowSnapshots } from '@/trading/markets/equity-vn/tape/flows'

/** One name's flows come from the provider; the market's are the stored flows of every name,
 *  summed per session, so a market-wide read costs no provider call. */
export function createFlowsCapability(
  deps: MarketDeps,
  manifest: MarketManifest,
  crossSection: CrossSectionCache
): Extract<MarketCapability, { readonly kind: 'flows' }> {
  return {
    kind: 'flows',
    run: (request) =>
      request.instrument === undefined
        ? runMarketFlows(crossSection, request)
        : runFlows(deps, manifest, { ...request, instrument: request.instrument }),
  }
}

async function runMarketFlows(
  cache: CrossSectionCache,
  request: FlowsRequest
): Promise<SourceResult<SourceKindMap['flows']>> {
  const cross = await cache.get(request.asOf, request.signal)
  const flows = cross.names.flatMap((name) => name.flows)
  const newest = flows.reduce<FlowSnapshot | undefined>(
    (latest, flow) => (latest === undefined || flow.fetchedAt > latest.fetchedAt ? flow : latest),
    undefined
  )
  const provenance =
    newest === undefined
      ? []
      : [{ sourceId: newest.sourceId, fetchedAt: newest.fetchedAt, freshness: 'cached' as const }]

  return available(marketFlowSnapshots(flows, VN_INDEX_INSTRUMENT), provenance)
}

/** Dated because the adapters read the desks over a day range and error without one. The caller's
 *  own range is re-applied downstream, so this window only has to cover it. */
function runFlows(
  deps: MarketDeps,
  manifest: MarketManifest,
  request: InstrumentRequest
): Promise<SourceResult<SourceKindMap['flows']>> {
  return readFlows(
    deps.sources,
    {
      instrument: request.instrument,
      fromDay: manifest.calendar.addTradingDays(request.asOf, -VN_FLOW_SESSIONS),
      toDay: request.asOf,
      // A live read of one name persists nothing, so it settles nothing to skip.
      deskDays: new Set(),
    },
    request.signal
  )
}
