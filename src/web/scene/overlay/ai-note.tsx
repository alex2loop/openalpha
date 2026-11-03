import { tr } from '@/web/text/tr'

import './ai-note.css'

/** The scene's own persistent line: what the agents say at their desks and post on social networks
 *  is machine-written, whichever card or bubble it shows in. */
export function AiNote() {
  return (
    <p class="ai-note glass" role="note">
      {tr('ui.office.scene.aiNote')}
    </p>
  )
}
