import { type ReadonlySignal, signal } from '@preact/signals'

import { paintBuilding } from '@/web/scene/render2d/building'
import { zeroCanvas } from '@/web/scene/renderer'
import { WORLD } from '@/web/scene/types'
import { view } from '@/web/scene/view'

// Wide enough for a picture seen only through a blur; small enough to encode at once.
const STILL_WIDTH = 480
const STILL_TYPE = 'image/webp'
const STILL_QUALITY = 0.8

const still = signal<string | undefined>(undefined)

/** The office as last seen, a data URL: what Info only shows behind its glass. */
export const officeStill: ReadonlySignal<string | undefined> = still

/** Keeps a small copy of the scene's canvas, taken while its last frame is still on it. */
export function keepStill(source: HTMLCanvasElement): void {
  if (source.width === 0 || source.height === 0) {
    return
  }

  const width = Math.min(STILL_WIDTH, source.width)
  const height = Math.round((source.height * width) / source.width)

  still.value = encode({ width, height }, (g) => g.drawImage(source, 0, 0, width, height))
}

/** With no frame kept (a page opened straight into Info only), the bare floor plan once. */
export function keepFloorPlanUnlessKept(): void {
  if (still.peek() !== undefined) {
    return
  }

  const floor = view.peek().floor

  still.value = encode({ width: WORLD.w, height: WORLD.h }, (g) =>
    paintBuilding(g, floor, () => undefined)
  )
}

export function dropStill(): void {
  still.value = undefined
}

// Paints on a canvas made for it, encodes it and frees its pixels.
function encode(
  size: { readonly width: number; readonly height: number },
  paint: (g: CanvasRenderingContext2D) => void
): string | undefined {
  const canvas = document.createElement('canvas')
  const g = canvas.getContext('2d')

  canvas.width = size.width
  canvas.height = size.height

  try {
    if (g === null) {
      return undefined
    }

    paint(g)

    return canvas.toDataURL(STILL_TYPE, STILL_QUALITY)
  } finally {
    zeroCanvas(canvas)
  }
}
