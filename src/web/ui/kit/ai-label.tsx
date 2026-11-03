import type { SuggestionWire } from '@/app/server/wire/trading'
import { renderAiLabel } from '@/i18n'
import { locale } from '@/web/state/session'
import { modelDisplayName } from '@/web/text/model-name'

import './ai-label.css'

/** The line every AI-written view opens with: what wrote it, that it can be wrong, and that it is
 *  not advice. Models show by their display names, never their ids; naming none reads the unnamed
 *  variant. */
export function AiLabel({ models = [] }: { readonly models?: readonly string[] }) {
  return (
    <p class="ai-label" role="note">
      {renderAiLabel(locale.value, models.map(modelDisplayName))}
    </p>
  )
}

/** A stored call carries model-written text when a thesis or a debate stands behind it; a level
 *  the daemon wrote for a held name at its fill has neither, and takes no label. */
export function CallAiLabel({ call }: { readonly call: SuggestionWire }) {
  const models = call.models ?? []

  return call.thesis === undefined && models.length === 0 ? null : <AiLabel models={models} />
}
