import type { Bubble, BubbleKind } from '@/web/scene/overlay/bubbles'
import type { ActorId, Rect, RoomId, Size } from '@/web/scene/types'
import { setCapped } from '@/web/state/capped-map'

const MAX_BUBBLES = 4
const MAX_MEASURE_CACHE = 200
// The fonts overlay.css gives a bubble's line, its footer and buttons, and a name tag.
const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
const BUBBLE_FONT = `500 12px ${FONT_FAMILY}`
const FOOTER_FONT = `500 11px ${FONT_FAMILY}`
const TAG_FONT = `600 11px ${FONT_FAMILY}`
// A bubble's box as overlay.css draws it: text width, padding, line heights.
const BUBBLE_TEXT_MAX_PX = 200
const BUBBLE_PAD_X_PX = 8
const BUBBLE_PAD_Y_PX = 5
const BUBBLE_LINE_PX = 16
const FOOTER_LINE_PX = 15
const ACTION_ROW_PX = 22
const ACTION_GAP_PX = 10
const TAG_PAD_X_PX = 6
const TAG_H_PX = 18
const TAG_GAP_PX = 2
// How far a bubble keeps from its speaker, and from anything else on screen.
const BUBBLE_GAP_PX = 6
const HIT_GAP_PX = 3
// Above the speaker the bubble slides sideways in steps of this share of its width, but always
// spans the speaker's centre by this much.
const SHIFT_STEPS = [0, -1, 1, -2, 2] as const
const SHIFT_STEP = 0.45
const SPAN_PX = 8
const TAIL_INSET_PX = 8
const PRIORITY: Readonly<Record<BubbleKind, number>> = Object.freeze({
  wait: 0,
  say: 1,
  think: 2,
  life: 3,
  due: 4,
} satisfies Record<BubbleKind, number>)

type Sized<T> = T & Size

/** Where a bubble sits: `side` is where it stands from its speaker, `tailX` where its tail meets
 *  it, from the bubble's left edge. */
export interface Placed {
  readonly bubble: Bubble
  readonly rect: Rect
  readonly side: 'above' | 'beside' | 'below'
  readonly tailX: number
}

/** The label of what the pointer is over, at the box of the thing it names. */
interface HoverLabel {
  readonly anchor: Rect
  readonly size: Size
}

/** Every box in screen px: `fixed` what no bubble may cover (boards, room tags, markers, lit
 *  screens), `tags` the placed name tags, `actors` each person's figure. */
interface LayoutInput {
  readonly bubbles: readonly Sized<Bubble>[]
  readonly fixed: readonly Rect[]
  readonly tags: readonly Rect[]
  readonly hover?: HoverLabel
  readonly rooms: ReadonlyMap<RoomId, Rect>
  readonly actors: ReadonlyMap<ActorId, Rect>
}

interface Layout {
  readonly placed: readonly Placed[]
  readonly hidden: readonly ActorId[]
  readonly hover?: Rect
}

interface Candidate {
  readonly rect: Rect
  readonly side: Placed['side']
}

/** A tag to place: its person and size; a forced one (the selected person's) shows even where
 *  it overlaps. */
interface TagAsk {
  readonly actor: ActorId
  readonly size: Size
  readonly isForced: boolean
}

const widths = new Map<string, number>()
let measurer: CanvasRenderingContext2D | null | undefined

/** Places the hover label first, then bubbles by priority and by where their speaker stands
 *  (top first, then left), at most `MAX_BUBBLES`, each inside its speaker's room and clear of
 *  everything placed before it. A bubble with no free place is hidden. */
