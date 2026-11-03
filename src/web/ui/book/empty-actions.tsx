import type { MessageKey } from '@/i18n'
import { editionKey, isAnalysisOnly } from '@/web/state/edition'
import { tr } from '@/web/text/tr'
import { openTradeDialog } from '@/web/ui/dialogs/trade-dialog'
import { Button } from '@/web/ui/kit/button'
import { openSettings } from '@/web/ui/settings/settings'

/** The line over an empty book: the web edition reads no balance from an exchange. */
export function emptyBookKey(): MessageKey {
  return editionKey('ui.office.book.empty', 'ui.office.edition.book.empty')
}

/** What an empty book offers: write the first trade by hand, or see how an exchange connects (the
 *  web edition has no exchange to connect). */
export function EmptyBookActions() {
  return (
    <div class="step-actions">
      <Button size="small" onClick={() => openTradeDialog()}>
        {tr('ui.office.common.recordTrade')}
      </Button>
      {!isAnalysisOnly.value && (
        <Button size="small" onClick={() => openSettings('exchanges')}>
          {tr('ui.office.book.connectVenue')}
        </Button>
      )}
    </div>
  )
}
