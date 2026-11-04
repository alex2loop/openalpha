import { useSignal } from '@preact/signals'

import { isAnalysisOnly } from '@/web/state/edition'
import { qualifyName } from '@/web/state/watch'
import { tr } from '@/web/text/tr'
import { openAlertDialog } from '@/web/ui/dialogs/alert-dialog'
import { openTradeDialog } from '@/web/ui/dialogs/trade-dialog'
import { Button } from '@/web/ui/kit/button'
import { AnalyzeButton } from '@/web/ui/ticker/analyze-button'
import { WatchButton } from '@/web/ui/ticker/watch-button'

interface CardActionsProps {
  readonly ticker: string
  readonly market: string
  /** A stored call stands: a plain `/suggest` would hand it back, so the analysis runs fresh. */
  readonly isAnalyzed: boolean
}

/** What the operator can do with this name. The analysis runs at once, fresh where a call is
 *  stored; "Theo dõi" is free and changes the list at once; the alert and the trade open their
 *  forms. */
export function CardActions({ ticker, market, isAnalyzed }: CardActionsProps) {
  const failure = useSignal<string | undefined>(undefined)
  return (
    <div class="card-actions">
      <AnalyzeButton name={qualifyName({ market, ticker })} isAnalyzed={isAnalyzed} />
      <WatchButton ticker={ticker} market={market} failure={failure} />
      <FormButtons ticker={ticker} market={market} />
      {failure.value !== undefined && <p class="failure-line">{failure.value}</p>}
    </div>
  )
}

function FormButtons({ ticker, market }: Pick<CardActionsProps, 'ticker' | 'market'>) {
  return (
    <>
      {!isAnalysisOnly.value && (
        <Button onClick={() => openAlertDialog({ ticker, market })}>
          {tr('ui.office.ticker.alertCta')}
        </Button>
      )}
      <Button onClick={() => openTradeDialog({ ticker, market })}>
        {tr('ui.office.common.recordTrade')}
      </Button>
    </>
  )
}
