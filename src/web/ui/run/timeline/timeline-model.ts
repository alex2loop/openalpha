import type { ActivityRowWire } from '@/app/server/wire/activity'
import type { RunTimelineWire } from '@/app/server/wire/live'
import type { Run } from '@/web/state/live'
import { formatAgentName, formatRunName } from '@/web/text/run-name'
import { toSentenceStart } from '@/web/text/sentence'
import {
  type HeardChildren,
  type HeardEnd,
  type RoleSaid,
  toSaidKey,
} from '@/web/ui/run/heard-children'

// A listed child costing less than this much is a rounding left over, not another call.
const OTHER_USD_MIN = 0.005

interface TimelineRoot {
  readonly startedAt: number
  /** Absent while the run is running. */
  readonly endedAt?: number
}

/** One run of one role. Instants are clamped into the view's axis, so a bar never inverts. */
interface TimelineSpan {
  readonly runId: string
  readonly startedAt: number
  /** Absent while it runs, and when its end is unknown. */
  readonly endedAt?: number
  readonly isEndUnknown?: true
  readonly outcome?: string
  readonly costUsd?: number
  readonly summary?: string
  readonly said?: RoleSaid
}

interface TimelineLane {
  readonly agentId: string
  readonly label: string
  /** Oldest first; a second span is the role asked again. */
  readonly spans: readonly TimelineSpan[]
  readonly costUsd?: number
}

interface TimelineGroup {
  readonly subject?: { readonly ticker: string; readonly market?: string }
  readonly lanes: readonly TimelineLane[]
}

/** A stretch of the run itself between real events. */
interface RunStretch {
  readonly fromMs: number
  readonly toMs: number
  readonly isRunning: boolean
}

interface TimelineView {
  readonly fromMs: number
  readonly toMs: number
  readonly isRunning: boolean
  readonly groups: readonly TimelineGroup[]
  /** One group only: a batch has no per-name event for these. */
  readonly prep?: RunStretch
  readonly close?: RunStretch
  readonly totalUsd?: number
  /** Total less the listed children; absent when truncated, under a cent, or a child is not yet read. */
  readonly otherUsd?: number
  readonly truncated: boolean
}

interface TimelineInputs {
  readonly read: RunTimelineWire | undefined
  readonly heard: HeardChildren
  /** `findRun(runId) !== undefined`, passed in so the model stays pure. */
  readonly isLive: (runId: string) => boolean
  readonly root: TimelineRoot | undefined
  /** The page clock, frozen while stale (`useLiveNow`). */
  readonly nowMs: number
}

interface Entry {
  readonly agentId: string
  readonly label: string
  readonly ticker: string | undefined
  readonly market: string | undefined
  readonly span: TimelineSpan
}

interface Axis {
  readonly fromMs: number
  readonly toMs: number
}

/** Undefined while no child is known: a run that handed nothing out has no strip. */
export function buildTimeline(inputs: TimelineInputs): TimelineView | undefined {
  const { read, heard, root, nowMs } = inputs
  const entries = toEntries(inputs).toSorted(byStart)

  if (entries.length === 0) {
    return undefined
  }

  const isRunning = root === undefined ? entries.some(isRunningEntry) : root.endedAt === undefined
  const axis = toAxis(root, entries, isRunning ? nowMs : undefined)
  const clamped = entries.map((entry) => ({ ...entry, span: clampSpan(entry.span, axis) }))
  const groups = toGroups(clamped, heard)
  const stretches =
    root === undefined || groups.length !== 1
      ? {}
      : toStretches(
          root,
          clamped.map((entry) => entry.span),
          nowMs
        )

  return {
    ...axis,
    isRunning,
    groups,
    ...stretches,
    ...toCosts(read, clamped),
    truncated: read?.truncated ?? false,
  }
}

