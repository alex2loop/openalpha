import type { MessageKey } from '@/i18n'
import { staleSince } from '@/web/state/live'
import { formatStaleLine } from '@/web/text/stale'

import './stale-line.css'

/** One line under what the page can no longer vouch for, while the picture is stale: `lead` (by
 *  default "Chưa rõ") and when it was last known. Nothing while the picture is current. */
export function StaleLine({ lead = 'ui.office.stale.unknown' }: { readonly lead?: MessageKey }) {
  const since = staleSince.value

  if (since === undefined) {
    return null
  }

  return (
    <p class="meta stale-line" role="status">
      {formatStaleLine(since, lead)}
    </p>
  )
}
