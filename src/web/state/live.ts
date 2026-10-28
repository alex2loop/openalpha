import { computed, type ReadonlySignal, signal } from '@preact/signals'

import type { WireEvent } from '@/app/server/wire/events'
import type { PendingWire, ProgressWire, QuestionPendingWire } from '@/app/server/wire/live'

/** The pending entry an approval is; the other kind is a question. */
export const APPROVAL_KIND = 'approval'
const MAX_RUNS = 200
const MAX_PERSISTENT_STEPS = 20
const MAX_PENDING = 50
const MAX_FINISHED_TICKERS = 100
/** How often the page takes a fresh `GET /v1/live`, on top of every reconnect. */
export const LIVE_RESYNC_MS = 60_000

/** A run the daemon is working on. `seenAt` is a page-local arrival order, never a daemon time. */
export interface Run {
  readonly runId: string
  readonly kind: 'agent' | 'command'
  readonly name: string
  readonly title?: string
  readonly channelId: string
  readonly agentId?: string
  readonly sessionId: string
  readonly parentRunId?: string
  readonly hidden?: true
  readonly startedAt: number
  readonly seenAt: number
  /** Epoch ms by the page's clock when its latest line (start, step or thinking) arrived; lines
   *  the page orders against its own speech read this, never the daemon's `progress.at`. */
  readonly heardAt: number
  readonly progress?: ProgressWire
  readonly thinking?: string
  readonly persistent: readonly ProgressWire[]
  readonly tickers: readonly string[]
}

const runList = signal<readonly Run[]>([])
const pendingList = signal<readonly PendingWire[]>([])
const checkedAt = signal<number | undefined>(undefined)
// The tickers each run the page watched end reported, oldest first, by `runId`.
const finishedTickers = new Map<string, readonly string[]>()
let arrivalSeq = 0

export const runs: ReadonlySignal<readonly Run[]> = runList
export const runningCount = computed(() => runList.value.filter((run) => !run.hidden).length)
/** Approvals and questions waiting for an answer on any channel, oldest first. */
export const pending: ReadonlySignal<readonly PendingWire[]> = pendingList
/** Epoch ms the daemon's last alert pass finished; absent until the snapshot or an event says. */
export const alertsCheckedAt: ReadonlySignal<number | undefined> = checkedAt

/** Keeps the latest pass: a snapshot taken before a newer event never moves it back. */
export function noteAlertsChecked(at: number | undefined): void {
  if (at !== undefined && (checkedAt.value === undefined || at > checkedAt.value)) {
    checkedAt.value = at
  }
}

/** Remembers what a finished run reported on; past `MAX_FINISHED_TICKERS` the oldest leaves. */
export function noteFinishedTickers(runId: string, tickers: readonly string[] | undefined): void {
  if (tickers === undefined || tickers.length === 0) {
    return
  }

  finishedTickers.delete(runId)
  finishedTickers.set(runId, tickers)

  for (const oldest of finishedTickers.keys()) {
    if (finishedTickers.size <= MAX_FINISHED_TICKERS) {
      break
    }

    finishedTickers.delete(oldest)
  }
}

/** What a run this page watched end reported on; empty for one it did not see end. */
export function findFinishedTickers(runId: string): readonly string[] {
  return finishedTickers.get(runId) ?? []
}

/** The arrival order so far; a run seen at or before it was on the page then. */
export function readArrivalSeq(): number {
  return arrivalSeq
}

export function nextArrivalSeq(): number {
  arrivalSeq++

  return arrivalSeq
}

/** Whether a run the page holds was started by the run `runId`. */
export function hasChildren(runId: string): boolean {
  return runList.value.some((run) => run.parentRunId === runId)
}

export function findRun(runId: string): Run | undefined {
  return runList.value.find((run) => run.runId === runId)
}

/** Replaces the run in place by `runId`, else adds it last; past `MAX_RUNS` the oldest leaves. */
export function upsertRun(run: Run): void {
  if (findRun(run.runId) !== undefined) {
    updateRun(run.runId, () => run)
    return
  }

  runList.value = [...runList.value, run].slice(-MAX_RUNS)
}

export function updateRun(runId: string, update: (run: Run) => Run): void {
  runList.value = runList.value.map((run) => (run.runId === runId ? update(run) : run))
}

export function removeRun(runId: string): void {
  if (findRun(runId) !== undefined) {
    runList.value = runList.value.filter((run) => run.runId !== runId)
  }
}

/** Keeps the step list bounded and free of a step it already holds. */
export function appendStep(
  steps: readonly ProgressWire[],
  step: ProgressWire
): readonly ProgressWire[] {
  if (steps.some((held) => isSameStep(held, step))) {
    return steps
  }

  return [...steps, step].slice(-MAX_PERSISTENT_STEPS)
}

function isSameStep(a: ProgressWire, b: ProgressWire): boolean {
  return a.at === b.at && a.key === b.key && a.text === b.text
}

/** Takes a snapshot's list, less the requests an event held back meanwhile already resolved. */
export function replacePending(
  entries: readonly PendingWire[],
  resolvedIds: ReadonlySet<string>
): void {
  pendingList.value = entries
    .filter((entry) => !resolvedIds.has(pendingRequestId(entry) ?? ''))
    .slice(-MAX_PENDING)
}

/** Idempotent. A question leaves when the next agent run in its chat session starts, which is the
 *  answer turn; a slash command in that session answers nothing. */
export function applyPendingEvent(event: WireEvent): void {
  switch (event.kind) {
    case 'approval_requested':
      upsertPending({ kind: APPROVAL_KIND, event }, event.requestId)
      return
    case 'approval_resolved':
      removePending(event.requestId)
      return
    case 'clarification_requested':
      upsertPending(toQuestion(event), event.requestId)
      return
    case 'run_started':
      if (event.run?.kind === 'agent') {
        removeQuestions(event.run.sessionId)
      }
      return
    default:
      return
  }
}

function upsertPending(entry: PendingWire | undefined, requestId: string | undefined): void {
  if (entry === undefined || requestId === undefined) {
    return
  }

  const others = pendingList.value.filter((held) => pendingRequestId(held) !== requestId)

  pendingList.value = [...others, entry].slice(-MAX_PENDING)
}

function removePending(requestId: string | undefined): void {
  if (pendingList.value.some((held) => pendingRequestId(held) === requestId)) {
    pendingList.value = pendingList.value.filter((held) => pendingRequestId(held) !== requestId)
  }
}

function removeQuestions(sessionId: string): void {
  const isAnswered = (held: PendingWire): boolean =>
    held.kind === 'question' && held.sessionId === sessionId

  if (pendingList.value.some(isAnswered)) {
    pendingList.value = pendingList.value.filter((held) => !isAnswered(held))
  }
}

function toQuestion(event: WireEvent): QuestionPendingWire | undefined {
  const { requestId, runId, clarification, source } = event

  if (requestId === undefined || runId === undefined || clarification === undefined) {
    return undefined
  }

  return {
    kind: 'question',
    requestId,
    runId,
    sessionId: clarification.sessionId,
    channelId: clarification.channelId ?? source.channel,
    question: clarification.text,
    askedAt: clarification.askedAt ?? Date.now(),
    answerable: clarification.answerable === true,
  }
}

/** The key a snapshot entry and its live events share. */
export function pendingRequestId(entry: PendingWire): string | undefined {
  return entry.kind === APPROVAL_KIND ? entry.event.requestId : entry.requestId
}
