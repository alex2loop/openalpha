import { fillInput, SUGGEST_COMMAND } from '@/web/state/command'
import { estimateText } from '@/web/state/estimates'
import { joinInline } from '@/web/text/glyphs'
import { Button } from '@/web/ui/kit/button'

interface SuggestChipProps {
  readonly ticker: string
  /** Runs just before the box is filled. */
  readonly onFill?: () => void
}

/** "/suggest TICKER" with what it usually costs. It only fills the box: the operator sends it. */
export function SuggestChip({ ticker, onFill }: SuggestChipProps) {
  const suggest = `${SUGGEST_COMMAND} ${ticker}`
  const estimate = estimateText(SUGGEST_COMMAND)

  return (
    <Button
      size="small"
      onClick={() => {
        onFill?.()
        fillInput(suggest)
      }}
    >
      {estimate === undefined ? suggest : joinInline([suggest, estimate])}
    </Button>
  )
}
