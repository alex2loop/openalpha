import { effect, type ReadonlySignal, signal, untracked } from '@preact/signals'

import type { SuggestionWire } from '@/app/server/wire/trading'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { homeMarket } from '@/web/scene/data/home'
import { toParamText } from '@/web/scene/data/room-status'
import { setCapped } from '@/web/state/capped-map'
import { onWireEvent } from '@/web/state/events'
import { type Run, runs } from '@/web/state/live'

const MAX_MEMORY_READS = 20
// The last call and the one before it.
const RECALLED_CALLS = 2
const ENDED_STATUS = 'ended'
// The steps of a run that has started its debate.
const DEBATE_KEY_PREFIXES = ['trading.progress.debate.', 'trading.progress.suggestion.debate']

/** One stored call on the name and how it ended. `day` is the call's day, `YYYY-MM-DD`. */
export interface PastCall {
  readonly action: 'buy' | 'reduce'
  readonly ticker: string
  readonly day: string
  readonly outcome: 'target' | 'stop' | 'expired'
}

/** A run's recalled calls, newest close first, and when they arrived (`performance.now()`). */
export interface Recall {
  readonly calls: readonly PastCall[]
  readonly heardAt: number
}

const recalls = signal<ReadonlyMap<string, Recall>>(new Map())

/** The ended calls each debating run's name had before, by `runId`; a name with none has no entry. */
export const pastCalls: ReadonlySignal<ReadonlyMap<string, Recall>> = recalls

/** Reads a name's ended calls once per run, when its debate starts, on the home market (the progress
 *  names no market). Reads are kept by `runId`, at most `MAX_MEMORY_READS`, each dropped at its
 *  run's `run_finished`. The returned stop is idempotent. */
export function startPastCalls(): () => void {
  const reads = new AbortController()
  const asked = new Map<string, true>()
  const stopEffect = effect(() => {
    const market = homeMarket.value?.market

    for (const run of runs.value) {
      const ticker = market === undefined ? undefined : debatedTicker(run)

      if (market !== undefined && ticker !== undefined && !asked.has(run.runId)) {
        setCapped(asked, [run.runId, true], MAX_MEMORY_READS)
        untracked(() =>
          recall({ runId: run.runId, market, ticker }, { asked, signal: reads.signal })
        )
      }
    }
  })
  const off = onWireEvent('run_finished', (event) => forget(asked, event.runId))

  return () => {
    reads.abort()
    stopEffect()
    off()
    asked.clear()
    recalls.value = new Map()
  }
}

function debatedTicker(run: Run): string | undefined {
  const progress = run.progress

  if (progress === undefined || !DEBATE_KEY_PREFIXES.some((key) => progress.key.startsWith(key))) {
    return undefined
  }

  return toParamText(progress.params?.ticker) ?? run.tickers[0]
}

interface RecallAsk {
  readonly runId: string
  readonly market: string
  readonly ticker: string
}

interface RecallScope {
  readonly asked: ReadonlyMap<string, true>
  readonly signal: AbortSignal
}

function recall(ask: RecallAsk, scope: RecallScope): void {
  loadRecall(ask, scope).catch(() => undefined)
}

async function loadRecall(ask: RecallAsk, scope: RecallScope): Promise<void> {
  try {
    const read = await getJson(ROUTES.suggestions, {
      query: {
        status: ENDED_STATUS,
        market: ask.market,
        ticker: ask.ticker,
        limit: RECALLED_CALLS,
      },
      signal: scope.signal,
    })
    const calls = read.suggestions.flatMap(toPastCall).slice(0, RECALLED_CALLS)

    // A run that finished while the read was out has nothing left to recall into.
    if (calls.length > 0 && scope.asked.has(ask.runId)) {
      const next = new Map(recalls.value)

      setCapped(next, [ask.runId, { calls, heardAt: performance.now() }], MAX_MEMORY_READS)
      recalls.value = next
    }
  } catch {
    // Nothing recalled: the manager says nothing rather than a call it could not read.
  }
}

function toPastCall(call: SuggestionWire): PastCall[] {
  if (call.action === 'hold' || call.outcome === undefined) {
    return []
  }

  return [
    {
      action: call.action,
      ticker: call.instrument.ticker,
      day: call.at,
      outcome: call.outcome.status,
    },
  ]
}

function forget(asked: Map<string, true>, runId: string | undefined): void {
  if (runId === undefined) {
    return
  }

  asked.delete(runId)

  if (recalls.value.has(runId)) {
    const next = new Map(recalls.value)

    next.delete(runId)
    recalls.value = next
  }
}
