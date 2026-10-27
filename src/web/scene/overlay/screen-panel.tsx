import type { LitScreen } from '@/web/scene/overlay/screens'
import { screenHosts } from '@/web/scene/data/desk-reads'
import { roleNameOf } from '@/web/scene/overlay/name-tags'
import { rosterDefOf } from '@/web/scene/sim/actors/roster'
import { bringIntoView } from '@/web/scene/view'
import { roomById } from '@/web/scene/world/rooms'
import { focusRun } from '@/web/state/focus'
import { openView } from '@/web/state/panel'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { openModal } from '@/web/ui/kit/modal'

/** A click on a lit screen: its desk comes into view, then the scout's screen opens as a panel of
 *  the hosts read this run, the analyst's as the ticker's card and anyone else's as their run. */
export function openScreen(screen: LitScreen): void {
  const room = roomById(screen.room)

  bringIntoView({
    floor: screen.floor,
    rect: screen.rect,
    ...(room === undefined ? {} : { room: { id: room.id, rect: room.rect } }),
  })

  if (screen.content.kind === 'line') {
    openView({ ticker: screen.content.ticker, market: screen.content.market })
    return
  }

  if (screen.content.kind === 'run') {
    focusRun(screen.runId)
    return
  }

  const def = rosterDefOf(screen.actor)
  const name = def === undefined ? '' : roleNameOf(def.role)
  const handle = openModal({
    title: tr('ui.office.screen.title', { name }),
    body: <HostList runId={screen.runId} current={screen.content.host} />,
    footer: (
      <Button kind="commit" onClick={() => handle.close()}>
        {tr('ui.office.common.close')}
      </Button>
    ),
  })
}

interface HostListProps {
  readonly runId: string
  /** The host on the screen when it was clicked; a page opened mid-read has not heard it yet. */
  readonly current: string
}

// Follows the run while the panel is open: a host read meanwhile joins the list.
function HostList({ runId, current }: HostListProps) {
  const heard = screenHosts.value.get(runId) ?? []
  const hosts = heard.includes(current) ? heard : [...heard, current]

  if (hosts.length === 0) {
    return <p class="meta">{tr('ui.office.screen.noPage')}</p>
  }

  return (
    <ul class="screen-hosts">
      {hosts.map((host) => (
        <li key={host}>{host}</li>
      ))}
    </ul>
  )
}