export function layoutOverlay(input: LayoutInput): Layout {
  const hover = input.hover === undefined ? undefined : placeHover(input.hover, input.fixed)
  const taken: Rect[] = [...input.fixed, ...input.tags, ...(hover === undefined ? [] : [hover])]
  const placed: Placed[] = []
  const hidden: ActorId[] = []

  for (const bubble of sortBubbles(input.bubbles, input.actors)) {
    const speaker = input.actors.get(bubble.actor)
    const room = speaker === undefined ? undefined : roomOf(speaker, input.rooms)
    const spot =
      speaker === undefined || placed.length >= MAX_BUBBLES
        ? undefined
        : candidatesOf(bubble, { speaker, room }).find((at) => !isTaken(at.rect, taken))

    if (speaker === undefined || spot === undefined) {
      hidden.push(bubble.actor)
      continue
    }

    placed.push({ bubble, ...spot, tailX: tailOf(spot.rect, speaker) })
    taken.push(spot.rect)
  }

  return hover === undefined ? { placed, hidden } : { placed, hidden, hover }
}

/** Name tags under their person's feet, the forced first; one that would cover anything already
 *  placed stays hidden. */
export function layoutTags(
  asks: readonly TagAsk[],
  input: { readonly actors: ReadonlyMap<ActorId, Rect>; readonly taken: readonly Rect[] }
): ReadonlyMap<ActorId, Rect> {
  const taken = [...input.taken]
  const placed = new Map<ActorId, Rect>()

  for (const ask of [...asks].sort((a, b) => Number(b.isForced) - Number(a.isForced))) {
    const figure = input.actors.get(ask.actor)
    const rect = figure === undefined ? undefined : tagRectOf(figure, ask.size)

    if (rect !== undefined && (ask.isForced || !isTaken(rect, taken))) {
      placed.set(ask.actor, rect)
      taken.push(rect)
    }
  }

  return placed
}

/** A bubble's box from its text: one line, or two when it is wider than a bubble; a row for the
 *  footer and one for its buttons. */
export function sizeBubble(bubble: Bubble, actions: readonly string[]): Sized<Bubble> {
  const textW = measure(bubble.text, BUBBLE_FONT)
  const footerW = bubble.footer === undefined ? 0 : measure(bubble.footer, FOOTER_FONT)
  const actionW = actions.reduce(
    (sum, label, index) => sum + measure(label, FOOTER_FONT) + (index > 0 ? ACTION_GAP_PX : 0),
    0
  )
  const lines = textW > BUBBLE_TEXT_MAX_PX ? 2 : 1
  const innerW = Math.min(BUBBLE_TEXT_MAX_PX, Math.max(textW, footerW, actionW))
  const h =
    lines * BUBBLE_LINE_PX +
    (bubble.footer === undefined ? 0 : FOOTER_LINE_PX) +
    (actions.length === 0 ? 0 : ACTION_ROW_PX)

  return { ...bubble, w: Math.ceil(innerW) + BUBBLE_PAD_X_PX * 2, h: h + BUBBLE_PAD_Y_PX * 2 }
}

export function sizeTag(text: string): Size {
  return { w: Math.ceil(measure(text, TAG_FONT)) + TAG_PAD_X_PX * 2, h: TAG_H_PX }
}

/** Empties the width cache and lets its canvas go; the next measure makes a new one. */
export function releaseMeasure(): void {
  widths.clear()
  measurer = undefined
}

/** True when two boxes come within `HIT_GAP_PX` of each other. */
function isOverlapping(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w + HIT_GAP_PX &&
    b.x < a.x + a.w + HIT_GAP_PX &&
    a.y < b.y + b.h + HIT_GAP_PX &&
    b.y < a.y + a.h + HIT_GAP_PX
  )
}

// The first of right, left, below and above that covers nothing fixed; else to the right.
function placeHover(hover: HoverLabel, fixed: readonly Rect[]): Rect {
  const { anchor, size } = hover
  const midY = anchor.y + anchor.h / 2 - size.h / 2
  const midX = anchor.x + anchor.w / 2 - size.w / 2
  const spots: Rect[] = [
    { x: anchor.x + anchor.w + BUBBLE_GAP_PX, y: midY, ...size },
    { x: anchor.x - BUBBLE_GAP_PX - size.w, y: midY, ...size },
    { x: midX, y: anchor.y + anchor.h + BUBBLE_GAP_PX, ...size },
    { x: midX, y: anchor.y - BUBBLE_GAP_PX - size.h, ...size },
  ]
  const free = spots.find((spot) => !isTaken(spot, fixed))

  return free ?? { x: anchor.x + anchor.w + BUBBLE_GAP_PX, y: midY, ...size }
}

