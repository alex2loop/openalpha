import { effect } from '@preact/signals'

import type { createSimLoop } from '@/web/scene/sim/loop'
import { showHome } from '@/web/scene/view'
import { fittedFloorScale } from '@/web/scene/world/framing'
import { breakpoint } from '@/web/state/breakpoints'
import { collapsed, isFloating, PANEL_ELEMENT_ID } from '@/web/state/panel'

/** A resize or a move to a screen of another density draws again, and the home view follows the
 *  pane and, on the frame after it folds, unfolds or starts or stops floating, the panel; the
 *  returned stop releases all of it. A pane hidden by `display: none` measures zero: the loop rests
 *  until it has a size again. */
export function watchPane(
  element: HTMLElement,
  loop: Pick<ReturnType<typeof createSimLoop>, 'wake' | 'show'>
): () => void {
  const resize = new ResizeObserver(() => {
    loop.show(element.clientWidth > 0 && element.clientHeight > 0)
    placeHome(element)
    loop.wake()
  })
  const listeners = new AbortController()
  let frame = 0
  const off = effect(() => {
    collapsed.value
    isFloating.value
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => placeHome(element))
  })

  placeHome(element)
  resize.observe(element)
  watchResolution(loop.wake, listeners.signal)

  return () => {
    off()
    cancelAnimationFrame(frame)
    resize.disconnect()
    listeners.abort()
  }
}

// While the camera holds the home view, it keeps the floor centred left of the floating panel.
function placeHome(element: HTMLElement): void {
  const pane = { w: element.clientWidth, h: element.clientHeight }

  if (pane.w > 0 && pane.h > 0) {
    showHome(pane, fittedFloorScale(pane, breakpoint.peek()), panelCoverOf(element))
  }
}

// The CSS px the floating panel covers at the pane's right edge.
function panelCoverOf(element: HTMLElement): number {
  const panel = document.getElementById(PANEL_ELEMENT_ID)?.getBoundingClientRect()

  if (panel === undefined || panel.width === 0 || !isFloating.peek()) {
    return 0
  }

  return Math.max(0, element.getBoundingClientRect().right - panel.left)
}

// A move to a screen of another pixel density redraws at the new density; the query is re-armed for
// the density it lands on.
function watchResolution(onChange: () => void, signal: AbortSignal): void {
  if (signal.aborted) {
    return
  }

  const query = matchMedia(`(resolution: ${devicePixelRatio}dppx)`)

  query.addEventListener(
    'change',
    () => {
      onChange()
      watchResolution(onChange, signal)
    },
    { signal, once: true }
  )
}
