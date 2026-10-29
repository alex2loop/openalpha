import { SUGGEST_COMMAND } from '@/web/state/command'
import { RunButton } from '@/web/ui/command/run-button'

interface SuggestChipProps {
  readonly ticker: string
  /** Runs just before the command is sent. */
  readonly onRun?: () => void
}

/** "/suggest TICKER", sent on click. */
export function SuggestChip({ ticker, onRun }: SuggestChipProps) {
  const suggest = `${SUGGEST_COMMAND} ${ticker}`

  return (
    <RunButton
      command={suggest}
      label={suggest}
      size="small"
      {...(onRun === undefined ? {} : { onRun })}
    />
  )
}
