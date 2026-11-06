import { SUGGEST_COMMAND } from '@/web/state/command'
import { isLevelInstrument } from '@/web/state/market'
import { RunButton } from '@/web/ui/command/run-button'

interface SuggestChipProps {
  readonly ticker: string
  /** Runs just before the command is sent. */
  readonly onRun?: () => void
}

/** "/suggest TICKER", sent on click. A level (an index, a futures contract) is refused, so it gets
 *  none; a name no quote has described keeps it. */
export function SuggestChip({ ticker, onRun }: SuggestChipProps) {
  if (isLevelInstrument({ ticker })) {
    return null
  }

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
