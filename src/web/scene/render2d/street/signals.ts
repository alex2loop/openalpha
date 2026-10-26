import type { PaintPart, StreetMinute } from '@/web/scene/render2d/street/paint'
import type { Point, SignalHeadId, SignalLamp, StreetView } from '@/web/scene/types'
import type { RegionPack } from '@/web/scene/world/regions'
import { darknessOf } from '@/web/scene/render2d/street/city'
import { GROUND_TONES } from '@/web/scene/render2d/street/city-ground'
import { FURNITURE, paintSigns, paintTurnPlate } from '@/web/scene/render2d/street/signs'
import { mixTone, NIGHT_TONE } from '@/web/scene/render2d/street/tone'
import { type Flow, flowsOf } from '@/web/scene/sim/street/flows'
import { isInside } from '@/web/scene/world/rooms'
import { CROSSING, JUNCTION, NORTH } from '@/web/scene/world/street-layout'

const HEAD_KERB_PX = 2
const JUNCTION_HEAD_Y = NORTH.roadBottom + 6
// The heads face the cars a little before their stop line, on the far kerb.
const NORTH_HEAD_BACK = 1
const WALK_HEAD_X = 6.4
const ZEBRA_PITCH = 1.2
const ZEBRA_BAR = 0.6
const LINE_W = 0.6
// A head's parts, up from its foot: a car head's pole, lamp box and countdown box with its three
// lamps; a walk head's pole, box, countdown box and its two lamps.
const CAR_HEAD = Object.freeze({
  pole: 7.2,
  box: [-1.5, -11.7, 3, 4.5],
  count: [-1.9, -14.1, 3.8, 2.2],
  lamps: { red: -10.7, amber: -9.45, green: -8.2 },
  lampR: 0.5,
} as const)
const WALK_HEAD = Object.freeze({
  pole: 3.8,
  box: [-1.7, -10.4, 3.4, 6.6],
  count: [-1.45, -10.1, 2.9, 1.9],
  lamps: { red: -6.9, walk: -4.9 },
  lampR: 0.78,
} as const)
const LAMP_ON: Readonly<Record<'red' | 'amber' | 'green', string>> = Object.freeze({
  red: '#FF4D3D',
  amber: '#FFC53D',
  green: '#3DD67A',
})
// The lamp each state lights, and where it sits on its head.
const CAR_LIT = Object.freeze({
  red: { colour: LAMP_ON.red, y: CAR_HEAD.lamps.red },
  amber: { colour: LAMP_ON.amber, y: CAR_HEAD.lamps.amber },
  green: { colour: LAMP_ON.green, y: CAR_HEAD.lamps.green },
})
const WALK_LIT = Object.freeze({
  red: { colour: LAMP_ON.red, y: WALK_HEAD.lamps.red },
  walk: { colour: LAMP_ON.green, y: WALK_HEAD.lamps.walk },
})
const LAMP_OFF = '#3A2F33'
const HOUSING = '#1E2128'
const COUNT_BOX = '#12141A'
const POLE = '#5B6070'
const GLOW_ALPHA = 0.3
const GLOW_R = 1.6
// A seven-segment digit: each segment's x, y, w, h in a 0.9 by 1.6 cell, and the segments each
// figure lights (a to g).
const SEGMENTS = [
  [0, 0, 0.9, 0.2],
  [0.7, 0, 0.2, 0.8],
  [0.7, 0.7, 0.2, 0.8],
  [0, 1.4, 0.9, 0.2],
  [0, 0.7, 0.2, 0.8],
  [0, 0, 0.2, 0.8],
  [0, 0.7, 0.9, 0.2],
] as const
const DIGITS = [
  0b1111110, 0b0110000, 0b1101101, 0b1111001, 0b0110011, 0b1011011, 0b1011111, 0b1110000, 0b1111111,
  0b1111011,
] as const
const DIGIT_W = 0.9
const DIGIT_H = 1.6
const DIGIT_GAP = 0.2
const DIGIT_SCALE = 0.85
const MAX_SHOWN_SECONDS = 99

