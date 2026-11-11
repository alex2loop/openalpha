import { effect, type Signal, untracked, useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

import type { RunTimelineWire } from '@/app/server/wire/live'
import { type BlockReading, useBlockRead } from '@/web/state/block'
import { ELAPSED_TICK_MS, useLiveNow } from '@/web/state/clock'
import { findFinishedTickers, findRun, staleSince } from '@/web/state/live'
import { formatCost } from '@/web/text/cost'
import { joinInline } from '@/web/text/glyphs'
import { formatDuration } from '@/web/text/time'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { Combobox } from '@/web/ui/kit/combobox'
import { Fold } from '@/web/ui/kit/fold'
import { Skeleton } from '@/web/ui/kit/skeleton'
import { useHeardChildren } from '@/web/ui/run/heard-children'
import { loadTimeline } from '@/web/ui/run/timeline/load-timeline'
import { TimelineLanes } from '@/web/ui/run/timeline/timeline-lanes'
import {
  buildTimeline,
  isRunningSpan,
  type TimelineGroup,
  type TimelineRoot,
  type TimelineView,
} from '@/web/ui/run/timeline/timeline-model'

import './run-timeline.css'

interface RunTimelineProps {
  readonly runId: string
  readonly root?: TimelineRoot
}

interface TimelineBodyProps extends RunTimelineProps {
  readonly isTitled?: true
}

interface Subject {
  readonly ticker: string
  readonly isRunning: boolean
}

/** "Diễn biến", open: who worked on a running run and when. A mount is for one run: key it by
 *  `runId`. */
export function RunTimeline(props: RunTimelineProps) {
  return <TimelineBody {...props} isTitled />
}

/** The same strip in a closed fold for a finished run: it reads only once opened. */
export function RunTimelineFold(props: RunTimelineProps) {
  return (
    <Fold title={tr('ui.office.timeline.title')}>
      <TimelineBody {...props} />
    </Fold>
  )
}

function TimelineBody({ runId, root, isTitled }: TimelineBodyProps) {
  const reading = useBlockRead((abort) => loadTimeline(runId, abort), { daemonOnly: true })
  const heard = useHeardChildren(runId, reading.retry)
  const now = useLiveNow(ELAPSED_TICK_MS).value
  const typed = useSignal<string | undefined>(undefined)

  useRereadWhenCurrent(reading.retry)

  const read = reading.data
  const view = buildTimeline({
    read,
    heard,
    isLive: (id) => findRun(id) !== undefined,
    root: resolveRoot(root, read),
    progressKey: findRun(runId)?.progress?.key,
    nowMs: now,
  })

  if (view === undefined) {
    return <NoStrip state={reading.state} retry={reading.retry} isFold={isTitled !== true} />
  }

  return (
    <section class="run-timeline">
      {isTitled === true && <p class="timeline-title">{tr('ui.office.timeline.title')}</p>}
      <RunLine view={view} />
      <Lanes runId={runId} view={view} typed={typed} tickers={resolveTickers(runId, read)} />
      {view.otherUsd !== undefined && (
        <p class="meta">
          {tr('ui.office.timeline.otherCost', { cost: formatCost(view.otherUsd) })}
        </p>
      )}
      {view.truncated && (
        <p class="meta">
          {tr('ui.office.timeline.truncated', { count: read?.children.length ?? 0 })}
        </p>
      )}
    </section>
  )
}

// Events heard while the picture was stale were never replayed, so the strip reads again the
// moment the picture is current.
function useRereadWhenCurrent(retry: () => void): void {
  useEffect(() => {
    let wasStale = staleSince.peek() !== undefined

    return effect(() => {
      const isStale = staleSince.value !== undefined

      if (wasStale && !isStale) {
        // The read starts in this call: it must not subscribe the effect to what it reads.
        untracked(retry)
      }

      wasStale = isStale
    })
  }, [])
}

// Once the run's row is read, its instants are the daemon's own.
function resolveRoot(
  root: TimelineRoot | undefined,
  read: RunTimelineWire | undefined
): TimelineRoot | undefined {
  return read?.run === undefined
    ? root
    : { startedAt: read.run.startedAt, endedAt: read.run.endedAt }
}

// The row once read, else the names the page heard the run report while it ran.
function resolveTickers(runId: string, read: RunTimelineWire | undefined): readonly string[] {
  return read?.run?.tickers ?? findRun(runId)?.tickers ?? findFinishedTickers(runId)
}

interface NoStripProps {
  readonly state: BlockReading<unknown>['state']
  readonly retry: () => void
  /** An opened fold says why it has nothing; a running strip just waits. */
  readonly isFold: boolean
}

function NoStrip({ state, retry, isFold }: NoStripProps) {
  if (state === 'failed') {
    return (
      <div class="strip is-problem" role="alert">
        <span>{tr('ui.office.timeline.failed')}</span>
        <Button size="small" onClick={retry}>
          {tr('ui.office.common.retry')}
        </Button>
      </div>
    )
  }

  if (state === 'loading') {
    return <Skeleton lines={2} />
  }

  if (!isFold) {
    return null
  }

  // No read was possible (the web edition): that is not the same as nobody having worked.
  const key = state === 'absent' ? 'ui.office.timeline.notKept' : 'ui.office.timeline.empty'

  return <p class="empty-note">{tr(key)}</p>
}

function RunLine({ view }: { readonly view: TimelineView }) {
  const key = view.isRunning ? 'ui.office.timeline.totalRunning' : 'ui.office.timeline.total'
  const duration = formatDuration(view.toMs - view.fromMs)
  const cost = view.totalUsd === undefined ? [] : [formatCost(view.totalUsd)]

  return <p class="meta">{joinInline([tr(key, { duration }), ...cost])}</p>
}

interface LanesProps {
  readonly runId: string
  readonly view: TimelineView
  /** What the reader typed in the name picker. */
  readonly typed: Signal<string | undefined>
  /** The names the run reported on. */
  readonly tickers: readonly string[]
}

// A batch has one group per name: the picker shows one at a time, and a group with no name (a
// spawned child) always shows.
function Lanes({ runId, view, typed, tickers }: LanesProps) {
  const subjects = listSubjects(view.groups)
  const chosen = subjects.length < 2 ? undefined : pickSubject(subjects, typed.value)
  const shown = view.groups.filter(
    (group) =>
      chosen === undefined || group.subject === undefined || group.subject.ticker === chosen
  )

  return (
    <>
      {chosen !== undefined && (
        <SubjectPicker runId={runId} subjects={subjects} chosen={chosen} typed={typed} />
      )}
      <TimelineLanes
        view={view}
        groups={shown}
        tickers={tickers}
        progress={findRun(runId)?.progress?.text}
      />
    </>
  )
}

interface PickerProps {
  readonly runId: string
  readonly subjects: readonly Subject[]
  readonly chosen: string
  readonly typed: Signal<string | undefined>
}

function SubjectPicker({ runId, subjects, chosen, typed }: PickerProps) {
  const text = tr('ui.office.timeline.subjects', { count: subjects.length })

  return (
    <div class="timeline-subjects">
      <p class="meta">{text}</p>
      <Combobox
        id={`timeline-subject-${runId}`}
        label={text}
        value={typed.value ?? chosen}
        options={subjects.map((subject) => subject.ticker)}
        onInput={(value) => {
          typed.value = value
        }}
      />
    </div>
  )
}

function listSubjects(groups: readonly TimelineGroup[]): readonly Subject[] {
  return groups.flatMap(({ subject, lanes }) =>
    subject === undefined
      ? []
      : [
          {
            ticker: subject.ticker,
            isRunning: lanes.some((lane) => lane.spans.some(isRunningSpan)),
          },
        ]
  )
}

// What was typed when it names a group, else the first name still running, else the first.
function pickSubject(subjects: readonly Subject[], typed: string | undefined): string {
  const wanted = typed?.trim().toLowerCase()
  const match = subjects.find((subject) => subject.ticker.toLowerCase() === wanted)
  const fallback = subjects.find((subject) => subject.isRunning) ?? subjects[0]

  return (match ?? fallback)?.ticker ?? ''
}
