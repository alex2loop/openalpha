import type { AskedQuestion } from '@/web/ui/dialogs/price-confirm'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'

interface PriceQuestionProps {
  readonly question: AskedQuestion
  readonly isBusy: boolean
  readonly onConfirm: () => void
  readonly onEdit: () => void
}

/** A price far from the market, or a name no stored list has, asked back before it is saved. */
export function PriceQuestion({ question, isBusy, onConfirm, onEdit }: PriceQuestionProps) {
  const { isName } = question

  return (
    <div class="dialog-question" role="alert">
      <p>{question.text}</p>
      <div class="dialog-choices">
        <Button size="small" kind="commit" disabled={isBusy} onClick={onConfirm}>
          {tr(isName ? 'trading.render.affordance.recordAsTyped' : 'ui.office.common.priceConfirm')}
        </Button>
        <Button size="small" disabled={isBusy} onClick={onEdit}>
          {tr(isName ? 'ui.office.common.nameEdit' : 'ui.office.common.priceEdit')}
        </Button>
      </div>
    </div>
  )
}
