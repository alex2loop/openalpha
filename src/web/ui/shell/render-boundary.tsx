import type { ComponentChildren } from 'preact'
import { useErrorBoundary } from 'preact/hooks'

import { recordLogEntry } from '@/web/edition/error-log'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { StatusLine } from '@/web/ui/shell/status-line'

const RENDER_FAILED_KEY = 'web.render_failed'

/** Keeps a render error from leaving a blank page: the page says it hit a problem and offers a
 *  reload, and the error goes to the tab's error log. */
export function RenderBoundary({ children }: { readonly children: ComponentChildren }) {
  const [error] = useErrorBoundary(recordRenderFailure)

  if (error === undefined) {
    return <>{children}</>
  }

  return (
    <StatusLine text={tr('ui.office.error.renderFailed')}>
      <Button kind="commit" onClick={() => location.reload()}>
        {tr('ui.office.offline.reload')}
      </Button>
    </StatusLine>
  )
}

function recordRenderFailure(error: unknown): void {
  recordLogEntry({
    time: Date.now(),
    level: 'error',
    key: RENDER_FAILED_KEY,
    fields: error instanceof Error ? { type: error.name, message: error.message } : {},
  })
}
