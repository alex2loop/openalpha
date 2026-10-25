import { useNow } from '@/web/state/clock'
import { retryFeedNow } from '@/web/state/feed'
import { connection } from '@/web/state/session'
import { joinInline } from '@/web/text/glyphs'
import { formatCountdown } from '@/web/text/time'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'

import './offline-bar.css'

const COUNTDOWN_TICK_MS = 1_000

/** The dark bar above the command bar while the feed is down, or the reload line once the page is
 *  older than the daemon. */
export function OfflineBar() {
  const { status, retryAt } = connection.value

  if (status === 'outdated') {
    return <OutdatedLine />
  }

  if (status !== 'offline' || retryAt === undefined) {
    return null
  }

  return <OfflineLine retryAt={retryAt} />
}

function OfflineLine({ retryAt }: { readonly retryAt: number }) {
  const now = useNow(COUNTDOWN_TICK_MS)
  const detail = joinInline([
    tr('ui.office.offline.retry', { seconds: formatCountdown(retryAt, now.value) }),
    tr('ui.office.offline.running'),
  ])

  return (
    <div class="offline-bar" role="status">
      <strong>{tr('ui.office.offline.title')}</strong>
      <span class="offline-bar-detail">{detail}</span>
      <Button size="small" onClick={retryFeedNow}>
        {tr('ui.office.offline.now')}
      </Button>
    </div>
  )
}

function OutdatedLine() {
  return (
    <div class="offline-bar" role="alert">
      <span>{tr('ui.office.offline.outdated')}</span>
      <Button size="small" onClick={() => location.reload()}>
        {tr('ui.office.offline.reload')}
      </Button>
    </div>
  )
}
