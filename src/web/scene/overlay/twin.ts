import { type ReadonlySignal, signal } from '@preact/signals'

import type { ActorNow } from '@/web/scene/overlay/actor-state'
import type { Marker } from '@/web/scene/overlay/markers'
import type { ActorId, SimView } from '@/web/scene/types'
import { breachedStops } from '@/web/scene/data/room-status'
import { actorNowOf, actorRunOf } from '@/web/scene/overlay/actor-state'
import { personNameOf, statusTextOf } from '@/web/scene/overlay/hover-label'
import { menuActionsFor } from '@/web/scene/overlay/radial-menu'
import { selectActor } from '@/web/state/focus'
import { formatRunName } from '@/web/text/run-name'
import { tr } from '@/web/text/tr'

/** One line of the canvas's text twin: who, what they do now in words, and what its button opens. */
interface TwinRow {
  readonly actor: ActorId
  readonly text: string
  readonly open: () => void
}

const rows = signal<readonly TwinRow[]>([])
let signature = ''

/** Every person in the office and what they do now, as the last drawn frame showed them. */
export const twinRows: ReadonlySignal<readonly TwinRow[]> = rows

/** Rebuilt from each drawn frame; written only when a line changed. Absent clears it. */
export function syncTwin(sim: SimView | undefined, markers: readonly Marker[]): void {
  const lines = sim === undefined ? [] : sim.actors.map((actor) => toLine(sim, actor.id, markers))
  const nextSignature = lines.map((line) => `${line.actor}:${line.text}`).join('|')

  if (nextSignature === signature) {
    return
  }

  signature = nextSignature
  rows.value =
    sim === undefined ? [] : lines.map((line) => ({ ...line, open: openerOf(sim, line) }))
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
  const parentAgentId = sim.team.kids.find((kid) => kid.actor === actor)?.parentAgentId
  const actions = menuActionsFor(actor, {
    now,
    ...(run === undefined ? {} : { run }),
    ...(parentAgentId === undefined ? {} : { parentAgentId }),
  })
  const shown = actions.find((action) => action.id === 'now')

  return shown?.run ?? (() => selectActor(actor))
}
