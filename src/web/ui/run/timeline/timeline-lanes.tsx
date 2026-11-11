import type { ComponentChildren } from 'preact'
import { useSignal } from '@preact/signals'

import type { MessageKey } from '@/i18n'
import { staleSince } from '@/web/state/live'
import { state } from '@/web/state/session'
import { childOutcomeKey } from '@/web/text/child-outcome'
import { formatCost } from '@/web/text/cost'
import { PERCENT } from '@/web/text/figures'
import { joinInline } from '@/web/text/glyphs'
import { formatClock, formatDuration } from '@/web/text/time'
import { tr } from '@/web/text/tr'
import {
  isRunningSpan,
  type RunStretch,
  type TimelineGroup,
  type TimelineLane,
  type TimelineSpan,
  type TimelineView,
} from '@/web/ui/run/timeline/timeline-model'
import { TickerLink } from '@/web/ui/ticker/ticker-link'

interface Axis {
  readonly fromMs: number
  readonly toMs: number
}

interface BarSpec {
  readonly key: string
  readonly fromMs: number
  readonly toMs: number
  readonly className: string
}

interface TimelineLanesProps {
  readonly view: TimelineView
  /** The groups to draw: all of them, or the one name the reader picked. */
  readonly groups: readonly TimelineGroup[]
  /** The names the run reported on; the closing stretch links them. */
  readonly tickers: readonly string[]
  /** The run's latest progress line, told by its stretch while it runs. */
  readonly progress: string | undefined
}

/** One row per person, between the run's two stretches; each row's bars sit on one time axis. */
export function TimelineLanes({ view, groups, tickers, progress }: TimelineLanesProps) {
  const timeZone = state.value?.timeZone
  const isStale = staleSince.value !== undefined

  return (
    <ol class="timeline-lanes">
      {view.prep !== undefined && (
        <StretchRow label="ui.office.timeline.prep" stretch={view.prep} axis={view} />
      )}
      {groups.flatMap((group) =>
        group.lanes.map((lane) => (
          <LaneRow
            key={lane.spans[0]?.runId ?? lane.agentId}
            lane={lane}
            subject={group.subject}
            axis={view}
            context={{ timeZone, isStale }}
          />
        ))
      )}
      {view.close !== undefined && (
        <StretchRow
          label="ui.office.timeline.close"
          stretch={view.close}
          axis={view}
          tickers={tickers}
          progress={progress}
          isStale={isStale}
        />
      )}
    </ol>
  )
}

interface Context {
  readonly timeZone: string | undefined
  readonly isStale: boolean
}

interface LaneRowProps {
  readonly lane: TimelineLane
  readonly subject: TimelineGroup['subject']
  readonly axis: Axis
  readonly context: Context
}

function LaneRow({ lane, subject, axis, context }: LaneRowProps) {
  const { timeZone, isStale } = context

  return (
    <TrackRow
      label={lane.label}
      meta={describeLane(lane, timeZone)}
      axis={axis}
      bars={lane.spans.map((span) => toSpanBar(span, axis, isStale))}
      detail={<LaneDetail lane={lane} subject={subject} timeZone={timeZone} />}
    />
  )
}

interface StretchRowProps {
  readonly label: MessageKey
  readonly stretch: RunStretch
  readonly axis: Axis
  readonly tickers?: readonly string[]
  readonly progress?: string | undefined
  readonly isStale?: boolean
}

// The run's own time between its people: preparing before the first, saving after the last.
function StretchRow({ label, stretch, axis, tickers = [], progress, isStale }: StretchRowProps) {
  const timeZone = state.value?.timeZone
  const bar: BarSpec = {
    key: label,
    fromMs: stretch.fromMs,
    toMs: stretch.toMs,
    className: toStretchClass(stretch, isStale === true),
  }

  return (
    <TrackRow
      label={tr(label)}
      meta={describeStretch(stretch, progress, timeZone)}
      axis={axis}
      bars={[bar]}
      detail={tickers.length === 0 ? undefined : <CaseLinks tickers={tickers} />}
    />
  )
}

interface TrackRowProps {
  readonly label: string
  readonly meta: string
  readonly axis: Axis
  readonly bars: readonly BarSpec[]
  /** What the row opens to; a row without one is plain text. */
  readonly detail?: ComponentChildren
}

function TrackRow({ label, meta, axis, bars, detail }: TrackRowProps) {
  const isOpen = useSignal(false)
  const text = (
    <>
      <b>{label}</b>
      <span class="meta">{meta}</span>
    </>
  )

  return (
    <li class="timeline-lane">
      {detail === undefined ? (
        <p class="timeline-text">{text}</p>
      ) : (
        <button
          type="button"
          class="timeline-text timeline-toggle"
          aria-expanded={isOpen.value}
          onClick={() => {
            isOpen.value = !isOpen.value
          }}
        >
          {text}
        </button>
      )}
      <div class="timeline-track" aria-hidden="true">
        {bars.map((bar) => (
          <i key={bar.key} class={`timeline-bar ${bar.className}`} style={toBox(bar, axis)} />
        ))}
      </div>
      {isOpen.value && detail}
    </li>
  )
}

interface LaneDetailProps {
  readonly lane: TimelineLane
  readonly subject: TimelineGroup['subject']
  readonly timeZone: string | undefined
}

