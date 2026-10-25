import type { ComponentChildren } from 'preact'

import { NEXT_GLYPH } from '@/web/text/glyphs'

import './button.css'

/** commit: Ink fill, one per dialog. ai: brand gradient, always with its cost beside it.
 *  destructive: Problem text, confirmed first when it loses work. */
type ButtonKind = 'commit' | 'ai' | 'secondary' | 'tertiary' | 'destructive'
/** Buttons side by side share one size. */
type ButtonSize = 'regular' | 'small'

interface ButtonProps {
  readonly kind?: ButtonKind
  readonly size?: ButtonSize
  readonly type?: 'button' | 'submit'
  readonly disabled?: boolean
  readonly onClick?: (() => void) | undefined
  readonly children: ComponentChildren
}

export function Button({
  kind = 'secondary',
  size = 'regular',
  type = 'button',
  disabled,
  onClick,
  children,
}: ButtonProps) {
  return (
    <button type={type} class={`btn btn-${kind} btn-${size}`} disabled={disabled} onClick={onClick}>
      {children}
      {kind === 'tertiary' && <span aria-hidden="true">{NEXT_GLYPH}</span>}
    </button>
  )
}
