import { runCommand, SUGGEST_COMMAND } from '@/web/state/command'
import { Button } from '@/web/ui/kit/button'

interface SuggestChipProps {
  readonly ticker: string
  /** Runs just before the command is sent. */
  readonly onRun?: () => void
}

/** "/suggest TICKER", sent on click. */
export function SuggestChip({ ticker, onRun }: SuggestChipProps) {
  const suggest = `${SUGGEST_COMMAND} ${ticker}`

  return (
    <Button
      size="small"
      onClick={() => {
        onRun?.()
        runCommand(suggest)
      }}
    >
      {suggest}
    </Button>
  )
}
