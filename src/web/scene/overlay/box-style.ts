import type { Rect } from '@/web/scene/types'

/** An overlay piece's place: `rect` in CSS px of the scene host. */
export function boxStyle(rect: Rect): Record<string, string> {
  return {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.w}px`,
    height: `${rect.h}px`,
  }
}
