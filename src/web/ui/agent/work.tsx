import type { ActivityRowWire } from '@/app/server/wire/activity'
import type { BoardEntryWire } from '@/app/server/wire/notices'
import type { ScheduleRow } from '@/app/server/wire/system'
import type { AgentView } from '@/web/ui/agent/agent-view'
import { pluralKey } from '@/i18n'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { useBlock } from '@/web/state/block'
import { findFinishedTickers } from '@/web/state/live'
import { state } from '@/web/state/session'
import { formatUsd } from '@/web/text/figures'
import { ABSENT_CELL, joinInline } from '@/web/text/glyphs'
import { formatRunName } from '@/web/text/run-name'
import { describeEvent } from '@/web/text/schedule-event'
import { formatClock, formatWhen } from '@/web/text/time'
import { tr } from '@/web/text/tr'
import { DayCount, DayStrip } from '@/web/ui/agent/day-strip'
import { RecordSentence } from '@/web/ui/agent/reputation'
import { TickerLinks } from '@/web/ui/agent/result'
import { openScheduleDialog } from '@/web/ui/agent/schedule/schedule-dialog'
import { formatAlertSeconds } from '@/web/ui/jobs/schedule-sections'
import { Button } from '@/web/ui/kit/button'
import { Fold } from '@/web/ui/kit/fold'
import { useLoad } from '@/web/ui/kit/use-load'

/** "Việc": today's rhythm, its schedules with "+ Thêm lịch", and what its recent runs reported. */
export function Work({ view }: { readonly view: AgentView }) {
  const tasks = useLoad((signal) => getJson(ROUTES.tasks, { signal })).value
  const board = useBlock(ROUTES.board)
  const schedules = (state.value?.schedules ?? []).filter((row) => row.agentId === view.agentId)
  const seconds = formatAlertSeconds(tasks)

  return (
    <>
      <section class="agent-section">
        <h3 class="sub-head">{tr('ui.office.agent.rhythm')}</h3>
        <DayStrip view={view} schedules={schedules} />
        <DayCount view={view} schedules={schedules} seconds={seconds} />
      </section>
      <section class="agent-section">
        <h3 class="sub-head">{tr('ui.office.agent.schedules')}</h3>
        {schedules.length === 0 && <p class="meta">{tr('ui.office.agent.noSchedules')}</p>}
        {schedules.map((row) => (
          <ScheduleLine key={String(row.id)} row={row} />
        ))}
        <Button size="small" onClick={() => openScheduleDialog({ view, seconds })}>
          {tr('ui.office.agent.addSchedule')}
        </Button>
      </section>
      <section class="agent-section">
        <h3 class="sub-head">{tr('ui.office.agent.recent')}</h3>
        {view.rows.length === 0 && <p class="meta">{tr('ui.office.agent.noResult')}</p>}
        {view.rows.map((row) => (
          <RecentRow key={row.runId} row={row} entries={board.data?.entries ?? []} />
        ))}
        {view.agent !== undefined && <RecordSentence agent={view.agent} />}
      </section>
    </>
  )
}

function ScheduleLine({ row }: { readonly row: ScheduleRow }) {
  const timeZone = state.value?.timeZone
  const prompt = typeof row.prompt === 'string' ? row.prompt : ''
  const when = describeWhen(row, timeZone)

  return (
    <p class="agent-schedule">
      {row.event !== undefined && <span class="agent-tag">{tr('ui.office.agent.eventChip')}</span>}
      <span>{joinInline([when, prompt])}</span>
    </p>
  )
}

function describeWhen(row: ScheduleRow, timeZone: string | undefined): string {
  if (row.event !== undefined) {
    return describeEvent(row.event)
  }

  return typeof row.nextRunAt === 'number' && timeZone !== undefined
    ? formatWhen(row.nextRunAt, timeZone)
    : ABSENT_CELL
}

interface RecentRowProps {
  readonly row: ActivityRowWire
  readonly entries: readonly BoardEntryWire[]
}

// The names come from the run's board entry, else from the end this page watched.
function RecentRow({ row, entries }: RecentRowProps) {
  const timeZone = state.value?.timeZone
  const entry = entries.find((held) => held.runId === row.runId)
  const tickers = entry?.tickers ?? findFinishedTickers(row.runId)
  const children = row.children ?? []

  return (
    <div class="agent-recent">
      <p>
        <b>{formatRunName(row)}</b>
        <span class="meta">
          {` ${timeZone === undefined ? ABSENT_CELL : formatClock(row.endedAt, timeZone)}`}
        </span>
      </p>
      {tickers.length > 0 && <TickerLinks tickers={tickers} />}
      {children.length > 0 && <KidFold kids={children} />}
    </div>
  )
}

function KidFold({ kids }: { readonly kids: readonly ActivityRowWire[] }) {
  const count = kids.length
  const cost = formatUsd(kids.reduce((sum, kid) => sum + kid.costUsd, 0))

  return (
    <Fold
      title={tr(pluralKey(count, 'ui.office.agent.kidFoldOne', 'ui.office.agent.kidFold'), {
        count,
        cost,
      })}
    >
      {kids.map((kid) => (
        <div key={kid.runId} class="kid">
          <p>
            <b>{formatRunName(kid)}</b>
            <span class="meta">{` ${formatUsd(kid.costUsd)}`}</span>
          </p>
          {kid.summary !== undefined && <p class="meta">{kid.summary}</p>}
        </div>
      ))}
    </Fold>
  )
}
