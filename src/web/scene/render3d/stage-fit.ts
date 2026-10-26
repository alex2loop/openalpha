import { Vector2, type WebGLRenderer } from 'three'

import type { Size } from '@/web/scene/types'
import { colorScheme } from '@/web/state/prefs'

const STAGE_TOKEN = '--stage'
const STAGE_FALLBACK = 0xffffff
const MAX_PIXEL_RATIO = 2
const paneSize = new Vector2()

// The pane's stage colour behind the building, read once per scheme.
export function syncStageColor(stage: {
  readonly canvas: HTMLCanvasElement
  readonly renderer: WebGLRenderer
  scheme: string
}): boolean {
  const scheme = colorScheme.value

  if (stage.scheme === scheme) {
    return false
  }

  const stageColor = getComputedStyle(stage.canvas).getPropertyValue(STAGE_TOKEN).trim()

  stage.scheme = scheme
  stage.renderer.setClearColor(stageColor === '' ? STAGE_FALLBACK : stageColor)

  return true
}

export function resize(renderer: WebGLRenderer, pane: Size): boolean {
  const ratio = Math.min(devicePixelRatio, MAX_PIXEL_RATIO)
  const held = renderer.getSize(paneSize)

  if (renderer.getPixelRatio() === ratio && held.x === pane.w && held.y === pane.h) {
    return false
  }

  renderer.setPixelRatio(ratio)
  renderer.setSize(pane.w, pane.h, false)

  return true
}
