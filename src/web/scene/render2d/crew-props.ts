import type { Painter, PaintScene } from '@/web/scene/render2d/wall-props'
import type { FloorId, LifeView, Point } from '@/web/scene/types'
import type { PropDef, PropKind } from '@/web/scene/world/props'
import { castShadow, drawBlock, fill, framed, INK } from '@/web/scene/render2d/building'
import { DARKWOOD, METAL, PALETTE, PROP_TONES, WOOD } from '@/web/scene/sprites/palette'
import { GROUND_FLOOR, TEAM_FLOOR } from '@/web/scene/world/floors'

// The lift's floor lamps, left to right over its doors.
const LAMP_FLOORS: readonly FloorId[] = Object.freeze([GROUND_FLOOR, TEAM_FLOOR])
// Each leaf slides this share of its width into the jamb when open.
const LEAF_SLIDE = 0.85
const SIGN_TIE = 1

/** The front desk with its monitor, bell and plaque, the bins, and the badge gates. */
export const CREW_PAINTERS = Object.freeze({
  'guest-desk': paintFrontDesk,
  bin: paintBin,
  'gate-post': paintGatePost,
  podium: paintPodium,
  'lift-door': paintLiftDoor,
} satisfies Partial<Record<PropKind, Painter>>)

function paintFrontDesk(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w } = prop.draw

  drawBlock(g, [x, y, w, 10], { front: 13, tones: WOOD })
  framed(g, [x + 1, y - 4, 6, 4], PROP_TONES.screenOff)
  fill(g, [x + 3, y, 2, 2], INK)
  fill(g, [x + 12, y + 4, 3, 2], PROP_TONES.bell)
  fill(g, [x + 13, y + 3, 1, 1], PROP_TONES.bell)
  framed(g, [x + 5, y + 13, 8, 3], PALETTE.paper)
}

function paintBin(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w, h } = prop.draw

  castShadow(g, [x + 1, y + h, w, 2])
  framed(g, [x, y + 1, w, h - 1], PROP_TONES.bin)
  fill(g, [x, y + 1, w, 1], METAL[0])
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

// The frame, the cabin behind leaves that slide apart while the car stands open here, and the
// panel above: a lamp per floor lit where the car is, the call lamp while this floor waits.
function paintLiftDoor(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  const { x, y, w, h } = prop.draw
  const { lift } = scene
  const open = lift.floor === prop.floor ? lift.doors : 0
  const leaf = Math.round(((w - 4) / 2) * (1 - open * LEAF_SLIDE))

  framed(g, [x, y, w, h], PROP_TONES.liftFrame)
  fill(g, [x + 2, y + 2, w - 4, h - 2], PROP_TONES.liftCabin)
  fill(g, [x + 2, y + 2, leaf, h - 2], PROP_TONES.liftLeaf)
  fill(g, [x + w - 2 - leaf, y + 2, leaf, h - 2], PROP_TONES.liftLeaf)

  if (open === 0) {
    fill(g, [x + w / 2, y + 2, 1, h - 2], METAL[1])
  }

  framed(g, [x + 3, y - 8, w - 6, 5], PROP_TONES.liftPanel)

  LAMP_FLOORS.forEach((floor, i) => {
    const tone = PROP_TONES.liftLamp[floor === lift.floor ? 1 : 0]

    fill(g, [x + 5 + i * (w - 13), y - 7, 3, 3], tone)
  })

  if (lift.called.includes(prop.floor)) {
    fill(g, [x + w / 2 - 1, y - 7, 2, 3], PROP_TONES.callLamp)
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
