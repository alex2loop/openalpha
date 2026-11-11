import type { MessageKey } from '@/i18n'
import { staleSince } from '@/web/state/live'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'

interface StopButtonProps {
  readonly onClick: () => void
  readonly label?: MessageKey
}

/** "Dừng", which asks first. While the picture is stale the stop cannot reach the daemon, so the
 *  button is off and says why. */
export function StopButton({ onClick, label = 'ui.office.common.stop' }: StopButtonProps) {
  const isStale = staleSince.value !== undefined

  return (
    <Button
      kind="destructive"
      size="small"
      disabled={isStale}
      {...(isStale ? { title: tr('ui.office.stale.stop') } : {})}
      onClick={onClick}
    >
      {tr(label)}
    </Button>
  )
}
