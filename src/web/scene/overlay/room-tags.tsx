import { signal } from '@preact/signals'

import type { SceneRenderer } from '@/web/scene/renderer'
import type { RoomId } from '@/web/scene/types'
import { type MessageKey, pluralKey } from '@/i18n'
import { marketList } from '@/web/scene/data/home'
import { type RoomStatus, roomStatus } from '@/web/scene/data/room-status'
import { toOverlayFont } from '@/web/scene/overlay/placement'
import { homePhase, isClosedPhase } from '@/web/scene/sim/rhythm'
import { placeOnPane, projection, view, zoomToRoom } from '@/web/scene/view'
import { type RoomDef, roomsOn } from '@/web/scene/world/rooms'
import { focusRun } from '@/web/state/focus'
import { isTradingPhase } from '@/web/state/market'
import { joinInline } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'

import './room-tags.css'

// The tag sits inside the room's top-left corner.
const TAG_INSET_PX = 4
// What the tag spends besides its text: padding, the live dot and its gap.
const TAG_CHROME_PX = 26
// The tag's weight and size, as its stylesheet sets them, for measuring what fits.
const TAG_FONT = '600 12px'
const ROOM_NAME_KEYS: Readonly<Record<RoomId, MessageKey>> = Object.freeze({
  store: 'ui.office.room.store',
  lib: 'ui.office.room.lib',
  meet: 'ui.office.room.meet',
  lobby: 'ui.office.room.lobby',
  alerts: 'ui.office.room.alerts',
  assist: 'ui.office.room.assist',
  desk: 'ui.office.room.desk',
  team: 'ui.office.common.yourAgents',
} satisfies Record<RoomId, MessageKey>)

interface RoomTag {
  readonly name: string
  readonly status?: string
}

// Which of a busy room's runs the queued chip shows next, per room.
const focusOffsets = signal<ReadonlyMap<RoomId, number>>(new Map())
let measurer: CanvasRenderingContext2D | null | undefined

/** A room's name and what it is doing, in the page's language. A count the daemon has not sent is
 *  left out, never shown as zero. */
export function roomTagOf(room: RoomId, status: RoomStatus | undefined): RoomTag {
  const name = tr(ROOM_NAME_KEYS[room])
  const line = statusLine(room, status)

  return line === undefined ? { name } : { name, status: line }
}

/** One tag per room on the floor shown: a click from the floor view zooms into the room. */
export function RoomTags({ renderer }: { readonly renderer: SceneRenderer }) {
  const shown = view.value
  const { scale } = projection.value

  return (
    <div class="room-tags">
      {roomsOn(shown.floor).map((room) => (
        <Tag
          key={room.id}
          room={room}
          renderer={renderer}
          width={room.rect.w * scale - TAG_INSET_PX * 2}
        />
      ))}
    </div>
  )
}

interface TagProps {
  readonly room: RoomDef
  readonly renderer: SceneRenderer
  readonly width: number
}

function Tag({ room, renderer, width }: TagProps) {
  const status = roomStatus.value.get(room.id)
  const tag = roomTagOf(room.id, status)
  const runs = status?.runs ?? []
  const at = placeOnPane(renderer, {
    x: room.rect.x + TAG_INSET_PX,
    y: room.rect.y + TAG_INSET_PX,
  })
  const full = tag.status === undefined ? tag.name : joinInline([tag.name, tag.status])
  const fits = textWidth(full) + TAG_CHROME_PX <= width

  return (
    <div
      class="room-tag-row"
      style={{ left: `${at.x}px`, top: `${at.y}px`, maxWidth: `${Math.max(0, width)}px` }}
    >
      <button
        type="button"
        class="room-tag glass"
        title={fits ? undefined : full}
        onClick={() => zoomToRoom(room.id, room.rect)}
      >
        {runs.length > 0 && <span class="room-live" title={tr('ui.office.room.live')} />}
        <span class="room-tag-text">{fits ? full : tag.name}</span>
      </button>
      {runs.length > 1 && <QueuedChip room={room.id} status={status} />}
    </div>
  )
}

function QueuedChip({
  room,
  status,
}: {
  readonly room: RoomId
  readonly status: RoomStatus | undefined
}) {
  const runs = status?.runs ?? []
  const count = runs.length - 1

  return (
    <button
      type="button"
      class="room-queued glass"
      onClick={() =>
        cycleFocus(
          room,
          runs.map((run) => run.runId)
        )
      }
    >
      {tr(pluralKey(count, 'ui.office.room.queuedOne', 'ui.office.room.queued'), { count })}
    </button>
  )
}

function cycleFocus(room: RoomId, runIds: readonly string[]): void {
  const next = ((focusOffsets.value.get(room) ?? 0) + 1) % runIds.length
  const runId = runIds[next]

  focusOffsets.value = new Map(focusOffsets.value).set(room, next)

  if (runId !== undefined) {
    focusRun(runId)
  }
}

function statusLine(room: RoomId, status: RoomStatus | undefined): string | undefined {
  const subject = status?.subject

  switch (room) {
    case 'store':
      return subject === undefined
        ? undefined
        : tr('ui.office.room.store.busy', { market: subject })
    case 'lib':
      return subject === undefined ? undefined : tr('ui.office.room.lib.busy', { topic: subject })
    case 'meet':
      return subject === undefined ? undefined : tr('ui.office.room.meet.busy', { ticker: subject })
    case 'lobby':
      return tr('ui.office.room.lobby.status')
    case 'alerts':
      return alertsLine(status)
    case 'desk':
      return deskLine(status?.waiting)
    default:
      return undefined
  }
}

function alertsLine(status: RoomStatus | undefined): string | undefined {
  const alerts = status?.alerts
  const stops = status?.stops
  const trading = isClosedPhase(homePhase.value) ? tradingWatched(status) : undefined

  if (trading !== undefined) {
    return tr('ui.office.room.alerts.closed', { market: trading })
  }

  return alerts === undefined || stops === undefined
    ? undefined
    : tr('ui.office.room.alerts.status', { alerts, stops })
}

// With the home market shut, the first market an alert or a stop watches that still trades.
function tradingWatched(status: RoomStatus | undefined): string | undefined {
  const watched = status?.markets

  return marketList.value.find(
    (market) =>
      watched?.has(market.market) === true &&
      (market.session === undefined || isTradingPhase(market.session.phase))
  )?.label
}

function deskLine(waiting: number | undefined): string | undefined {
  if (waiting === undefined || waiting === 0) {
    return undefined
  }

  return tr(pluralKey(waiting, 'ui.office.room.desk.statusOne', 'ui.office.room.desk.status'), {
    count: waiting,
  })
}

// One shared context measures every tag; a page that cannot make one keeps whole tags.
function textWidth(text: string): number {
  if (measurer === undefined) {
    measurer = document.createElement('canvas').getContext('2d')
  }

  if (measurer === null) {
    return 0
  }

  // Set each time: the overlay reads the page's family at mount, after a first render may measure.
  measurer.font = toOverlayFont(TAG_FONT)

  return measurer.measureText(text).width
}
