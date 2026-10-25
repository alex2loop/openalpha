import { computed, type ReadonlySignal, signal } from '@preact/signals'

import type { MarketsResponse, MarketWire } from '@/app/server/wire/market'
import { getJson } from '@/web/api/client'
import { startPoll } from '@/web/api/poll'
import { ROUTES } from '@/web/api/routes'
import { packOf, type RegionPack } from '@/web/scene/world/regions'

// The session phase moves a few times a day; a minute is soon enough to follow it.
const MARKETS_POLL_MS = 60_000

const markets = signal<MarketsResponse | undefined>(undefined)

/** The market that speaks for the operator's home region; absent until `/v1/markets` answers. */
export const homeMarket: ReadonlySignal<MarketWire | undefined> = computed(() => {
  const read = markets.value

  return read?.markets.find((market) => market.region === read.homeRegion && market.ownsRegion)
})
/** The region pack of the home region, the default pack until it is known. */
export const regionPack: ReadonlySignal<RegionPack> = computed(() =>
  packOf(markets.value?.homeRegion)
)

/** Reads `/v1/markets` now and every `MARKETS_POLL_MS` while the scene is up. */
export function startHome(): () => void {
  return startPoll(loadMarkets, MARKETS_POLL_MS)
}

// A failed read keeps the last good one: the scene then shows the session it last knew, and none
// before the first read.
async function loadMarkets(abortSignal: AbortSignal): Promise<void> {
  markets.value = await getJson(ROUTES.markets, { signal: abortSignal })
}
