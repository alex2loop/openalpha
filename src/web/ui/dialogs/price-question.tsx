import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'

interface PriceQuestionProps {
  /** The daemon's own question, in its language. */
  readonly question: string
  readonly isBusy: boolean
  readonly onConfirm: () => void
  readonly onEdit: () => void
}

/** A price far from the market, asked back before it is saved. */
export function PriceQuestion({ question, isBusy, onConfirm, onEdit }: PriceQuestionProps) {
  return (
    <div class="dialog-question" role="alert">
      <p>{question}</p>
      <div class="dialog-choices">
        <Button size="small" kind="commit" disabled={isBusy} onClick={onConfirm}>
          {tr('ui.office.common.priceConfirm')}
        </Button>
        <Button size="small" disabled={isBusy} onClick={onEdit}>
          {tr('ui.office.common.priceEdit')}
        </Button>
      </div>
    </div>
  )
}