type HeadKind = 'car' | 'walk'

interface Head {
  readonly head: SignalHeadId
  readonly kind: HeadKind
  readonly at: Point
}

/** The crossing, the stop lines, the signal heads with their countdowns, the road signs and the
 *  main street's name plates. The lit lamps and the digits follow the street's step. */
export const SIGNALS_PART: PaintPart = {
  paintStatic: (g, pack, minute) => {
    const dark = darknessOf(minute.minute) * FURNITURE.night
    const flows = flowsOf(pack)

    paintCrossing(g, { flows: flows.all, dark })

    for (const head of headsOf(pack)) {
      paintHousing(g, head, dark)
    }

    if (pack.road.turnSign) {
      for (const flow of flows.north) {
        paintTurnPlate(g, northHeadOf(flow).at, dark)
      }
    }

    paintSigns(g, { pack, minute, dark })
  },
  paintMoving: (g, view, scene) => {
    for (const head of headsOf(scene.pack)) {
      if (isInside(scene.rect, head.at)) {
        paintLamps(g, { head, view, detail: scene.minute.detail })
      }
    }
  },
}

// The heads of each pack's road, built once per pack.
const HEADS_BY_PACK = new WeakMap<RegionPack, readonly Head[]>()

function headsOf(pack: RegionPack): readonly Head[] {
  const held = HEADS_BY_PACK.get(pack)

  if (held !== undefined) {
    return held
  }

  const heads = buildHeads(flowsOf(pack).all)

  HEADS_BY_PACK.set(pack, heads)

  return heads
}

function buildHeads(flows: readonly Flow[]): readonly Head[] {
  const heads: Head[] = []

  for (const flow of flows) {
    if (flow.street === 'north') {
      heads.push(northHeadOf(flow))
    } else if (flow.dir < 0) {
      heads.push({
        head: 'side',
        kind: 'car',
        at: { x: flow.line + flow.halfWidth + HEAD_KERB_PX, y: JUNCTION_HEAD_Y },
      })
    }
  }

  for (const y of [FURNITURE.farY, FURNITURE.nearY]) {
    for (const side of [-1, 1]) {
      heads.push({ head: 'walk', kind: 'walk', at: { x: CROSSING.x + side * WALK_HEAD_X, y } })
    }
  }

  return heads
}

function northHeadOf(flow: Flow): Head {
  const x = CROSSING.x - flow.dir * (CROSSING.carLine - NORTH_HEAD_BACK)

  return { head: 'north', kind: 'car', at: { x, y: FURNITURE.farY } }
}

// The zebra across the north street, each way's stop line before it, and each side street's
// stop line before the junction.
function paintCrossing(
  g: CanvasRenderingContext2D,
  at: { readonly flows: readonly Flow[]; readonly dark: number }
): void {
  g.fillStyle = mixTone(GROUND_TONES.line.day, GROUND_TONES.line.night, at.dark)

  for (let y = NORTH.roadTop + ZEBRA_BAR; y < NORTH.roadBottom - ZEBRA_BAR; y += ZEBRA_PITCH) {
    g.fillRect(CROSSING.x - CROSSING.halfWidth, y, CROSSING.halfWidth * 2, ZEBRA_BAR)
  }

  for (const flow of at.flows) {
    if (flow.street === 'north') {
      const x = CROSSING.x - flow.dir * CROSSING.carLine

      g.fillRect(x - LINE_W / 2, flow.line - flow.halfWidth, LINE_W, flow.halfWidth * 2)
    } else if (flow.dir < 0) {
      const y = NORTH.roadBottom + JUNCTION.gap + JUNCTION.stopLine

      g.fillRect(flow.line - flow.halfWidth, y, flow.halfWidth * 2, LINE_W)
    }
  }
}

