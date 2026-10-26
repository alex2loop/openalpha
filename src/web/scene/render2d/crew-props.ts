import type { AmbientFx } from '@/web/scene/render2d/ambient-fx'
import type { Painter, PaintScene } from '@/web/scene/render2d/wall-props'
import type { FloorId, LifeView, LiftView, Point } from '@/web/scene/types'
import type { PropDef, PropKind } from '@/web/scene/world/props'
import { castShadow, drawBlock, fill, framed, INK } from '@/web/scene/render2d/building'
import { paintBin } from '@/web/scene/render2d/desk-devices'
import { FONT } from '@/web/scene/sprites/face-text'
import { LIFT_LAMP_FLOORS, LIFT_LEAF_SLIDE } from '@/web/scene/sprites/lift-look'
import { DARKWOOD, METAL, PROP_TONES, WOOD } from '@/web/scene/sprites/palette'
import { paintPixelText } from '@/web/scene/sprites/pixel-font'
import { GROUND_FLOOR } from '@/web/scene/world/floors'
import { tr } from '@/web/text/tr'

const SIGN_TIE = 1
// The plaque hangs this far down the front desk; its text is centred on it, squeezed to fit.
const PLAQUE_DROP = 14
const PLAQUE_TEXT_DROP = 3.2
const PLAQUE_FONT_PX = 3.6
const PLAQUE_TEXT_W = 13
// A lift leaf's width while the doors are shut, and how far the floor panel sits over the frame.
const LIFT_LEAF_PX = 10
const LIFT_PANEL_RISE = 7
const LIFT_BLINK_MS = 400
const LIFT_ARROW_ROWS = 3
const CREW_TONES = Object.freeze({
  page: '#FBF9F3',
  pageInk: '#8E8497',
  monitorEdge: '#5C6474',
  bellShine: '#F0C968',
  plaque: '#F7F3EA',
  cabinEdge: '#7A5E3E',
  cabinWall: '#E9D3A2',
  cabinRail: '#B9A98A',
  leafShine: '#E4E9F0',
  leafSeam: '#9AA3B2',
  sill: 'rgba(43,36,51,.22)',
  digitOff: '#5A5F78',
})

/** The front desk with its monitor, bell and plaque, the bins, and the badge gates. */
export const CREW_PAINTERS = Object.freeze({
  'guest-desk': paintFrontDesk,
  bin: (g, p) => paintBin(g, p.draw.x, p.draw.y),
  'gate-post': paintGatePost,
  podium: paintPodium,
  'lift-door': paintLiftDoor,
} satisfies Partial<Record<PropKind, Painter>>)