function sortBubbles(
  bubbles: readonly Sized<Bubble>[],
  actors: ReadonlyMap<ActorId, Rect>
): Sized<Bubble>[] {
  const yOf = (bubble: Bubble): number => actors.get(bubble.actor)?.y ?? 0
  const xOf = (bubble: Bubble): number => actors.get(bubble.actor)?.x ?? 0

  return [...bubbles].sort(
    (a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || yOf(a) - yOf(b) || xOf(a) - xOf(b)
  )
}

// The room the speaker's feet stand in.
function roomOf(speaker: Rect, rooms: ReadonlyMap<RoomId, Rect>): Rect | undefined {
  const x = speaker.x + speaker.w / 2
  const y = speaker.y + speaker.h

  return [...rooms.values()].find(
    (room) => x >= room.x && x <= room.x + room.w && y >= room.y && y <= room.y + room.h
  )
}

interface Around {
  readonly speaker: Rect
  readonly room: Rect | undefined
}

// Above (sliding sideways, still over the speaker), beside on the right then the left, below;
// each clipped into the room.
function candidatesOf(size: Size, around: Around): Candidate[] {
  const { speaker, room } = around
  const centerX = speaker.x + speaker.w / 2
  const midY = speaker.y + speaker.h / 2 - size.h / 2
  const above = SHIFT_STEPS.map((step) => ({
    rect: clip(
      {
        x: centerX - size.w / 2 + step * SHIFT_STEP * size.w,
        y: speaker.y - size.h - BUBBLE_GAP_PX,
        ...size,
      },
      room
    ),
    side: 'above' as const,
  })).filter(({ rect }) => rect.x <= centerX - SPAN_PX && rect.x + rect.w >= centerX + SPAN_PX)
  const rest: Candidate[] = [
    { rect: { x: speaker.x + speaker.w + BUBBLE_GAP_PX, y: midY, ...size }, side: 'beside' },
    { rect: { x: speaker.x - BUBBLE_GAP_PX - size.w, y: midY, ...size }, side: 'beside' },
    {
      rect: { x: centerX - size.w / 2, y: speaker.y + speaker.h + BUBBLE_GAP_PX, ...size },
      side: 'below',
    },
  ]

  return [...above, ...rest.map((spot) => ({ ...spot, rect: clip(spot.rect, room) }))]
}

function clip(rect: Rect, room: Rect | undefined): Rect {
  if (room === undefined) {
    return rect
  }

  const x = Math.max(room.x, Math.min(room.x + room.w - rect.w, rect.x))
  const y = Math.max(room.y, Math.min(room.y + room.h - rect.h, rect.y))

  return { ...rect, x, y }
}

function tailOf(rect: Rect, speaker: Rect): number {
  const centerX = speaker.x + speaker.w / 2

  return Math.min(rect.w - TAIL_INSET_PX, Math.max(TAIL_INSET_PX, centerX - rect.x))
}

function tagRectOf(figure: Rect, size: Size): Rect {
  return {
    x: figure.x + figure.w / 2 - size.w / 2,
    y: figure.y + figure.h + TAG_GAP_PX,
    ...size,
  }
}

function isTaken(rect: Rect, taken: readonly Rect[]): boolean {
  return taken.some((held) => isOverlapping(rect, held))
}

// One offscreen context measures every width, cached by font and text; a page that cannot make
// one measures nothing, so every box takes its smallest size.
function measure(text: string, font: string): number {
  const key = `${font}|${text}`
  const held = widths.get(key)

  if (held !== undefined) {
    return held
  }

  if (measurer === undefined) {
    measurer = document.createElement('canvas').getContext('2d')
  }

  if (measurer === null) {
    return 0
  }

  measurer.font = font

  const width = measurer.measureText(text).width

  setCapped(widths, [key, width], MAX_MEASURE_CACHE)

  return width
}
