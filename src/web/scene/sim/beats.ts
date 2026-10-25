import type { WireEvent } from '@/app/server/wire/events'
import type { ActorId, HeldItem, PoseId, SheetView } from '@/web/scene/types'
import type { PropKind } from '@/web/scene/world/props'
import type { onWireEvent } from '@/web/state/events'

type BeatKind =
  | 'handoff'
  | 'stamp'
  | 'phone'
  | 'scratch'
  | 'nod'
  | 'sit'
  | 'shrug'
  | 'head-down'
  | 'foot-tap'
  | 'headset'
  | 'wallet'

/** A one-shot gesture a real event plays over a person's goal, dropped when it ends. */
export interface Beat {
  readonly kind: BeatKind
  readonly pose: PoseId
  readonly item?: HeldItem
  readonly untilMs: number
}

/** What the wire events act on: the director's people, papers, stamps and the assistant's trip. */
export interface BeatTarget {
  actorsOfRun(runId: string): readonly ActorId[]
  /** The person who stood at your desk for a request that has just been answered. */
  deskActorOf(
    requestId: string
  ): { readonly actor: ActorId; readonly expiresAt?: number } | undefined
  play(actor: ActorId, beat: BeatSpec): void
  sendToTray(actor: ActorId): void
  stamp(actor: ActorId, action: NonNullable<SheetView['action']>): void
  startTrip(runId: string, at: PropKind): void
  endTrip(runId: string): void
  /** The page clock, for a request's `expiresAt`. */
  pageNow(): number
}

interface BeatSpec {
  readonly kind: BeatKind
  readonly pose: PoseId
  readonly item?: HeldItem
  readonly ms: number
}

const BEAT_MS = 1_600
const PHONE_RING_MS = 4_000
const RETRY_KEY = 'progress.researchQuestionRetry'
const COMPLETED = 'completed'
const DENY = 'deny'
const LEAD_STAMPER: ActorId = 'pm'
const CLERK: ActorId = 'clerk'
const BRIEF_HOLDER: ActorId = 'pm'
const REPORT_HOLDER: ActorId = 'synth'
// What an assistant's read is about, by the tool's name: a web page or a report lives in the
// library, prices and plans in the store.
const TRIP_PROPS: readonly (readonly [string, PropKind])[] = Object.freeze([
  ['web_', 'shelf'],
  ['research', 'shelf'],
  ['report', 'shelf'],
  ['market_', 'rack'],
  ['portfolio', 'rack'],
  ['plan', 'rack'],
])
const NET_CAPABILITY = 'net'

/** Subscribes the one-shot beats to the hub; the returned function unsubscribes them all. */
export function subscribeBeats(hub: typeof onWireEvent, target: BeatTarget): () => void {
  const offs = [
    hub('run_progress', (event) => onProgress(event, target)),
    hub('run_finished', (event) => onFinished(event, target)),
    hub('approval_resolved', (event) => onResolved(event, target)),
    hub('alert_fired', () => target.play(CLERK, phoneBeat())),
    hub('stop_breached', () => target.play(CLERK, phoneBeat())),
    hub('provider_fallback', (event) =>
      playOnRun(event, target, { kind: 'headset', pose: 'reach', item: 'headset', ms: BEAT_MS })
    ),
    hub('budget_exhausted', (event) =>
      playOnRun(event, target, { kind: 'wallet', pose: 'shrug', item: 'wallet', ms: BEAT_MS })
    ),
    hub('brief_ready', () => target.sendToTray(BRIEF_HOLDER)),
    hub('idea', (event) => onIdea(event, target)),
    hub('tool_started', (event) => onToolStarted(event, target)),
    hub('tool_result', (event) => {
      if (event.runId !== undefined) {
        target.endTrip(event.runId)
      }
    }),
  ]

  return () => {
    for (const off of offs) {
      off()
    }
  }
}

function phoneBeat(): BeatSpec {
  return { kind: 'phone', pose: 'phone-call', item: 'phone', ms: PHONE_RING_MS }
}

function playOnRun(event: WireEvent, target: BeatTarget, beat: BeatSpec): void {
  for (const actor of event.runId === undefined ? [] : target.actorsOfRun(event.runId)) {
    target.play(actor, beat)
  }
}

// A question sent round again: its scout scratches its head and goes back to it.
function onProgress(event: WireEvent, target: BeatTarget): void {
  if (event.progress?.key !== RETRY_KEY) {
    return
  }

  playOnRun(event, target, { kind: 'scratch', pose: 'scratch', ms: BEAT_MS })
}

function onFinished(event: WireEvent, target: BeatTarget): void {
  if (event.runId === undefined) {
    return
  }

  const isDone = event.outcome === COMPLETED

  playOnRun(event, target, {
    kind: isDone ? 'nod' : 'sit',
    pose: isDone ? 'nod' : 'sit',
    ms: BEAT_MS,
  })

  if (isDone && target.actorsOfRun(event.runId).includes(REPORT_HOLDER)) {
    target.sendToTray(REPORT_HOLDER)
  }
}

// A denial gets a shrug; a request that ran out its time (the gate denies it at `expiresAt`)
// gets its head down.
function onResolved(event: WireEvent, target: BeatTarget): void {
  const held = event.requestId === undefined ? undefined : target.deskActorOf(event.requestId)

  if (held === undefined || event.resolution?.decision !== DENY) {
    return
  }

  const isTimeout = held.expiresAt !== undefined && target.pageNow() >= held.expiresAt

  target.play(
    held.actor,
    isTimeout
      ? { kind: 'head-down', pose: 'nap', ms: BEAT_MS }
      : { kind: 'shrug', pose: 'shrug', ms: BEAT_MS }
  )
}

function onIdea(event: WireEvent, target: BeatTarget): void {
  const action = event.idea?.action

  if (action === undefined) {
    return
  }

  target.stamp(LEAD_STAMPER, action)
  target.play(LEAD_STAMPER, { kind: 'stamp', pose: 'stamp', ms: BEAT_MS })
}

function onToolStarted(event: WireEvent, target: BeatTarget): void {
  const tool = event.tool

  if (event.runId === undefined || tool === undefined) {
    return
  }

  const byName = TRIP_PROPS.find(([prefix]) => tool.name.startsWith(prefix))?.[1]
  const at = byName ?? (tool.capability === NET_CAPABILITY ? 'shelf' : undefined)

  if (at !== undefined) {
    target.startTrip(event.runId, at)
  }
}
