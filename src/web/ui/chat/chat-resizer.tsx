import { signal } from '@preact/signals'

import { readStorage, removeStorage, writeStorage } from '@/web/state/storage'
import { tr } from '@/web/text/tr'

const WIDTH_KEY = 'office.chat.width'
/** The narrowest the docked chat goes: the token's own floor. */
const MIN_WIDTH_PX = 340
/** The widest, as a share of the window, so the office keeps the rest. */
const MAX_WIDTH_SHARE = 0.6
const KEY_STEP_PX = 24
/** Left widens the chat, which grows leftwards; right narrows it. */
const KEY_STEPS: ReadonlyMap<string, number> = new Map([
  ['ArrowLeft', KEY_STEP_PX],
  ['ArrowRight', -KEY_STEP_PX],
])
const storedWidth = Number(readStorage('local', WIDTH_KEY))

/** The width this viewer dragged the docked chat to; absent keeps the layout's own width. */
const chatWidth = signal<number | undefined>(
  Number.isFinite(storedWidth) && storedWidth >= MIN_WIDTH_PX ? storedWidth : undefined
)

/** The chat's left edge on a wide screen: drag or arrow keys to widen it, a double click to reset. */
export function ChatResizer() {
  const width = chatWidth.value

  return (
    // biome-ignore lint/a11y/useSemanticElements: a draggable splitter has no native element; the separator role is the ARIA pattern for it.
    <div
      class="chat-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={tr('ui.office.chat.resize')}
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH_PX}
      title={tr('ui.office.chat.resize')}
      tabIndex={0}
      onPointerDown={startDrag}
      onKeyDown={nudge}
      onDblClick={resetWidth}
    />
  )
}

/** The inline style that applies the dragged width, or none. Capped by the window's share, so a width
 *  dragged on a larger window never crowds out the office on a smaller one. */
export function chatWidthStyle(): string | undefined {
  return chatWidth.value === undefined
    ? undefined
    : `--chatPanelW: min(${chatWidth.value}px, ${MAX_WIDTH_SHARE * 100}vw)`
}

// The panel's right edge stays put, so the width is that edge less the pointer. Moves end on release
// or cancel, and the width is kept once, at the end.
function startDrag(event: PointerEvent): void {
  const handle = event.currentTarget
  const panel = handle instanceof HTMLElement ? handle.parentElement : null

  if (!(handle instanceof HTMLElement) || panel === null || event.button !== 0) {
    return
  }

  const right = panel.getBoundingClientRect().right
  const drag = new AbortController()
  const end = (): void => {
    drag.abort()
    keepWidth()
  }

  event.preventDefault()
  handle.setPointerCapture(event.pointerId)
  handle.addEventListener('pointermove', (move) => setWidth(right - move.clientX), {
    signal: drag.signal,
  })
  handle.addEventListener('pointerup', end, { signal: drag.signal })
  handle.addEventListener('pointercancel', end, { signal: drag.signal })
}

function nudge(event: KeyboardEvent): void {
  const step = KEY_STEPS.get(event.key)
  const panel =
    event.currentTarget instanceof HTMLElement ? event.currentTarget.parentElement : null

  if (step === undefined || panel === null) {
    return
  }

  event.preventDefault()
  setWidth(panel.getBoundingClientRect().width + step)
  keepWidth()
}

function setWidth(px: number): void {
  const max = Math.max(MIN_WIDTH_PX, window.innerWidth * MAX_WIDTH_SHARE)

  chatWidth.value = Math.round(Math.min(Math.max(px, MIN_WIDTH_PX), max))
}

function keepWidth(): void {
  if (chatWidth.value !== undefined) {
    writeStorage('local', WIDTH_KEY, String(chatWidth.value))
  }
}

function resetWidth(): void {
  chatWidth.value = undefined
  removeStorage('local', WIDTH_KEY)
}