function toEntries({ read, heard, isLive }: TimelineInputs): readonly Entry[] {
  const rows = read?.children ?? []
  const listed = new Set(rows.map((row) => row.runId))
  const unread = [...heard.seen.values()].filter((run) => !listed.has(run.runId))

  return [
    ...rows.map((row) => toRowEntry(row, heard)),
    ...unread.map((run) => toSeenEntry(run, heard, isLive)),
  ]
}

function toRowEntry(row: ActivityRowWire, heard: HeardChildren): Entry {
  const agentId = row.agentId ?? row.name
  const seen = heard.seen.get(row.runId)
  const ticker = row.tickers?.[0] ?? seen?.subject?.ticker
  const costUsd = row.unbilled === true ? {} : { costUsd: row.costUsd }
  const summary = row.summary === undefined ? {} : { summary: row.summary }

  return {
    agentId,
    label: toLabel(row, agentId),
    ticker,
    market: seen?.subject?.market ?? findSaid(heard, ticker, agentId)?.market,
    span: {
      runId: row.runId,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      outcome: row.outcome,
      ...costUsd,
      ...summary,
    },
  }
}

// A child the read does not list yet: running while the feed has it, else as it was heard to end.
function toSeenEntry(run: Run, heard: HeardChildren, isLive: (runId: string) => boolean): Entry {
  const agentId = run.agentId ?? run.name
  const end = heard.ended.get(run.runId)
  const ticker = run.subject?.ticker

  return {
    agentId,
    label: toLabel(run, agentId),
    ticker,
    market: run.subject?.market ?? findSaid(heard, ticker, agentId)?.market,
    span: { runId: run.runId, startedAt: run.startedAt, ...toSeenEnd(isLive(run.runId), end) },
  }
}

function toSeenEnd(isLive: boolean, end: HeardEnd | undefined): Partial<TimelineSpan> {
  if (isLive) {
    return {}
  }

  if (end === undefined) {
    return { isEndUnknown: true as const }
  }

  return end.endedAt === undefined
    ? { isEndUnknown: true as const, outcome: end.outcome }
    : { endedAt: end.endedAt, outcome: end.outcome }
}

// A spawned child by its title, a debate role by its name.
function toLabel(run: ActivityRowWire | Run, agentId: string): string {
  return run.title === undefined ? toSentenceStart(formatAgentName(agentId)) : formatRunName(run)
}

function findSaid(
  heard: HeardChildren,
  ticker: string | undefined,
  agentId: string
): RoleSaid | undefined {
  return ticker === undefined ? undefined : heard.said.get(toSaidKey(ticker, agentId))
}

function byStart(a: Entry, b: Entry): number {
  return (
    a.span.startedAt - b.span.startedAt ||
    a.agentId.localeCompare(b.agentId) ||
    (a.ticker ?? '').localeCompare(b.ticker ?? '') ||
    a.span.runId.localeCompare(b.span.runId)
  )
}

function isRunningEntry({ span }: Entry): boolean {
  return span.endedAt === undefined && span.isEndUnknown !== true
}

// The run's own start and end when known, else the children's; a running end is the page clock.
function toAxis(root: TimelineRoot | undefined, entries: readonly Entry[], nowMs?: number): Axis {
  const starts = entries.map(({ span }) => span.startedAt)
  const ends = entries.map(({ span }) => span.endedAt ?? span.startedAt)
  const fromMs = root?.startedAt ?? Math.min(...starts)
  const toMs = root?.endedAt ?? nowMs ?? Math.max(...ends)

  return { fromMs, toMs: Math.max(toMs, fromMs) }
}

function clampSpan(span: TimelineSpan, { fromMs, toMs }: Axis): TimelineSpan {
  const startedAt = Math.min(Math.max(span.startedAt, fromMs), toMs)

  if (span.endedAt === undefined) {
    return { ...span, startedAt }
  }

  return { ...span, startedAt, endedAt: Math.min(Math.max(span.endedAt, startedAt), toMs) }
}

