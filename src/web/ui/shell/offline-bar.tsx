import { useNow } from '@/web/state/clock'
import { retryFeedNow } from '@/web/state/feed'
import { restartPhase } from '@/web/state/restart'
import { connection } from '@/web/state/session'
import { joinInline } from '@/web/text/glyphs'
import { formatCountdown } from '@/web/text/time'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { RestartStatus } from '@/web/ui/settings/restart'
import { openSettings } from '@/web/ui/settings/settings'

import './offline-bar.css'

const COUNTDOWN_TICK_MS = 1_000

/** The dark bar above the command bar while the feed is down, or the reload line once the page is
 *  older than the daemon. A restart the page asked for takes its place from the request to the end. The countdown and "Thử ngay" show only while a retry is armed. */
export function OfflineBar() {
  const { status, retryAt } = connection.value

  if (restartPhase.value !== undefined) {
    return <RestartStatus onSee={openSettings} />
  }

  if (status === 'outdated') {
    return <OutdatedLine />
  }

  if (status !== 'offline') {
    return null
  }

  return (
    <div class="offline-bar" role="status">
      <strong>{tr('ui.office.offline.title')}</strong>
      {retryAt === undefined ? <RunningNote /> : <ArmedRetry retryAt={retryAt} />}
    </div>
  )
}

function RunningNote() {
  return <span class="offline-bar-detail">{tr('ui.office.offline.running')}</span>
}

// The last tick before the attempt starts can land past `retryAt`; it reads like an attempt under way.
function ArmedRetry({ retryAt }: { readonly retryAt: number }) {
  const now = useNow(COUNTDOWN_TICK_MS).value

  if (retryAt <= now) {
    return <RunningNote />
  }

  const detail = joinInline([
    tr('ui.office.offline.retry', { seconds: formatCountdown(retryAt, now) }),
    tr('ui.office.offline.running'),
  ])

  return (
    <>
      <span class="offline-bar-detail">{detail}</span>
      <Button size="small" onClick={retryFeedNow}>
        {tr('ui.office.offline.now')}
      </Button>
    </>
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
