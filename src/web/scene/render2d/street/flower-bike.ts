import type { MovingScene } from '@/web/scene/render2d/street/paint'
import type { VendorView } from '@/web/scene/street-types'
import { drawHeldSprite, drawSprite } from '@/web/scene/render2d/street/detail'
import { shadeOf } from '@/web/scene/render2d/street/park-props'
import { heldKeyOf, SPRITE_PX } from '@/web/scene/render2d/street/sprite-key'
import { DARK_STEPS, mixTone } from '@/web/scene/render2d/street/tone'

const TONES = Object.freeze({
  shadow: 'rgba(0,0,0,.15)',
  bike: '#3A5A8A',
  tyre: '#222633',
  rack: '#8A6B3E',
  leaves: '#4E9A5E',
  flowers: ['#E8648F', '#D8453B', '#F2C94C', '#F6F2EA', '#9C6BC0', '#F28C4A'],
  spoke: '#B8BEC9',
  saddle: '#2A2D36',
  centre: '#F2C94C',
  hat: '#DCC896',
  shirt: '#E8B4C4',
  sleeve: '#000000',
  skin: '#D9AE86',
  trousers: '#4A4F66',
  shoe: '#1F2230',
  eye: '#2B2433',
})
// The seller sits on the saddle, this far back and up from the bike's middle.
const SEAT_AT = Object.freeze({ x: -0.7, y: -1.5 })
const SLEEVE_SHADE = 0.15
// The flower bicycle's sprite: its box about the kerb point, the pedal frames, and its key.
const BIKE_BOX = Object.freeze({ w: 16, h: 12, anchorX: 8, anchorY: 10 })
const BIKE_PREFIX = 'flower-bike'
const BLOOMS = [
  [-5.1, -4.2, 1.2, 0],
  [-3.9, -4.9, 1.35, 1],
  [-2.7, -4.2, 1.2, 2],
  [-4.6, -5.6, 1.1, 3],
  [-3.2, -5.8, 1.15, 4],
  [-5.4, -3.6, 0.9, 5],
  [-2.3, -5, 0.9, 1],
] as const
const CENTRES = [
  [-4.4, -4.8],
  [-3.1, -5.2],
] as const

/** The flower seller's bicycle at the kerb: a rack heaped with flowers behind, the seller in a
 *  conical hat, the pedal turning as it rides. */
export function drawFlowerBike(
  g: CanvasRenderingContext2D,
  bike: NonNullable<VendorView['bike']>,
  scene: MovingScene
): void {
  const detail = scene.minute.detail
  const darkStep = Math.round(scene.minute.light.dark * DARK_STEPS)
  const sig =
    ((darkStep * 2 + bike.frame) * 2 + (bike.facing > 0 ? 1 : 0)) * SPRITE_PX.length + detail
  const held = heldKeyOf(bike, { sig, prefix: BIKE_PREFIX })

  if (drawHeldSprite(g, held.fullKey, bike.at)) {
    return
  }

  drawSprite(
    g,
    {
      key: held.key,
      box: {
        w: BIKE_BOX.w,
        h: BIKE_BOX.h,
        anchor: { x: BIKE_BOX.anchorX, y: BIKE_BOX.anchorY },
        pxPerWorld: SPRITE_PX[detail],
      },
      at: bike.at,
    },
    (sprite) =>
      paintBike(sprite, {
        frame: bike.frame,
        facing: bike.facing,
        dark: darkStep / DARK_STEPS,
        detail,
      })
  )
}