function LaneDetail({ lane, subject, timeZone }: LaneDetailProps) {
  return (
    <div class="timeline-detail">
      <ul class="timeline-spans">
        {lane.spans.map((span, index) => (
          <SpanLine key={span.runId} span={span} isAgain={index > 0} timeZone={timeZone} />
        ))}
      </ul>
      {subject !== undefined && <CaseLinks tickers={[subject.ticker]} market={subject.market} />}
    </div>
  )
}

interface SpanLineProps {
  readonly span: TimelineSpan
  readonly isAgain: boolean
  readonly timeZone: string | undefined
}

function SpanLine({ span, isAgain, timeZone }: SpanLineProps) {
  const said = span.said
  const reason = toReason(span)
  const facts = [
    ...describeTimes(span, timeZone),
    ...(span.costUsd === undefined ? [] : [formatCost(span.costUsd)]),
    ...(isAgain ? [tr('ui.office.timeline.askedAgain')] : []),
    ...(reason === undefined ? [] : [tr(reason)]),
    ...(span.isEndUnknown === true ? [tr('ui.office.timeline.endUnknown')] : []),
  ]

  return (
    <li>
      <p class="meta">{joinInline(facts)}</p>
      {said !== undefined && (
        <p class="timeline-said">
          {joinInline([...(said.stance === undefined ? [] : [said.stance]), said.line])}
        </p>
      )}
      {span.summary !== undefined && <p class="timeline-said">{span.summary}</p>}
    </li>
  )
}

interface CaseLinksProps {
  readonly tickers: readonly string[]
  readonly market?: string | undefined
}

function CaseLinks({ tickers, market }: CaseLinksProps) {
  return (
    <p class="meta timeline-case">
      <span>{tr('ui.office.timeline.readCase')}</span>
      {tickers.map((ticker) => (
        <TickerLink key={ticker} ticker={ticker} {...(market === undefined ? {} : { market })} />
      ))}
    </p>
  )
}

function toStretchClass(stretch: RunStretch, isStale: boolean): string {
  if (!stretch.isRunning) {
    return 'is-stretch'
  }

  return isStale ? 'is-stretch is-running is-stale' : 'is-stretch is-running'
}

// A running bar and one whose end is unknown reach the axis end; the rest end where they ended.
function toSpanBar(span: TimelineSpan, axis: Axis, isStale: boolean): BarSpec {
  return {
    key: span.runId,
    fromMs: span.startedAt,
    toMs: span.endedAt ?? axis.toMs,
    className: toSpanClass(span, isStale),
  }
}

function toSpanClass(span: TimelineSpan, isStale: boolean): string {
  if (span.isEndUnknown === true) {
    return 'is-unknown'
  }

  if (isRunningSpan(span)) {
    return isStale ? 'is-running is-stale' : 'is-running'
  }

  return toReason(span) === undefined ? 'is-done' : 'is-unfinished'
}

// Why a role did not finish, when it did not; absent for one that finished.
function toReason(span: TimelineSpan): MessageKey | undefined {
  return span.outcome === undefined ? undefined : childOutcomeKey(span.outcome)
}

function toBox({ fromMs, toMs }: BarSpec, axis: Axis): { left: string; width: string } {
  const range = axis.toMs - axis.fromMs

  if (range <= 0) {
    return { left: '0%', width: '0%' }
  }

  return {
    left: toPercent((fromMs - axis.fromMs) / range),
    width: toPercent((toMs - fromMs) / range),
  }
}

function toPercent(fraction: number): string {
  return `${Math.round(fraction * PERCENT * PERCENT) / PERCENT}%`
}

function describeLane(lane: TimelineLane, timeZone: string | undefined): string {
  const first = lane.spans[0]
  const start =
    first === undefined || timeZone === undefined ? [] : [formatClock(first.startedAt, timeZone)]
  const cost = lane.costUsd === undefined ? [] : [formatCost(lane.costUsd)]

  return joinInline([...start, describeWork(lane.spans), ...cost])
}

// Still working, else the time its finished runs took; "not known" when none of them has an end.
function describeWork(spans: readonly TimelineSpan[]): string {
  if (spans.some(isRunningSpan)) {
    return tr('ui.office.timeline.working')
  }

  const ended = spans.flatMap((span) =>
    span.endedAt === undefined ? [] : [span.endedAt - span.startedAt]
  )

  return ended.length === 0
    ? tr('ui.office.timeline.endUnknown')
    : formatDuration(ended.reduce((sum, took) => sum + took, 0))
}

function describeStretch(
  stretch: RunStretch,
  progress: string | undefined,
  timeZone: string | undefined
): string {
  const lead = stretch.isRunning && progress !== undefined ? [progress] : []
  const start = timeZone === undefined ? [] : [formatClock(stretch.fromMs, timeZone)]

  return joinInline([...lead, ...start, formatDuration(stretch.toMs - stretch.fromMs)])
}

function describeTimes(span: TimelineSpan, timeZone: string | undefined): string[] {
  const { startedAt, endedAt } = span

  if (endedAt === undefined) {
    return [
      ...(timeZone === undefined ? [] : [formatClock(startedAt, timeZone)]),
      ...(span.isEndUnknown === true ? [] : [tr('ui.office.timeline.working')]),
    ]
  }

  const range =
    timeZone === undefined
      ? []
      : [
          tr('ui.office.timeline.from', {
            start: formatClock(startedAt, timeZone),
            end: formatClock(endedAt, timeZone),
          }),
        ]

  return [...range, formatDuration(endedAt - startedAt)]
}
