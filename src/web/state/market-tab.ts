import { computed, type ReadonlySignal, signal } from '@preact/signals'

import { homeRegion, knownMarkets } from '@/web/state/market'
import { openView } from '@/web/state/panel'
import { readStorage, writeStorage } from '@/web/state/storage'

const REGION_STORAGE_KEY = 'office.marketRegion'

export type MarketSubTab = 'market' | 'news' | 'themes'

interface RegionChoice {
  readonly region: string
  readonly label: string
}

/** The part of Thị trường on screen. */
export const marketSubTab = signal<MarketSubTab>('market')

// The last region picked in this browser, kept across visits.
const pickedRegion = signal(readStorage('local', REGION_STORAGE_KEY))

/** Every region the daemon trades, the home region first, then in the daemon's order. */
export const marketRegions: ReadonlySignal<readonly RegionChoice[]> = computed(() => {
  const home = homeRegion()
  const regions = new Map<string, string>()

  for (const market of knownMarkets.value) {
    if (!regions.has(market.region)) {
      regions.set(market.region, market.regionLabel)
    }
  }

  const choices = [...regions].map(([region, label]) => ({ region, label }))

  return [
    ...choices.filter((choice) => choice.region === home),
    ...choices.filter((choice) => choice.region !== home),
  ]
})

/** The region the tab reads: the last one picked while the daemon still trades it, else the home
 *  region; absent until the markets are read. */
export const marketRegion: ReadonlySignal<string | undefined> = computed(() => {
  const picked = pickedRegion.value
  const regions = marketRegions.value

  return regions.some((choice) => choice.region === picked) ? picked : regions[0]?.region
})

export function pickMarketRegion(region: string): void {
  pickedRegion.value = region
  writeStorage('local', REGION_STORAGE_KEY, region)
}

/** Opens Thị trường on `subTab`, keeping the view it leaves to go back to. */
export function openMarketTab(subTab: MarketSubTab): void {
  marketSubTab.value = subTab
  openView({ tab: 'market' })
}