function toGroups(entries: readonly Entry[], heard: HeardChildren): readonly TimelineGroup[] {
  const byTicker = Map.groupBy(entries, (entry) => entry.ticker)

  return [...byTicker].map(([ticker, members]) => {
    const market = members.find((entry) => entry.market !== undefined)?.market
    const subject = ticker === undefined ? {} : { subject: toSubject(ticker, market) }

    return { ...subject, lanes: toLanes(members, heard) }
  })
}

function toSubject(
  ticker: string,
  market: string | undefined
): NonNullable<TimelineGroup['subject']> {
  return market === undefined ? { ticker } : { ticker, market }
}

// Entries arrive ordered by start, so lanes come out by first start, ties by id.
function toLanes(entries: readonly Entry[], heard: HeardChildren): readonly TimelineLane[] {
  const byAgent = Map.groupBy(entries, (entry) => entry.agentId)

  return [...byAgent].map(([agentId, members]) => toLane(agentId, members, heard))
}

function toLane(agentId: string, members: readonly Entry[], heard: HeardChildren): TimelineLane {
  const ticker = members[0]?.ticker
  const said = findSaid(heard, ticker, agentId)
  // What a role said is the last of its runs: the one that produced the answer.
  const spans = members.map(({ span }, index) =>
    said !== undefined && index === members.length - 1 ? { ...span, said } : span
  )
  const costUsd = sumCosts(spans)

  return {
    agentId,
    label: members[0]?.label ?? agentId,
    spans,
    ...(costUsd === undefined ? {} : { costUsd }),
  }
}

function sumCosts(spans: readonly TimelineSpan[]): number | undefined {
  const costs = spans.flatMap((span) => span.costUsd ?? [])

  return costs.length === 0 ? undefined : costs.reduce((sum, cost) => sum + cost, 0)
}

// "Chuẩn bị" runs from the run's start to its first child; the closing stretch from its last child
// to its end, or to now while the run is still going with no child running.
function toStretches(
  root: TimelineRoot,
  spans: readonly TimelineSpan[],
  nowMs: number
): { readonly prep?: RunStretch; readonly close?: RunStretch } {
  const firstStart = Math.min(...spans.map((span) => span.startedAt))
  const ends = spans.flatMap((span) => span.endedAt ?? [])
  const isRunning = root.endedAt === undefined
  const hasRunning = spans.some((span) => span.endedAt === undefined && span.isEndUnknown !== true)
  const lastEnd = ends.length === 0 ? undefined : Math.max(...ends)
  const prep =
    root.startedAt < firstStart ? { fromMs: root.startedAt, toMs: firstStart } : undefined
  const closeTo = Math.max(root.endedAt ?? nowMs, lastEnd ?? 0)
  const hasClose = lastEnd !== undefined && !hasRunning && (isRunning || closeTo > lastEnd)

  return {
    ...(prep === undefined ? {} : { prep: { ...prep, isRunning: false } }),
    ...(hasClose ? { close: { fromMs: lastEnd, toMs: closeTo, isRunning } } : {}),
  }
}

// What the run cost, and what part of it no listed person accounts for. The remainder is withheld
// while a child is missing from the read, or its cost would be counted twice.
function toCosts(
  read: RunTimelineWire | undefined,
  entries: readonly Entry[]
): { readonly totalUsd?: number; readonly otherUsd?: number } {
  if (read === undefined) {
    return {}
  }

  const listedIds = new Set(read.children.map((row) => row.runId))
  const isWhole = !read.truncated && entries.every(({ span }) => listedIds.has(span.runId))
  const listed = read.children.reduce(
    (sum, row) => sum + (row.unbilled === true ? 0 : row.costUsd),
    0
  )
  const otherUsd = read.totalUsd - listed

  return {
    totalUsd: read.totalUsd,
    ...(isWhole && otherUsd >= OTHER_USD_MIN ? { otherUsd } : {}),
  }
}
