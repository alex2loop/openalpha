import type { MovingScene } from '@/web/scene/render2d/street/paint'
import type { VendorView } from '@/web/scene/street-types'
import { darknessOf } from '@/web/scene/render2d/street/city'
import { drawHeldSprite, drawSprite } from '@/web/scene/render2d/street/detail'
import { shadeOf } from '@/web/scene/render2d/street/park-props'
import { heldKeyOf, SPRITE_PX } from '@/web/scene/render2d/street/sprite-key'
import { DARK_STEPS } from '@/web/scene/render2d/street/tone'

const TONES = Object.freeze({
  shadow: 'rgba(0,0,0,.15)',
  bike: '#3A5A8A',
  tyre: '#222633',
  rack: '#8A6B3E',
  leaves: '#4E9A5E',
  flowers: ['#E8648F', '#D8453B', '#F2C94C', '#F6F2EA', '#9C6BC0', '#F28C4A'],
  hat: '#E6D3A0',
  shirt: '#E8B4C4',
  skin: '#D9AE86',
  trousers: '#4A4F66',
})
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
] as const

/** The flower seller's bicycle at the kerb: a rack heaped with flowers behind, the seller in a
 *  conical hat, the pedal turning as it rides. */
export function drawFlowerBike(
  g: CanvasRenderingContext2D,
  bike: NonNullable<VendorView['bike']>,
  scene: MovingScene
): void {
  const detail = scene.minute.detail
  const darkStep = Math.round(darknessOf(scene.minute.minute) * DARK_STEPS)
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
      paintBike(sprite, { frame: bike.frame, facing: bike.facing, dark: darkStep / DARK_STEPS })
  )
}

function paintBike(
  g: CanvasRenderingContext2D,
  at: { readonly frame: number; readonly facing: -1 | 1; readonly dark: number }
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
  g.stroke()
  paintLoad(g, tone)
  paintRider(g, { tone, frame: at.frame })
}

// The rack behind the saddle, heaped with bunches of flowers.
function paintLoad(g: CanvasRenderingContext2D, tone: (hex: string) => string): void {
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
}

// The seller on the saddle in a conical hat, one leg on the turning pedal.
function paintRider(
  g: CanvasRenderingContext2D,
  at: { readonly tone: (hex: string) => string; readonly frame: number }
): void {
  const { tone } = at

  g.fillStyle = tone(TONES.trousers)
  g.fillRect(-0.3 + (at.frame > 0 ? 0.5 : -0.2), -3.4, 0.5, 2)
  g.fillStyle = tone(TONES.shirt)
  g.fillRect(-1.2, -6.1, 1.8, 2.4)
  g.fillStyle = tone(TONES.skin)
  g.beginPath()
  g.arc(-0.3, -6.8, 0.75, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = tone(TONES.hat)
  g.beginPath()
  g.moveTo(-2, -7)
  g.lineTo(-0.3, -8.4)
  g.lineTo(1.4, -7)
  g.closePath()
  g.fill()
}
