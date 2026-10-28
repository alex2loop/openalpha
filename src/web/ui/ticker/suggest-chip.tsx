import { runCommand, SUGGEST_COMMAND } from '@/web/state/command'
import { estimateText } from '@/web/state/estimates'
import { joinInline } from '@/web/text/glyphs'
import { Button } from '@/web/ui/kit/button'

interface SuggestChipProps {
  readonly ticker: string
  /** Runs just before the command is sent. */
  readonly onRun?: () => void
}

/** "/suggest TICKER" with what it usually costs, shown before the click that sends it. */
export function SuggestChip({ ticker, onRun }: SuggestChipProps) {
  const suggest = `${SUGGEST_COMMAND} ${ticker}`
  const estimate = estimateText(SUGGEST_COMMAND)

  return (
    <Button
      size="small"
      onClick={() => {
        onRun?.()
        runCommand(suggest)
      }}
    >
      {estimate === undefined ? suggest : joinInline([suggest, estimate])}
    </Button>
  )
}
