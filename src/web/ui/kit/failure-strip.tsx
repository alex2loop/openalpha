import type { ApiFailure } from '@/web/api/client'
import { toFailureText, tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'

/** A read that failed: the daemon's sentence and Thử lại. Data already on screen stays. */
export function FailureStrip({
  failure,
  retry,
}: {
  readonly failure: ApiFailure
  readonly retry: () => void
}) {
  return (
    <div class="strip is-problem" role="alert">
      <span>{toFailureText(failure)}</span>
      <Button size="small" onClick={retry}>
        {tr('ui.office.common.retry')}
      </Button>
    </div>
  )
}
