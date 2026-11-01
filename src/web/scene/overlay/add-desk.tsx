import { overlayView } from '@/web/scene/overlay/overlay'
import { requestAgentForm } from '@/web/state/agents'
import { tr } from '@/web/text/tr'

import './empty-team.css'

/** "+ Thêm agent" on the team floor's next free desk: it opens the agent form, nothing more. */
export function AddDesk() {
  const rect = overlayView.value.addDesk

  if (rect === undefined) {
    return null
  }

  return (
    <button
      type="button"
      class="add-desk"
      style={{
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.w}px`,
        height: `${rect.h}px`,
      }}
      onClick={() => requestAgentForm()}
    >
      {tr('ui.office.team.add')}
    </button>
  )
}
