import type { ComponentChildren, RefObject } from 'preact'

import './chip.css'

interface ChipProps {
  readonly isCaution?: boolean
  readonly title?: string
  /** Set on a chip that opens a popover: it becomes a button and the popover's anchor. */
  readonly onClick?: () => void
  readonly anchorRef?: RefObject<HTMLButtonElement>
  readonly isExpanded?: boolean
  readonly children: ComponentChildren
}

/** A rounded header pill: a status line, or a button that opens its popover. */
export function Chip({ isCaution, title, onClick, anchorRef, isExpanded, children }: ChipProps) {
  const className = isCaution === true ? 'chip is-caution' : 'chip'

  if (onClick === undefined) {
    return (
      <span class={className} title={title}>
        {children}
      </span>
    )
  }

  return (
    <button
      ref={anchorRef ?? null}
      type="button"
      class={className}
      title={title}
      aria-haspopup="dialog"
      aria-expanded={isExpanded}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
