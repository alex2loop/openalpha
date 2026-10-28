import { computed } from '@preact/signals'

import { screenSeries } from '@/web/scene/data/desk-reads'
import { homeMarket } from '@/web/scene/data/home'
import { breachedStops } from '@/web/scene/data/room-status'
import { sceneGoals, wantedGoals } from '@/web/scene/overlay/actor-state'
import { buildMarkers } from '@/web/scene/overlay/markers'
import { buildScreens } from '@/web/scene/overlay/screens'
import { pending, runs } from '@/web/state/live'

const litScreens = computed(() =>
  buildScreens({
    goals: wantedGoals.value,
    runs: runs.value,
    series: screenSeries.value,
    market: homeMarket.value?.market,
  })
)
/** The "!" over each person something waits on, wherever they stand. */
const markers = computed(() =>
  buildMarkers({ goals: sceneGoals.value, pending: pending.value, breached: breachedStops.value })
)

/** What the overlay hands the renderers each frame: the marks and the lit desk screens. */
export const sceneHandOff = computed(() => ({
  marks: markers.value,
  deskScreens: litScreens.value,
}))
