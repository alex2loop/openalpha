import { tr } from '@/web/text/tr'
import { openTradeDialog } from '@/web/ui/dialogs/trade-dialog'
import { Button } from '@/web/ui/kit/button'
import { openSettings } from '@/web/ui/settings/settings'

/** What an empty book offers: write the first trade by hand, or see how an exchange connects. */
export function EmptyBookActions() {
  return (
    <div class="step-actions">
      <Button size="small" onClick={() => openTradeDialog()}>
        {tr('ui.office.common.recordTrade')}
      </Button>
      <Button size="small" onClick={() => openSettings('data')}>
        {tr('ui.office.book.connectVenue')}
      </Button>
    </div>
  )
}
