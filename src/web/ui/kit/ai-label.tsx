import type { SuggestionWire } from '@/app/server/wire/trading'
import { renderAiLabel } from '@/i18n'
import { locale } from '@/web/state/session'

import './ai-label.css'

/** The line every AI-written view opens with: that an AI wrote it and that it is not advice. */
export function AiLabel() {
  return (
    <p class="ai-label" role="note">
      {renderAiLabel(locale.value)}
    </p>
  )
}

/** A stored call carries model-written text when a thesis or a debate stands behind it; a level
 *  the daemon wrote for a held name at its fill has neither, and takes no label. */
export function CallAiLabel({ call }: { readonly call: SuggestionWire }) {
  return call.thesis === undefined && (call.models ?? []).length === 0 ? null : <AiLabel />
}