function paintBike(
  g: CanvasRenderingContext2D,
  at: {
    readonly frame: number
    readonly facing: -1 | 1
    readonly dark: number
    readonly detail: number
  }
): void {
  const tone = (hex: string): string => shadeOf(at, hex)

  g.scale(at.facing, 1)
  g.fillStyle = TONES.shadow
  g.beginPath()
  g.ellipse(0, 0.1, 5, 0.7, 0, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = tone(TONES.tyre)
  g.lineWidth = 0.45

  for (const x of [-3, 3]) {
    g.beginPath()
    g.arc(x, -1.4, 1.35, 0, Math.PI * 2)
    g.stroke()
  }

  if (at.detail > 0) {
    paintSpokes(g, { tone, frame: at.frame })
  }

  g.strokeStyle = tone(TONES.bike)
  g.lineWidth = 0.38
  g.beginPath()
  g.moveTo(-3, -1.4)
  g.lineTo(-0.9, -3.5)
  g.lineTo(2.1, -3.5)
  g.lineTo(3, -1.4)
  g.moveTo(-0.9, -3.5)
  g.lineTo(0.3, -1.4)
  g.lineTo(-3, -1.4)
  g.moveTo(2.1, -3.5)
  g.lineTo(2.5, -4.6)
  g.lineTo(3.4, -4.8)
  g.stroke()
  g.fillStyle = tone(TONES.saddle)
  g.fillRect(-1.6, -3.9, 1.6, 0.4)
  paintLoad(g, { tone, detail: at.detail })
  g.save()
  g.translate(SEAT_AT.x, SEAT_AT.y)
  paintSeller(g, { tone, detail: at.detail })
  g.restore()
  paintPedal(g, { tone, frame: at.frame })
}

// Two crossed spokes in each wheel, turned a little on the second pedal frame.
function paintSpokes(
  g: CanvasRenderingContext2D,
  at: { readonly tone: (hex: string) => string; readonly frame: number }
): void {
  const turn = at.frame > 0 ? 0.8 : 0

  g.strokeStyle = at.tone(TONES.spoke)
  g.lineWidth = 0.13
  g.beginPath()

  for (const x of [-3, 3]) {
    for (const angle of [turn, turn + Math.PI / 2]) {
      g.moveTo(x + Math.cos(angle) * 1.2, -1.4 + Math.sin(angle) * 1.2)
      g.lineTo(x - Math.cos(angle) * 1.2, -1.4 - Math.sin(angle) * 1.2)
    }
  }

  g.stroke()
}

// The rack behind the saddle, heaped with bunches of flowers, their yellow hearts close up.
function paintLoad(
  g: CanvasRenderingContext2D,
  at: { readonly tone: (hex: string) => string; readonly detail: number }
): void {
  const { tone } = at

  g.fillStyle = tone(TONES.rack)
  g.fillRect(-5.6, -3.1, 3.6, 0.4)
  g.fillStyle = tone(TONES.leaves)
  g.fillRect(-5.8, -4.4, 3.9, 1.3)

  for (const [x, y, r, colour] of BLOOMS) {
    g.fillStyle = tone(TONES.flowers[colour] ?? TONES.leaves)
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
  }

  if (at.detail > 0) {
    g.fillStyle = tone(TONES.centre)

    for (const [x, y] of CENTRES) {
      g.beginPath()
      g.arc(x, y, 0.25, 0, Math.PI * 2)
      g.fill()
    }
  }
}

// The seller side on, facing the way the bike rides: legs, shirt, the near arm to the bars, the
// head and the conical hat; an eye closest.
function paintSeller(
  g: CanvasRenderingContext2D,
  at: { readonly tone: (hex: string) => string; readonly detail: number }
): void {
  const { tone } = at

  g.fillStyle = tone(TONES.trousers)
  g.fillRect(-0.75, -1.8, 0.65, 1.8)
  g.fillRect(0.1, -1.8, 0.65, 1.8)
  g.fillStyle = tone(TONES.shirt)
  g.fillRect(-0.95, -3.3, 1.9, 1.6)

  if (at.detail > 0) {
    g.strokeStyle = tone(mixTone(TONES.shirt, TONES.sleeve, SLEEVE_SHADE))
    g.lineWidth = 0.55
    g.lineCap = 'round'
    g.beginPath()
    g.moveTo(0, -3.05)
    g.lineTo(0, -1.95)
    g.stroke()
    g.fillStyle = tone(TONES.skin)
    g.fillRect(-0.2, -2.05, 0.4, 0.35)
  }

  g.fillStyle = tone(TONES.skin)
  g.beginPath()
  g.arc(0, -4, 0.85, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = tone(TONES.hat)
  g.beginPath()
  g.moveTo(-1.7, -4.3)
  g.lineTo(0, -5.9)
  g.lineTo(1.7, -4.3)
  g.closePath()
  g.fill()

  if (at.detail === 2) {
    g.fillStyle = tone(TONES.eye)
    g.fillRect(0.35, -4.05, 0.22, 0.22)
  }
}

// The leg on the turning pedal and its shoe.
function paintPedal(
  g: CanvasRenderingContext2D,
  at: { readonly tone: (hex: string) => string; readonly frame: number }
): void {
  const isDown = at.frame > 0

  g.fillStyle = at.tone(TONES.trousers)
  g.fillRect(-0.3 + (isDown ? 0.5 : -0.2), -1.9, 0.5, 1.5)
  g.fillStyle = at.tone(TONES.shoe)
  g.fillRect(-0.1 + (isDown ? 0.6 : -0.2), -0.5, 0.9, 0.3)
}
