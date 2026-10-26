import { type ReadonlySignal, signal } from '@preact/signals'

import type { ActorNow } from '@/web/scene/overlay/actor-state'
import type { Marker } from '@/web/scene/overlay/markers'
import type { ActorId, SimView } from '@/web/scene/types'
import { breachedStops } from '@/web/scene/data/room-status'
import { actorNowOf, actorRunOf, sceneGoals } from '@/web/scene/overlay/actor-state'
import { personNameOf, statusTextOf } from '@/web/scene/overlay/hover-label'
import { menuActionsFor } from '@/web/scene/overlay/radial-menu'
import { agents, selectedAgentId } from '@/web/state/agents'
import { thread } from '@/web/state/chat'
import { selectActor } from '@/web/state/focus'
import { pending, runs } from '@/web/state/live'
import { locale } from '@/web/state/session'
import { formatRunName } from '@/web/text/run-name'
import { tr } from '@/web/text/tr'

/** One line of the canvas's text twin: who, what they do now in words, and what its button opens. */
interface TwinRow {
  readonly actor: ActorId
  readonly text: string
  readonly open: () => void
}

const rows = signal<readonly TwinRow[]>([])
// What the lines were last built from: the stores they read by identity, and the frame's people
// as text; while none moves the lines are not built again.
let builtFrom: readonly unknown[] = []

/** Every person in the office and what they do now, as the last drawn frame showed them. */
export const twinRows: ReadonlySignal<readonly TwinRow[]> = rows

/** Rebuilt from a drawn frame only when what its lines read changed. Absent clears it. */
export function syncTwin(sim: SimView | undefined, markers: readonly Marker[]): void {
  const inputs = sim === undefined ? [] : inputsOf(sim, markers)

  if (inputs.length === builtFrom.length && inputs.every((input, at) => input === builtFrom[at])) {
    return
  }

  builtFrom = inputs
  rows.value =
    sim === undefined
      ? []
      : sim.actors.map((actor) => {
          const line = toLine(sim, actor.id, markers)

          return { actor: line.actor, text: line.text, open: openerOf(sim, line) }
        })
}

function inputsOf(sim: SimView, markers: readonly Marker[]): readonly unknown[] {
  const people = sim.actors.map((actor) => `${actor.id}:${actor.status ?? ''}`).join('|')
  const children = sim.team.children.map((child) => `${child.actor}:${child.role}`).join('|')

  return [
    sceneGoals.value,
    pending.value,
    runs.value,
    agents.value,
    thread.value,
    selectedAgentId.value,
    breachedStops.value,
    locale.value,
    markers,
    people,
    children,
    JSON.stringify(sim.life.lines),
  ]
}

interface TwinLine {
  readonly actor: ActorId
  readonly text: string
  readonly now: ActorNow
  readonly marker?: Marker
}

function toLine(sim: SimView, actor: ActorId, markers: readonly Marker[]): TwinLine {
  const name = personNameOf(sim, actor)
  const now = actorNowOf(sim, actor)
  const marker = markers.find((held) => held.actor === actor)

  if (marker !== undefined) {
    const what = marker.tone === 'stop' ? breachTextOf() : whatOf(now)

    return { actor, now, marker, text: tr('ui.office.a11y.twinMarker', { name, what }) }
  }

  if (now.kind === 'dot' && now.status === 'free') {
    return { actor, now, text: tr('ui.office.a11y.twinIdle', { name }) }
  }

  return { actor, now, text: tr('ui.office.a11y.twinBusy', { name, what: whatOf(now) }) }
}

// The clerk's marker stands for the first breached stop the alert desk holds.
function breachTextOf(): string {
  const [first] = breachedStops.value ?? []

  return first === undefined ? '' : tr('ui.office.a11y.breach', { ticker: first.ticker })
}

function whatOf(now: ActorNow): string {
  switch (now.kind) {
    case 'paused':
      return tr('ui.office.ix.paused')
    case 'asking':
      return now.what
    case 'queued':
      return tr('ui.office.label.queued', { what: now.what })
    case 'busy':
      return formatRunName(now.run)
    case 'errand':
    case 'life':
      return now.line
    case 'dot':
      return statusTextOf(now.status)
  }
}

// A marker's own target; else what the person's ring opens for their work now; else they are
// picked in the office.
function openerOf(sim: SimView, { actor, now, marker }: TwinLine): () => void {
  if (marker !== undefined) {
    return marker.open
  }

  const run = actorRunOf(actor)
  const parentAgentId = sim.team.children.find((child) => child.actor === actor)?.parentAgentId
  const actions = menuActionsFor(actor, {
    now,
    ...(run === undefined ? {} : { run }),
    ...(parentAgentId === undefined ? {} : { parentAgentId }),
  })
  const shown = actions.find((action) => action.id === 'now')

  return shown?.run ?? (() => selectActor(actor))
}
