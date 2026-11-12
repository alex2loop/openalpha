import { type Signal, signal } from '@preact/signals'
import { useEffect, useMemo, useRef } from 'preact/hooks'

import type { WireEvent } from '@/app/server/wire/events'
import { setCapped } from '@/web/state/capped-map'
import { onWireEvent } from '@/web/state/events'
import { type Run, runs } from '@/web/state/live'
import { firstSentence } from '@/web/text/sentence'

// More children than one run holds; the oldest leave first.
const RUN_CHILDREN_MAX = 200

// More runs than the store keeps; the oldest leave first.
const HEARD_RUNS_MAX = 10

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
  /** By `${ticker}:${role}`; filled once the debate is verified, and only while the page hears it:
   *  a role's words are never stored, so a run the page did not watch has none. */
  readonly said: ReadonlyMap<string, RoleSaid>
}

// What the page heard of one run. Kept by run id, so a fold mounted after the run ended, which is
// all the web edition has (it reads no timeline), finds the children the running strip saw.
interface Heard {
  readonly seen: Map<string, Run>
  readonly ended: Signal<ReadonlyMap<string, HeardEnd>>
  readonly said: Signal<ReadonlyMap<string, RoleSaid>>
  /** The run ended: a role line heard after it belongs to a later debate. */
  isOver: boolean
}

interface Hearing {
  readonly runId: string
  readonly heard: Heard
  readonly onEnded: () => void
}

const heardRuns = new Map<string, Heard>()

/** The key a role's words are kept under. */
export function toSaidKey(ticker: string, role: string): string {
  return `${ticker}:${role}`
}

/** Remembers a run's children as the feed shows them, how each ended and what each debate role said;
 *  `onEnded` runs when the run or one of its children ends. Listeners leave on unmount; a mount is
 *  for one run, so key it by `runId`. */
export function useHeardChildren(runId: string, onEnded?: () => void): HeardChildren {
  const heard = useMemo(() => holdHeard(runId), [runId])
  const notify = useRef(onEnded)

  notify.current = onEnded

  // A child leaves the live feed when it ends, so it is kept here.
  for (const run of runs.value) {
    if (run.parentRunId === runId) {
      setCapped(heard.seen, [run.runId, run], RUN_CHILDREN_MAX)
    }
  }

  useEffect(() => startHearing({ runId, heard, onEnded: () => notify.current?.() }), [])

  return { seen: heard.seen, ended: heard.ended.value, said: heard.said.value }
}

function holdHeard(runId: string): Heard {
  const held = heardRuns.get(runId) ?? {
    seen: new Map(),
    ended: signal(new Map()),
    said: signal(new Map()),
    isOver: false,
  }

  setCapped(heardRuns, [runId, held], HEARD_RUNS_MAX)

  return held
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

function hearEnd({ runId, heard, onEnded }: Hearing, event: WireEvent): void {
  const { seen, ended } = heard
  const { runId: endedId, outcome, endedAt } = event

  if (endedId === undefined) {
    return
  }

  const isChild = seen.has(endedId)

  if (isChild && outcome !== undefined) {
    const end: HeardEnd = endedAt === undefined ? { outcome } : { outcome, endedAt }

    ended.value = withCapped(ended.value, [endedId, end])
  }

  if (endedId === runId) {
    heard.isOver = true
  }

  if (isChild || endedId === runId) {
    onEnded()
  }
}

// A line counts when this run has a child on that name in that role, and the run is still going: the
// event carries no run id, and a later debate on the same name speaks after this run ended.
function hearRole({ heard }: Hearing, event: WireEvent): void {
  const { role } = event

  if (
    heard.isOver ||
    role === undefined ||
    role.unsupported ||
    role.summary === undefined ||
    !hasChildFor(heard.seen, role.ticker, role.role)
  ) {
    return
  }

  const stance = role.stance === undefined ? {} : { stance: role.stance }
  const line: RoleSaid = { market: role.market, ...stance, line: firstSentence(role.summary) }

  heard.said.value = withCapped(heard.said.value, [toSaidKey(role.ticker, role.role), line])
}

function hasChildFor(seen: ReadonlyMap<string, Run>, ticker: string, role: string): boolean {
  return [...seen.values()].some(
    (run) => run.subject?.ticker === ticker && (run.agentId ?? run.name) === role
  )
}

function withCapped<V>(
  held: ReadonlyMap<string, V>,
  entry: readonly [string, V]
): ReadonlyMap<string, V> {
  const next = new Map(held)

  setCapped(next, entry, RUN_CHILDREN_MAX)

  return next
}
