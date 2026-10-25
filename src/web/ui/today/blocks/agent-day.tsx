import { useEffect } from 'preact/hooks'

import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { useBlockRead } from '@/web/state/block'
import { onWireEvent } from '@/web/state/events'
import { state } from '@/web/state/session'
import { buildDayKey } from '@/web/text/time'
import { tr } from '@/web/text/tr'
import { ActivityLine, openActivityDialog } from '@/web/ui/activity/activity-dialog'
import { Button } from '@/web/ui/kit/button'
import { ClockIcon } from '@/web/ui/kit/icons'
import { BlockFrame } from '@/web/ui/today/block-frame'

const AGENT_DAY_SHOWN = 4
const AGENT_DAY_POLL_MS = 60_000

/** "Hôm nay agent đã làm": the latest four runs of today, schedules and chats included. */
export function AgentDay() {
  const reading = useBlockRead(loadToday, { everyMs: AGENT_DAY_POLL_MS })

  // A run that ends is news at once; the poll is the backstop for an event the socket missed.
  useEffect(() => onWireEvent('run_finished', reading.retry), [])

  return (
    <BlockFrame
      title={tr('ui.office.today.agentDay')}
      colour="gray"
      icon={<ClockIcon />}
      reading={reading}
      action={
        <Button kind="tertiary" size="small" onClick={openActivityDialog}>
          {tr('ui.office.today.seeAll')}
        </Button>
      }
    >
      {(today) =>
        today.rows.length === 0 ? (
          <p class="meta">{tr('ui.office.jobs.none')}</p>
        ) : (
          <>
            {today.rows.slice(0, AGENT_DAY_SHOWN).map((row) => (
              <ActivityLine key={row.runId} row={row} />
            ))}
            <p class="meta">{tr('ui.office.today.agentDayNote')}</p>
          </>
        )
      }
    </BlockFrame>
  )
}

function loadToday(abort: AbortSignal) {
  const timeZone = state.value?.timeZone
  const query = timeZone === undefined ? {} : { day: buildDayKey(Date.now(), timeZone) }

  return getJson(ROUTES.activity, { query, signal: abort })
}