function paintHousing(g: CanvasRenderingContext2D, head: Head, dark: number): void {
  const spec = head.kind === 'car' ? CAR_HEAD : WALK_HEAD
  const { x, y } = head.at
  const tone = (hex: string): string => mixTone(hex, NIGHT_TONE, dark)

  g.fillStyle = tone(POLE)
  g.fillRect(x - 0.3, y - spec.pole, 0.6, spec.pole)
  g.fillStyle = tone(HOUSING)
  g.fillRect(x + spec.box[0], y + spec.box[1], spec.box[2], spec.box[3])
  g.fillStyle = tone(COUNT_BOX)
  g.fillRect(x + spec.count[0], y + spec.count[1], spec.count[2], spec.count[3])
  g.fillStyle = LAMP_OFF

  for (const lampY of Object.values(spec.lamps)) {
    g.beginPath()
    g.arc(x, y + lampY, spec.lampR, 0, Math.PI * 2)
    g.fill()
  }
}

// The lit lamp with its glow and, from the middle detail up, the seconds left.
function paintLamps(
  g: CanvasRenderingContext2D,
  at: { readonly head: Head; readonly view: StreetView; readonly detail: StreetMinute['detail'] }
): void {
  const { head } = at
  const state = at.view.signals[head.head]
  const lit = litLampOf(head, state.lamp, state.seconds)

  if (lit !== undefined) {
    g.fillStyle = lit.colour
    g.globalAlpha = GLOW_ALPHA
    g.beginPath()
    g.arc(head.at.x, head.at.y + lit.y, GLOW_R, 0, Math.PI * 2)
    g.fill()
    g.globalAlpha = 1
    g.beginPath()
    g.arc(
      head.at.x,
      head.at.y + lit.y,
      (head.kind === 'car' ? CAR_HEAD : WALK_HEAD).lampR,
      0,
      Math.PI * 2
    )
    g.fill()
  }

  if (at.detail > 0) {
    const box = (head.kind === 'car' ? CAR_HEAD : WALK_HEAD).count
    const colour = lit?.colour ?? LAMP_ON.red

    paintSeconds(g, {
      seconds: state.seconds,
      x: head.at.x,
      y: head.at.y + box[1] + box[3] / 2,
      colour,
    })
  }
}

// Which lamp of the head is on: a flashing walk lamp blinks with the seconds.
function litLampOf(
  head: Head,
  lamp: SignalLamp,
  seconds: number
): { readonly colour: string; readonly y: number } | undefined {
  if (head.kind === 'car') {
    return lamp === 'amber' || lamp === 'green' ? CAR_LIT[lamp] : CAR_LIT.red
  }

  if (lamp === 'red') {
    return WALK_LIT.red
  }

  return lamp === 'walk' || seconds % 2 === 0 ? WALK_LIT.walk : undefined
}

function paintSeconds(
  g: CanvasRenderingContext2D,
  at: { readonly seconds: number; readonly x: number; readonly y: number; readonly colour: string }
): void {
  const shown = Math.min(MAX_SHOWN_SECONDS, at.seconds)
  const w = DIGIT_W * DIGIT_SCALE
  const top = at.y - (DIGIT_H * DIGIT_SCALE) / 2

  g.fillStyle = at.colour
  paintDigit(g, { digit: Math.floor(shown / 10), x: at.x - w - DIGIT_GAP / 2, y: top })
  paintDigit(g, { digit: shown % 10, x: at.x + DIGIT_GAP / 2, y: top })
}

function paintDigit(
  g: CanvasRenderingContext2D,
  at: { readonly digit: number; readonly x: number; readonly y: number }
): void {
  const lit = DIGITS[at.digit] ?? 0

  for (const [index, segment] of SEGMENTS.entries()) {
    if ((lit >> (SEGMENTS.length - 1 - index)) & 1) {
      g.fillRect(
        at.x + segment[0] * DIGIT_SCALE,
        at.y + segment[1] * DIGIT_SCALE,
        segment[2] * DIGIT_SCALE,
        segment[3] * DIGIT_SCALE
      )
    }
  }
}
