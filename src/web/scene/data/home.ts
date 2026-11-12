import { computed, type ReadonlySignal } from '@preact/signals'

import { pageMinute } from '@/web/scene/clock/clock'
import { packOf, type RegionPack } from '@/web/scene/world/regions'
import { homeRegion } from '@/web/state/market'
import { zoneParts } from '@/web/text/time'

/** The region pack of the home region, the default pack until it is known. */
export const regionPack: ReadonlySignal<RegionPack> = computed(() => packOf(homeRegion()))

/** Each lobby wall clock's minute of its own day, read again at each page minute. */
export const wallClockMinutes: ReadonlySignal<readonly number[]> = computed(() => {
  const { at } = pageMinute.value

  return regionPack.value.wallClocks.map((clock) => zoneParts(at, clock.zone).minute)
})
