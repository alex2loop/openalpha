import type { SuggestionWire } from '@/app/server/wire/trading'
import { FORCE_ARG, isRunningCommand, runCommand, SUGGEST_COMMAND } from '@/web/state/command'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'

interface AnalyzeButtonProps {
  /** The name as `/suggest` takes it: a ticker, or `market:ticker`. */
  readonly name: string
  /** A stored call stands: a plain `/suggest` would hand it back, so the button forces a fresh one. */
  readonly isAnalyzed: boolean
  readonly size?: 'small'
}

/** One button for `/suggest`: "Phân tích mã này", or "Phân tích lại từ đầu" once a call is stored. */
export function AnalyzeButton({ name, isAnalyzed, size }: AnalyzeButtonProps) {
  const command = isAnalyzed
    ? `${SUGGEST_COMMAND} ${name} ${FORCE_ARG}`
    : `${SUGGEST_COMMAND} ${name}`

  return (
    <Button
      kind="ai"
      {...(size === undefined ? {} : { size })}
      disabled={isRunningCommand(command)}
      onClick={() => runCommand(command)}
    >
      {tr(isAnalyzed ? 'ui.office.common.suggestFresh' : 'ui.office.ticker.suggestCta')}
    </Button>
  )
}

/** A call a plain `/suggest` may hand back. A failed run and the plan written for a held name at
 *  its fill are not answers: `/suggest` runs past them on its own. */
export function isStoredAnswer(call: SuggestionWire): boolean {
  return call.action !== 'hold' || (call.undecided !== true && call.recorded !== true)
}
