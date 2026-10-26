import type { ComponentChildren, RefObject } from 'preact'
import { type ReadonlySignal, signal } from '@preact/signals'
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks'

import { ESCAPE_KEY } from '@/web/ui/kit/focus-trap'

import './popover.css'

interface PopoverProps {
  readonly id: string
  /** The button that toggles it: a click on it is not an outside click, and Esc returns focus to it. */
  readonly anchor: RefObject<HTMLElement | null>
  readonly label: string
  readonly class?: string
  /** Focus moves into it as it opens, so its keys work whatever opened it. */
  readonly takesFocus?: true
  readonly children: ComponentChildren
}

interface OpenPanel {
  readonly panel: RefObject<HTMLElement | null>
  readonly anchor: RefObject<HTMLElement | null>
}

/** The bell's popover, which the office also opens: from an approval's marker or bubble. */
export const BELL_POPOVER_ID = 'bell'
/** The running jobs' popover, which a notice row and the J key also open. */
export const JOBS_POPOVER_ID = 'jobs'

const openId = signal<string | undefined>(undefined)
// The mounted panel and its anchor, so a dialog opened from inside it can return focus there.
let openPanel: OpenPanel | undefined

/** Which popover is open; one at a time. */
export const openPopoverId: ReadonlySignal<string | undefined> = openId

/** Opens the popover, or closes it when it is the one open; any other one closes. */
export function togglePopover(id: string): void {
  openId.value = openId.value === id ? undefined : id
}

/** Opens the popover and keeps it open when it already is; any other one closes. */
export function openPopover(id: string): void {
  openId.value = id
}

export function closePopover(): void {
  openId.value = undefined
}

/** Where focus goes back to once whatever `active` opened is done: the open popover's anchor when
 *  `active` sits inside that popover (or focus rests nowhere), else `active` itself. */
export function resolveFocusReturn(active: Element | null): HTMLElement | undefined {
  const isFromPanel =
    active === null || active === document.body || isInside(openPanel?.panel, active)

  if (openPanel !== undefined && isFromPanel) {
    return openPanel.anchor.current ?? undefined
  }

  return active instanceof HTMLElement ? active : undefined
}

/** Its children mount only while it is open, so whatever they load is released when it closes. */
export function Popover({
  id,
  anchor,
  label,
  class: className,
  takesFocus,
  children,
}: PopoverProps) {
  if (openId.value !== id) {
    return null
  }

  return (
    <PopoverPanel anchor={anchor} label={label} className={className} takesFocus={takesFocus}>
      {children}
    </PopoverPanel>
  )
}

interface PopoverPanelProps {
  readonly anchor: RefObject<HTMLElement | null>
  readonly label: string
  readonly className: string | undefined
  readonly takesFocus: true | undefined
  readonly children: ComponentChildren
}

function PopoverPanel({ anchor, label, className, takesFocus, children }: PopoverPanelProps) {
  const panel = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => armPopover(panel, anchor), [anchor])
  useEffect(() => {
    if (takesFocus === true) {
      panel.current?.focus()
    }
  }, [takesFocus])

  return (
    <div
      ref={panel}
      class={className === undefined ? 'popover' : `popover ${className}`}
      role="dialog"
      aria-label={label}
      tabIndex={takesFocus === true ? -1 : undefined}
    >
      {children}
    </div>
  )
}

// Esc returns focus to the anchor; the panel is the open one for exactly as long as it is mounted.
function armPopover(
  panel: RefObject<HTMLElement | null>,
  anchor: RefObject<HTMLElement | null>
): () => void {
  const entry: OpenPanel = { panel, anchor }
  const disarm = armDismiss({
    panel,
    anchor,
    onDismiss: (cause) => {
      closePopover()

      if (cause === 'escape') {
        anchor.current?.focus()
      }
    },
  })

  openPanel = entry

  return () => {
    disarm()

    if (openPanel === entry) {
      openPanel = undefined
    }
  }
}

/** What ended it: Esc, or a press outside the panel and its anchor. */
type DismissCause = 'escape' | 'outside'

interface DismissTarget {
  readonly panel: RefObject<HTMLElement | null>
  /** The button that opened it: a press on it is not an outside press. */
  readonly anchor?: RefObject<HTMLElement | null>
  readonly onDismiss: (cause: DismissCause) => void
}

/** Calls `onDismiss` on Esc or a press outside `panel`; the returned stop removes both listeners.
 *  A panel that floats over the page arms it for exactly as long as it is shown. */
export function armDismiss({ panel, anchor, onDismiss }: DismissTarget): () => void {
  const listeners = new AbortController()
  const { signal: listenerSignal } = listeners

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === ESCAPE_KEY) {
        onDismiss('escape')
      }
    },
    { signal: listenerSignal }
  )
  document.addEventListener(
    'pointerdown',
    (event) => {
      const target = event.target

      if (target instanceof Node && !isInside(panel, target) && !isInside(anchor, target)) {
        onDismiss('outside')
      }
    },
    { signal: listenerSignal }
  )

  return () => listeners.abort()
}

function isInside(ref: RefObject<HTMLElement | null> | undefined, target: Node): boolean {
  return ref?.current?.contains(target) === true
}
