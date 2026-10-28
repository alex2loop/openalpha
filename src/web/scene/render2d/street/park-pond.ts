import type { CityScene } from '@/web/scene/render2d/street/city-blocks'
import { ellipse, PARK_TONES, shadeOf } from '@/web/scene/render2d/street/park-props'
import { createRng, seedOf } from '@/web/scene/world/rng'

const POND_TONES = Object.freeze({
  pondTop: '#9AD3DE',
  pondBottom: '#5D9FB8',
  lily: '#4F9A5E',
  lilyFlower: '#F2A0B8',
  reed: '#4F7A45',
  duck: '#F4F1E6',
  drake: '#9B8468',
  drakeHead: '#2E7D5A',
  beak: '#F2A33A',
  koi: ['#F0884A', '#F6F1E8'],
})
// The pond's ducks and koi are placed anew every few page minutes.
const POND_SHIFT_MIN = 6
const POND_SWIMMERS = 3

/** Which of the pond's placings the minute falls in. */
export function pondSlotOf(scene: CityScene): number {
  return Math.floor(scene.minute.clock / POND_SHIFT_MIN)
}

/** The pond: stone coping, water with a soft highlight, lily pads and reeds, and its ducks (koi
 *  under the surface close up), placed anew every few page minutes. */
export function paintPond(
  scene: CityScene,
  pond: { readonly x: number; readonly y: number; readonly rx: number; readonly ry: number }
): void {
  const { g } = scene
  const { x, y, rx, ry } = pond
  const water = g.createLinearGradient(0, y - ry, 0, y + ry)

  ellipse(g, { x, y: y + 1.2, rx: rx + 3.4, ry: ry + 3, colour: PARK_TONES.shadow })
  ellipse(g, { x, y, rx: rx + 2.8, ry: ry + 2.2, colour: shadeOf(scene, PARK_TONES.stone) })
  ellipse(g, {
    x,
    y: y + 0.5,
    rx: rx + 1.1,
    ry: ry + 0.9,
    colour: shadeOf(scene, PARK_TONES.stoneDark),
  })
  water.addColorStop(0, shadeOf(scene, POND_TONES.pondTop))
  water.addColorStop(1, shadeOf(scene, POND_TONES.pondBottom))
  ellipse(g, { x, y, rx, ry, colour: water })
  ellipse(g, {
    x: x - rx * 0.28,
    y: y - ry * 0.38,
    rx: rx * 0.42,
    ry: ry * 0.16,
    colour: PARK_TONES.ripple,
  })

  paintLilies(scene, pond)
  paintReeds(scene, pond)
  paintSwimmers(scene, pond)
}

function paintLilies(
  scene: CityScene,
  pond: { readonly x: number; readonly y: number; readonly rx: number; readonly ry: number }
): void {
  const { g } = scene
  const { x, y, rx, ry } = pond

  for (const [a, b, r] of [
    [0.35, 0.25, 1.6],
    [0.52, 0.42, 1.15],
    [-0.5, 0.32, 1.4],
    [0.08, -0.48, 1.15],
  ] as const) {
    ellipse(g, {
      x: x + rx * a,
      y: y + ry * b,
      rx: r,
      ry: r * 0.55,
      colour: shadeOf(scene, POND_TONES.lily),
    })

    if (scene.minute.detail >= 1) {
      ellipse(g, {
        x: x + rx * a + 0.3,
        y: y + ry * b - 0.35,
        rx: 0.45,
        ry: 0.35,
        colour: shadeOf(scene, POND_TONES.lilyFlower),
      })
    }
  }
}

function paintReeds(
  scene: CityScene,
  pond: { readonly x: number; readonly y: number; readonly rx: number; readonly ry: number }
): void {
  const { g } = scene

  g.strokeStyle = shadeOf(scene, POND_TONES.reed)
  g.lineWidth = 0.35
  g.beginPath()

  for (let index = 0; index < 7; index++) {
    const x = pond.x + pond.rx * (0.5 + index * 0.065)
    const y = pond.y - pond.ry * (0.82 - index * 0.07)

    g.moveTo(x, y)
    g.lineTo(x + (index % 2 === 0 ? -0.3 : 0.5), y - 4 - (index % 3) * 0.8)
  }

  g.stroke()
}

// Ducks on the water, the middle one a drake; koi just under it close up.
function paintSwimmers(
  scene: CityScene,
  pond: { readonly x: number; readonly y: number; readonly rx: number; readonly ry: number }
): void {
  const { g } = scene
  const rng = createRng(seedOf('pond', String(pondSlotOf(scene))))

  for (let index = 0; index < POND_SWIMMERS * 2; index++) {
    const angle = rng.next() * Math.PI * 2
    const reach = 0.15 + rng.next() * 0.5
    const at = {
      x: pond.x + Math.cos(angle) * pond.rx * reach,
      y: pond.y + Math.sin(angle) * pond.ry * reach,
      dir: rng.next() < 0.5 ? -1 : 1,
    }

    if (index < POND_SWIMMERS) {
      paintDuck(scene, { ...at, isDrake: index === 1 })
    } else if (scene.minute.detail >= 1) {
      g.globalAlpha = 0.8
      ellipse(g, {
        x: at.x,
        y: at.y,
        rx: 1.5,
        ry: 0.55,
        colour: shadeOf(scene, POND_TONES.koi[index % 2] ?? POND_TONES.duck),
      })
      g.globalAlpha = 1
    }
  }
}

function paintDuck(
  scene: CityScene,
  duck: { readonly x: number; readonly y: number; readonly dir: number; readonly isDrake: boolean }
): void {
  const { g } = scene
  const { x, y, dir } = duck

  ellipse(g, {
    x,
    y,
    rx: 1.7,
    ry: 0.95,
    colour: shadeOf(scene, duck.isDrake ? POND_TONES.drake : POND_TONES.duck),
  })
  ellipse(g, {
    x: x + dir * 1.3,
    y: y - 1,
    rx: 0.62,
    ry: 0.62,
    colour: shadeOf(scene, duck.isDrake ? POND_TONES.drakeHead : POND_TONES.duck),
  })
  g.fillStyle = shadeOf(scene, POND_TONES.beak)
  g.fillRect(x + dir * 1.9 - (dir < 0 ? 0.7 : 0), y - 1.1, 0.7, 0.35)
}
