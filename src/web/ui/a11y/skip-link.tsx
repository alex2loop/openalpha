import type { TargetedMouseEvent } from 'preact'

import { PANEL_ELEMENT_ID } from '@/web/state/panel'
import { tr } from '@/web/text/tr'

import './a11y.css'

/** Leads the page: past the office, its controls and its text list, straight to the info panel. */
export function SkipLink() {
  return (
    <a class="skip-link" href={`#${PANEL_ELEMENT_ID}`} onClick={skip}>
      {tr('ui.office.a11y.skip')}
    </a>
  )
}

// Focus moves without the address changing, so the hash never fights the token's own use of it.
function skip(event: TargetedMouseEvent<HTMLAnchorElement>): void {
  event.preventDefault()
  document.getElementById(PANEL_ELEMENT_ID)?.focus()
}
