import { computed, type ReadonlySignal, signal } from '@preact/signals'

import type { ProgressWire } from '@/app/server/wire/live'

const MAX_RUNS = 200
const MAX_PERSISTENT_STEPS = 20
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
  readonly progress?: ProgressWire
  readonly thinking?: string
  readonly persistent: readonly ProgressWire[]
  readonly tickers: readonly string[]
}

const runList = signal<readonly Run[]>([])
let arrivalSeq = 0

export const runs: ReadonlySignal<readonly Run[]> = runList
export const runningCount = computed(() => runList.value.filter((run) => !run.hidden).length)

/** The arrival order so far; a run seen at or before it was on the page then. */
export function readArrivalSeq(): number {
  return arrivalSeq
}

export function nextArrivalSeq(): number {
  arrivalSeq++

  return arrivalSeq
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
