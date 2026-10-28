import type { Placed } from '@/web/scene/overlay/placement'
import type { FixedBox } from '@/web/scene/overlay/screen-rects'
import type { ActorId, Rect } from '@/web/scene/types'
import { isTaken } from '@/web/scene/overlay/placement'

// The labels an open radial menu may hide: room badges and board notes, never the page's chrome.
const LABEL_SELECTOR = '.room-tag-row, .board-line'
// radial-menu.css hides an element carrying it.
const UNDER_MENU_ATTR = 'data-under-menu'

/** What the open menu keeps clear: its pills and its person's reply; empty with no menu open. */
export function menuClearOf(
  pills: readonly Rect[],
  at: { readonly actor: ActorId | undefined; readonly placed: readonly Placed[] }
): Rect[] {
  const reply = at.placed.filter((placed) => placed.bubble.actor === at.actor)

  return pills.length === 0 ? [] : [...pills, ...reply.map((placed) => placed.rect)]
}

/** Hides each label that meets what the menu keeps clear and shows every other again. */
export function syncMenuLabels(boxes: readonly FixedBox[], clear: readonly Rect[]): void {
  for (const box of boxes) {
    if (box.element.matches(LABEL_SELECTOR)) {
      box.element.toggleAttribute(UNDER_MENU_ATTR, isTaken(box.rect, clear))
    }
  }
}

/** Shows every label the menu hid, once the overlay goes. */
export function showMenuLabels(root: ParentNode): void {
  for (const element of root.querySelectorAll(`[${UNDER_MENU_ATTR}]`)) {
    element.removeAttribute(UNDER_MENU_ATTR)
  }
}