// The mockup's front desk: the notepad on top, the receptionist's monitor with its back to us, the
// bell, and the plaque on the front.
function paintFrontDesk(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w } = prop.draw
  const cx = x + w / 2
  const plaqueY = y + PLAQUE_DROP

  drawBlock(g, [x, y, w, 10], { front: 13, tones: WOOD })
  fill(g, [x + 2, y + 2, 5, 4], CREW_TONES.page)
  fill(g, [x + 3, y + 3, 3, 1], CREW_TONES.pageInk)
  fill(g, [x + 1, y + 2, 11, 9], INK)
  fill(g, [x + 2, y + 3, 9, 6], PROP_TONES.screenOff)
  fill(g, [x + 2, y + 3, 9, 1], CREW_TONES.monitorEdge)
  fill(g, [x + 5, y + 9, 3, 2], CREW_TONES.monitorEdge)
  fill(g, [x + 12, y + 4, 5, 4], INK)
  fill(g, [x + 13, y + 5, 3, 2], PROP_TONES.bell)
  fill(g, [x + 13, y + 5, 3, 1], CREW_TONES.bellShine)
  fill(g, [cx - 8, plaqueY, 16, 6], INK)
  fill(g, [cx - 7, plaqueY + 1, 14, 4], CREW_TONES.plaque)
  g.fillStyle = INK
  g.font = `700 ${PLAQUE_FONT_PX}px ${FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(tr('ui.office.crew.plaque'), cx, plaqueY + PLAQUE_TEXT_DROP, PLAQUE_TEXT_W)
}

// A pedestal with its reader lamp, and the glass flap turned toward the lane beside it.
function paintGatePost(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w, h } = prop.draw

  drawBlock(g, [x, y, w, 3], { front: h - 3, tones: METAL })
  fill(g, [x + 2, y + 1, 2, 1], PROP_TONES.callLamp)
  fill(g, [x + w, y + 5, 1, h - 7], PROP_TONES.gate[0])
}

function paintPodium(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w, h } = prop.draw

  drawBlock(g, [x, y, w, 5], { front: h - 5, tones: DARKWOOD })
  fill(g, [x + 1, y + 1, w - 2, 2], PROP_TONES.screenStandby)
}

// The mockup's lift front: the frame, the lit cabin behind two leaves that slide apart while the car
// stands open here, and the panel above with a digit per floor, lit where the car is, and the call
// dot while this floor waits.
function paintLiftDoor(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  const { x, y, w, h } = prop.draw
  const { lift } = scene
  const open = lift.floor === prop.floor ? lift.doors : 0
  const leaf = Math.round(LIFT_LEAF_PX * (1 - open * LIFT_LEAF_SLIDE))
  const top = y + 2
  const cabin = h - 2

  fill(g, [x - 1, y - 1, w + 2, h + 1], INK)
  fill(g, [x, y, w, h], PROP_TONES.liftFrame)
  fill(g, [x + 2, top, w - 4, cabin], CREW_TONES.cabinEdge)
  fill(g, [x + 3, top + 2, w - 6, cabin - 4], CREW_TONES.cabinWall)
  fill(g, [x + 3, top + 19, w - 6, 1], CREW_TONES.cabinRail)

  for (const left of [x + 2, x + w - 2 - leaf]) {
    const isLeft = left === x + 2

    fill(g, [left, top, leaf, cabin], PROP_TONES.liftLeaf)
    fill(g, [isLeft ? left : x + w - 3, top, 1, cabin], CREW_TONES.leafShine)
    fill(g, [isLeft ? left + leaf - 1 : left, top, 1, cabin], CREW_TONES.leafSeam)
  }

  fill(g, [x + 2, top + cabin - 1, w - 4, 1], CREW_TONES.sill)
  paintLiftPanel(g, { x, y: y - LIFT_PANEL_RISE, w, floor: prop.floor, lift, fx: scene.fx })
}

function paintLiftPanel(
  g: CanvasRenderingContext2D,
  at: {
    readonly x: number
    readonly y: number
    readonly w: number
    readonly floor: FloorId
    readonly lift: LiftView
    readonly fx: AmbientFx | undefined
  }
): void {
  const { x, y, w, lift } = at
  const cx = x + w / 2

  fill(g, [x + 3, y, w - 6, 7], INK)
  fill(g, [x + 4, y + 1, w - 8, 5], PROP_TONES.liftPanel)

  LIFT_LAMP_FLOORS.forEach((floor, i) => {
    paintPixelText(g, tr(`ui.office.crew.liftFloor.${floor}`), {
      x: i === 0 ? x + 5 : x + w - 8,
      y: y + 1,
      color: floor === lift.floor ? PROP_TONES.liftLamp[1] : CREW_TONES.digitOff,
    })
  })

  // While the car rides its arrow blinks on the ambient clock, steady under reduced motion; else
  // the call dot shows while this floor waits.
  if (lift.direction !== 'still') {
    if (at.fx === undefined || Math.floor(at.fx.ms / LIFT_BLINK_MS) % 2 === 0) {
      paintLiftArrow(g, { cx, y, isUp: lift.direction === 'up' })
    }
  } else if (lift.called.includes(at.floor)) {
    fill(g, [cx - 1, y + 2, 3, 3], PROP_TONES.liftLamp[1])
    fill(g, [cx, y + 3, 1, 1], PROP_TONES.liftPanel)
  }
}

function paintLiftArrow(
  g: CanvasRenderingContext2D,
  at: { readonly cx: number; readonly y: number; readonly isUp: boolean }
): void {
  for (let row = 0; row < LIFT_ARROW_ROWS; row++) {
    const half = at.isUp ? row : LIFT_ARROW_ROWS - 1 - row

    fill(g, [at.cx - half, at.y + 2 + row, 2 * half + 1, 1], PROP_TONES.liftLamp[1])
  }
}

/** The wet-floor sign and its bucket, sorted among the people while the cleaner mops. */
export function signPiecesOf(
  g: CanvasRenderingContext2D,
  at: { readonly life: LifeView; readonly floor: FloorId }
): { readonly sortY: number; readonly tie: number; readonly draw: () => void }[] {
  const sign = at.life.wetSign

  return sign === undefined || at.floor !== GROUND_FLOOR
    ? []
    : [{ sortY: sign.y, tie: SIGN_TIE, draw: () => paintWetSign(g, sign) }]
}

function paintWetSign(g: CanvasRenderingContext2D, at: Point): void {
  const x = Math.round(at.x)
  const y = Math.round(at.y)

  castShadow(g, [x - 3, y, 16, 2])
  framed(g, [x - 3, y - 10, 7, 10], PROP_TONES.wetSign)
  fill(g, [x, y - 8, 1, 4], INK)
  fill(g, [x, y - 3, 1, 1], INK)
  framed(g, [x + 6, y - 5, 5, 5], PROP_TONES.bucket)
  fill(g, [x + 6, y - 5, 5, 1], METAL[0])
}
