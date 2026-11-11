import { type Signal, useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'

import type { WireEvent } from '@/app/server/wire/events'
import { setCapped } from '@/web/state/capped-map'
import { onWireEvent } from '@/web/state/events'
import { type Run, runs } from '@/web/state/live'
import { firstSentence } from '@/web/text/sentence'

// More children than one run holds; the oldest leave first.
const RUN_CHILDREN_MAX = 200

/** How a child ended, as its `run_finished` said. */
export interface HeardEnd {
  readonly outcome: string
  /** Daemon epoch ms; absent from an older daemon. */
  readonly endedAt?: number
}

/** What a debate role said once the debate was verified. */
export interface RoleSaid {
  readonly market: string
  readonly stance?: string
  /** The first sentence of the role's summary. */
  readonly line: string
}

export interface HeardChildren {
  /** Children seen in `runs`, oldest first; at most `RUN_CHILDREN_MAX`. */
  readonly seen: ReadonlyMap<string, Run>
  readonly ended: ReadonlyMap<string, HeardEnd>
  /** By `${ticker}:${role}`; filled once the debate is verified, never on the web. */
  readonly said: ReadonlyMap<string, RoleSaid>
}

interface Hearing {
  readonly runId: string
  readonly seen: ReadonlyMap<string, Run>
  readonly ended: Signal<ReadonlyMap<string, HeardEnd>>
  readonly said: Signal<ReadonlyMap<string, RoleSaid>>
  readonly onEnded: () => void
}

/** The key a role's words are kept under. */
export function toSaidKey(ticker: string, role: string): string {
  return `${ticker}:${role}`
}

/** Remembers a run's children as the feed shows them, how each ended and what each debate role said;
 *  `onEnded` runs when the run or one of its children ends. Listeners leave on unmount; a mount is
 *  for one run, so key it by `runId`. */
export function useHeardChildren(runId: string, onEnded?: () => void): HeardChildren {
  const seen = useRef(new Map<string, Run>())
  const ended = useSignal<ReadonlyMap<string, HeardEnd>>(new Map())
  const said = useSignal<ReadonlyMap<string, RoleSaid>>(new Map())
  const notify = useRef(onEnded)

  notify.current = onEnded

  // A child leaves the live feed when it ends, so it is kept here.
  for (const run of runs.value) {
    if (run.parentRunId === runId) {
      setCapped(seen.current, [run.runId, run], RUN_CHILDREN_MAX)
    }
  }

  useEffect(
    () =>
      startHearing({
        runId,
        seen: seen.current,
        ended,
        said,
        onEnded: () => notify.current?.(),
      }),
    []
  )

  return { seen: seen.current, ended: ended.value, said: said.value }
}

function startHearing(hearing: Hearing): () => void {
  const offs = [
    onWireEvent('run_finished', (event) => hearEnd(hearing, event)),
    onWireEvent('role_output', (event) => hearRole(hearing, event)),
  ]

  return () => {
    for (const off of offs) {
      off()
    }
  }
}

function hearEnd({ runId, seen, ended, onEnded }: Hearing, event: WireEvent): void {
  const { runId: endedId, outcome, endedAt } = event

  if (endedId === undefined) {
    return
  }

  const isChild = seen.has(endedId)

  if (isChild && outcome !== undefined) {
    const end: HeardEnd = endedAt === undefined ? { outcome } : { outcome, endedAt }

    ended.value = withCapped(ended.value, [endedId, end])
  }

  if (isChild || endedId === runId) {
    onEnded()
  }
}

function hearRole({ said }: Hearing, event: WireEvent): void {
  const { role } = event

  if (role === undefined || role.unsupported || role.summary === undefined) {
    return
  }

  const stance = role.stance === undefined ? {} : { stance: role.stance }
  const line: RoleSaid = { market: role.market, ...stance, line: firstSentence(role.summary) }

  said.value = withCapped(said.value, [toSaidKey(role.ticker, role.role), line])
}

function withCapped<V>(
  held: ReadonlyMap<string, V>,
  entry: readonly [string, V]
): ReadonlyMap<string, V> {
  const next = new Map(held)

  setCapped(next, entry, RUN_CHILDREN_MAX)

  return next
}
