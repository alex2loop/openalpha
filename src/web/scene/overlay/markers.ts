import type { PendingWire } from '@/app/server/wire/live'
import type { BreachedStop } from '@/web/scene/data/room-status'
import type { SceneMark } from '@/web/scene/overlay-types'
import type { Goal } from '@/web/scene/sim/vocabulary'
import type { ActorId, Rect } from '@/web/scene/types'
import { holderOf } from '@/web/scene/sim/vocabulary'
import { APPROVAL_KIND, pendingRequestId } from '@/web/state/live'
import { openView } from '@/web/state/panel'
import { BELL_POPOVER_ID, openPopover } from '@/web/ui/kit/popover'

// The marker's box in world px, standing this far over the person's head.
const MARKER_W = 10
const MARKER_H = 13
const MARKER_RISE = 3
const CLERK: ActorId = 'clerk'

/** An "!" over a person: amber over the one who brought an approval, red over the clerk while a
 *  stop is breached. `open` goes to what it is about. */
export interface Marker {
  readonly actor: ActorId
  readonly tone: SceneMark['tone']
  readonly open: () => void
}

interface MarkerInput {
  readonly goals: ReadonlyMap<ActorId, Goal>
  readonly pending: readonly PendingWire[]
  readonly breached: readonly BreachedStop[] | undefined
}

/** One marker per person, only where a waiting approval or a stored stop row stands behind it. */
export function buildMarkers(input: MarkerInput): readonly Marker[] {
  const markers = new Map<ActorId, Marker>()

  for (const entry of input.pending) {
    const requestId = entry.kind === APPROVAL_KIND ? pendingRequestId(entry) : undefined
    const holder = requestId === undefined ? undefined : holderOf(input.goals, entry)

    if (requestId !== undefined && holder !== undefined && !markers.has(holder)) {
      markers.set(holder, { actor: holder, tone: 'need', open: openBell })
    }
  }

  const [first] = input.breached ?? []

  if (first !== undefined) {
    markers.set(CLERK, {
      actor: CLERK,
      tone: 'stop',
      open: () => openView({ ticker: first.ticker, market: first.market }),
    })
  }

  return [...markers.values()]
}

/** The marker's box over a figure on screen, at the zoom the figure is drawn at (CSS px per
 *  world px). */
function markerRectOf(figure: Rect, scale: number): Rect {
  const w = MARKER_W * scale
  const h = MARKER_H * scale

  return { x: figure.x + figure.w / 2 - w / 2, y: figure.y - MARKER_RISE * scale - h, w, h }
}

/** Each marker with its box, for the markers whose person is on screen. */
export function placeMarkers(
  markers: readonly Marker[],
  at: { readonly figures: ReadonlyMap<ActorId, Rect>; readonly scale: number }
): { readonly marker: Marker; readonly rect: Rect }[] {
  return markers.flatMap((marker) => {
    const figure = at.figures.get(marker.actor)

    return figure === undefined ? [] : [{ marker, rect: markerRectOf(figure, at.scale) }]
  })
}

function openBell(): void {
  openPopover(BELL_POPOVER_ID)
}
