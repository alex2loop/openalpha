import type { OutboundResponse } from '@/app/server/wire/outbound'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { WEATHER_POLL_MS, WEATHER_URL } from '@/web/scene/data/weather'
import { ABSENT_CELL } from '@/web/text/glyphs'
import { MS_PER_MINUTE } from '@/web/text/time-units'
import { toFailureText, tr } from '@/web/text/tr'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { useLoad } from '@/web/ui/kit/use-load'

// The page's own outside call, under the daemon's.
const WEATHER_HOST = new URL(WEATHER_URL).host

/** Every outside host the daemon can call under this config, and what it sends there, in the
 *  daemon's own words; then the one the page itself calls. */
export function Outbound() {
  const hosts = useLoad(loadOutbound).value

  return (
    <section class="setting-row">
      <h3 class="setting-title">{tr('ui.office.data.outbound')}</h3>
      <p class="meta">{tr('ui.office.data.outboundNote')}</p>
      {hosts.status === 'loading' && <Skeleton lines={3} />}
      {hosts.status === 'failed' && <p class="failure-line">{toFailureText(hosts.failure)}</p>}
      {hosts.status === 'ready' &&
        hosts.value.hosts.map((entry) => (
          <div key={`${entry.purpose}:${entry.host}:${entry.sends}`} class="setting-job">
            <b class="mono">{entry.host === '' ? ABSENT_CELL : entry.host}</b>
            <p class="meta">{entry.sends}</p>
          </div>
        ))}
      <div class="setting-job">
        <b class="mono">{WEATHER_HOST}</b>
        <p class="meta">
          {tr('ui.office.data.pageCalls', { minutes: WEATHER_POLL_MS / MS_PER_MINUTE })}
        </p>
      </div>
    </section>
  )
}

function loadOutbound(signal: AbortSignal): Promise<OutboundResponse> {
  return getJson(ROUTES.outbound, { signal })
}
