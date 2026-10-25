import { tr } from '@/web/text/tr'
import { DataHealth } from '@/web/ui/settings/data-health'
import { Outbound } from '@/web/ui/settings/outbound'

/** Dữ liệu và kết nối: how healthy the daemon and its sources are, and every host it can call.
 *  Keys, tokens, exchanges and fees are not set on this page. */
export function DataSection() {
  return (
    <>
      <p class="meta">{tr('ui.office.settings.neverWeb')}</p>
      <DataHealth />
      <Outbound />
    </>
  )
}
