import type { SceneRenderer } from '@/web/scene/renderer'
import type { Rect, RoomId, SimView, Size } from '@/web/scene/types'
import { roomsOn } from '@/web/scene/world/rooms'

// A speaker this far past the pane's edge, in CSS px, counts as off screen.
const OFF_SCREEN_PX = 16
// The boards, room tags and toolbar pieces other overlays draw, and the page's floating panel and
// command bar over the scene; no bubble covers them.
const FIXED_SELECTOR =
  '.room-tag-row, .board-line, .scene-zoombtn, .scene-hint, .panel.is-float, .command-bar.is-floating'

/** A box another overlay or the page's floating chrome drew, with its element. */
export interface FixedBox {
  readonly element: Element
  readonly rect: Rect
}

/** Each room on the shown floor, in CSS px of the scene host. */
export function roomRects(sim: SimView, renderer: SceneRenderer): ReadonlyMap<RoomId, Rect> {
  return new Map(roomsOn(sim.floor).map((room) => [room.id, toScreenRect(renderer, room.rect)]))
}

/** A world rect in CSS px of the scene host, as the renderer last placed it. */
export function toScreenRect(renderer: SceneRenderer, rect: Rect): Rect {
  const from = renderer.toScreen({ x: rect.x, y: rect.y })
  const to = renderer.toScreen({ x: rect.x + rect.w, y: rect.y + rect.h })

  return { x: from.x, y: from.y, w: to.x - from.x, h: to.y - from.y }
}

/** Whether a figure stands within `OFF_SCREEN_PX` of the pane. */
export function isOnScreen(rect: Rect, pane: Size): boolean {
  const x = rect.x + rect.w / 2

  return (
    x >= -OFF_SCREEN_PX &&
    x <= pane.w + OFF_SCREEN_PX &&
    rect.y + rect.h >= -OFF_SCREEN_PX &&
    rect.y <= pane.h + OFF_SCREEN_PX
  )
}

/** The boxes other overlays and the page's floating chrome drew, relative to `scene`; read only
 *  when a layout runs, never per frame. */
export function readFixed(scene: HTMLElement): FixedBox[] {
  const origin = scene.getBoundingClientRect()

  return [...scene.ownerDocument.querySelectorAll(FIXED_SELECTOR)].map((element) => {
    const box = element.getBoundingClientRect()

    return {
      element,
      rect: { x: box.left - origin.left, y: box.top - origin.top, w: box.width, h: box.height },
    }
  })
}
