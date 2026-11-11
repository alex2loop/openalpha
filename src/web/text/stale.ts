import type { MessageKey } from '@/i18n'
import { state } from '@/web/state/session'
import { joinInline } from '@/web/text/glyphs'
import { formatClock } from '@/web/text/time'
import { tr } from '@/web/text/tr'

/** `lead`, then when the picture was last known, in the operator's zone; the lead alone until the
 *  session says the zone. */
export function formatStaleLine(since: number, lead: MessageKey): string {
  const timeZone = state.value?.timeZone

  if (timeZone === undefined) {
    return tr(lead)
  }

  return joinInline([
    tr(lead),
    tr('ui.office.stale.updatedAt', { time: formatClock(since, timeZone) }),
  ])
}
