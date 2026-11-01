import type { PainterState, StreetMinute } from '@/web/scene/render2d/street/paint'
import type { RegionPack } from '@/web/scene/world/regions'
import { regionPack } from '@/web/scene/data/home'
import { staticPxOf } from '@/web/scene/render2d/street/detail'
import { layerKeyOf } from '@/web/scene/render2d/street/layer-cache'
import { startRun, stepRun } from '@/web/scene/render2d/street/paint-run'
import { staticStepsOf } from '@/web/scene/render2d/street/parts'
import { STREET_RECT } from '@/web/scene/view'
import { reducedMotion } from '@/web/state/prefs'
import { locale } from '@/web/state/session'

/** Paints the static canvas a few steps until `until` (a `performance.now` time) when its minute
 *  or look changed, or goes on with a repaint begun in an earlier frame; true when it painted. The
 *  repaint follows the minute, the day, the pack, the language, the detail level, the camera's
 *  reveal of the sky above the frame, the sky and the weather, and starts over when one of them
 *  changes before it ends. */
export function syncStatic(state: PainterState, minute: StreetMinute, until: number): boolean {
  const pack = regionPack.value
  const key = layerKeyOf([
    Math.floor(minute.minute),
    Math.floor(minute.clock),
    minute.day,
    pack.id,
    locale.value,
    minute.detail,
    minute.isRevealed,
    reducedMotion.value,
  ])
  const isSame =
    key === state.staticKey &&
    minute.light === state.moving.minute.light &&
    minute.weather === state.moving.minute.weather

  if (!isSame) {
    startStatic(state, { minute, pack, key })
  }

  const run = state.staticRun

  if (run === undefined) {
    return false
  }

  if (stepRun(run, until)) {
    state.staticRun = undefined
    state.staticVersion++

    // A sprite the run had no time to build is left out, and the next frame paints it all again.
    if (run.isPartial) {
      state.staticKey = ''
    }
  }

  return true
}

/** Keeps the longest frame of one repaint: a frame that painted after one that did not starts a
 *  new one. */
export function notePaintMs(state: PainterState, startedAt: number, isPainting: boolean): void {
  if (isPainting) {
    const ms = performance.now() - startedAt

    state.paintMs = state.isPainting ? Math.max(state.paintMs, ms) : ms
  }

  state.isPainting = isPainting
}

function startStatic(
  state: PainterState,
  job: { readonly minute: StreetMinute; readonly pack: RegionPack; readonly key: string }
): void {
  const { minute, pack } = job

  // The new run takes over the scratch canvas of one it replaces.
  state.detail = minute.detail
  state.moving.minute = minute
  state.moving.pack = pack
  state.staticRun = startRun({
    shown: state.staticCanvas,
    scratch: state.staticScratch,
    rect: STREET_RECT,
    px: staticPxOf(minute.detail),
    steps: staticStepsOf(pack, minute),
  })
  state.staticKey = state.staticRun === undefined ? '' : job.key
}
