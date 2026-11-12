import { staleSince } from '@/web/state/live'
import { formatStaleLine } from '@/web/text/stale'

import './stale-veil.css'

/** While the picture is stale, a note over the held scene saying nobody can tell what is going on
 *  now, and when the page last knew. */
export function StaleVeil() {
  const since = staleSince.value

  return since === undefined ? null : (
    <p class="stale-veil glass is-strong" role="status">
      {formatStaleLine(since, 'ui.office.stale.scene')}
    </p>
  )
}
