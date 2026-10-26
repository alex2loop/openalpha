/** The key that closes whatever has the page's focus: a modal, a popover, a menu, a follow. */
export const ESCAPE_KEY = 'Escape'
const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/** The focusable elements inside every element the selector list `within` names, in document
 *  order. */
export function listFocusable(within: string): HTMLElement[] {
  return [...document.querySelectorAll(within)].flatMap((container) =>
    [...container.querySelectorAll(FOCUSABLE)].filter(
      (element): element is HTMLElement => element instanceof HTMLElement
    )
  )
}

/** Tab cycles inside what `within` names (a selector list: several containers make one ring); from
 *  outside or from a container itself it enters at the near end. */
export function trapFocus(event: KeyboardEvent, within: string): void {
  const focusable = listFocusable(within)
  const first = focusable[0]
  const last = focusable.at(-1)
  const active = document.activeElement

  if (first === undefined || last === undefined) {
    event.preventDefault()
    return
  }

  const isInside = focusable.some((element) => element === active)
  const edge = event.shiftKey ? first : last

  if (isInside && active !== edge) {
    return
  }

  event.preventDefault()

  if (event.shiftKey) {
    last.focus()
  } else {
    first.focus()
  }
}
