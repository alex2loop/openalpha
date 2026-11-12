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
  // The page cannot hear the daemon, so a read cannot be had: that is not a load failure.
  if (staleSince.value !== undefined && state !== 'absent') {
    return <p class="empty-note">{tr('ui.office.timeline.stale')}</p>
  }

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
// spawned child) always shows. Text that is not yet a whole name shows no name's lanes, only a cue.
function Lanes({ runId, view, typed, tickers }: LanesProps) {
  const subjects = listSubjects(view.groups)
  const hasPicker = subjects.length > 1
  const picked = hasPicker ? pickSubject(subjects, typed.value) : undefined
  const shown = hasPicker
    ? view.groups.filter((group) => group.subject === undefined || group.subject.ticker === picked)
    : view.groups

  return (
    <>
      {hasPicker && (
        <SubjectPicker
          runId={runId}
          subjects={subjects}
          value={typed.value ?? picked ?? ''}
          typed={typed}
        />
      )}
      {hasPicker && picked === undefined && (
        <p class="empty-note">{toSubjectCue(subjects, typed.value ?? '')}</p>
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
  readonly value: string
  readonly typed: Signal<string | undefined>
}

function SubjectPicker({ runId, subjects, value, typed }: PickerProps) {
  const text = tr('ui.office.timeline.subjects', { count: subjects.length })

  return (
    <div class="timeline-subjects">
      <p class="meta">{text}</p>
      <Combobox
        id={`timeline-subject-${runId}`}
        label={text}
        value={value}
        options={subjects.map((subject) => subject.ticker)}
        onInput={(input) => {
          typed.value = input
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

// Nothing typed picks the first name still running, else the first; typed text picks the name it
// spells whole, and is undefined for text that spells none.
function pickSubject(subjects: readonly Subject[], typed: string | undefined): string | undefined {
  const wanted = typed?.trim().toLowerCase() ?? ''

  if (wanted === '') {
    return (subjects.find((subject) => subject.isRunning) ?? subjects[0])?.ticker
  }

  return subjects.find((subject) => subject.ticker.toLowerCase() === wanted)?.ticker
}

// Text some name holds, as the list filters, asks for a pick; text no name holds says so.
function toSubjectCue(subjects: readonly Subject[], typed: string): string {
  const query = typed.trim()
  const isPartial = subjects.some((subject) =>
    subject.ticker.toLowerCase().includes(query.toLowerCase())
  )

  return isPartial
    ? tr('ui.office.timeline.subjectPick')
    : tr('ui.office.timeline.subjectNone', { query })
}
