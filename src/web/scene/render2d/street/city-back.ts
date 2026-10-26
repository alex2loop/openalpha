import type { CityScene } from '@/web/scene/render2d/street/city-blocks'
import { STREET_LEFT, STREET_RIGHT } from '@/web/scene/render2d/street/city-ground'
import { mixTone, NIGHT_TONE } from '@/web/scene/render2d/street/tone'
import { createRng, seedOf } from '@/web/scene/world/rng'

type Facade = 'glass' | 'white' | 'concrete'

interface Look {
  readonly colour: string
  readonly facade: Facade
  readonly pitch: readonly number[]
}

// The city behind the tower in three rows, far to near, each with its own height in floors, width,
// gap between towers, base line and haze. A row keeps `clear` px free either side of the tower;
// `mix` cuts the facade tones by a draw: below the first cut the first tone, and so on.
const ROWS = [
  {
    haze: 0.58,
    floors: [16, 23],
    w: [26, 46],
    gap: [3, 34],
    base: -58,
    clear: 40,
    mix: [0.4, 0.5, 0.8],
  },
  {
    haze: 0.44,
    floors: [11, 18],
    w: [24, 42],
    gap: [1, 20],
    base: -50,
    clear: 40,
    mix: [0.3, 0.4, 0.65],
  },
  {
    haze: 0.3,
    floors: [5, 9],
    w: [22, 40],
    gap: [0, 5],
    base: -42,
    clear: 0,
    mix: [0.2, 0.3, 0.6],
  },
] as const
// Four facades: a colour, a window style and three window pitches (px) to draw from.
const TONES: readonly [Look, ...Look[]] = [
  { colour: '#8AA3C4', facade: 'glass', pitch: [3.6, 4.6, 6] },
  { colour: '#7FA3AC', facade: 'glass', pitch: [4, 5, 6.4] },
  { colour: '#D9DDE2', facade: 'white', pitch: [4, 5.4, 7] },
  { colour: '#CDBFA8', facade: 'concrete', pitch: [5, 6.4, 8] },
]
const FLOOR_PX = [6.5, 7.5, 8] as const
// Towers stand on the line the far pavement starts at.
const GROUND = -30
const BODY_NIGHT = 0.55
const ROOF_NIGHT = 0.5
const LIT_WINDOW = '#FFD27A'
const LIT_ALPHA = 0.75
const LIT_SHARE = 0.32
const NIGHT_MIN_DARK = 0.3

interface Tower {
  readonly x: number
  readonly w: number
  readonly top: number
  readonly floors: number
  readonly floorPx: number
  readonly pitch: number
  readonly facade: Facade
  readonly crown: number
  readonly mast: number
  readonly seed: number
}

/** The back rows of the city around the tower at `centre`: towers of their own heights in four
 *  facade tones, hazier with distance, a roof box or a mast on some; after dusk a few lit windows. */
export function paintCityBack(scene: CityScene, centre: number): void {
  for (const [index, row] of ROWS.entries()) {
    const rng = createRng(seedOf('city-back', String(index)))

    for (let x = STREET_LEFT - 8 + rng.next() * 26; x < STREET_RIGHT; ) {
      const floors = row.floors[0] + Math.floor(rng.next() * (row.floors[1] - row.floors[0] + 1))
      const floorPx = FLOOR_PX[Math.floor(rng.next() * FLOOR_PX.length)] ?? FLOOR_PX[0]
      const w = row.w[0] + rng.next() * (row.w[1] - row.w[0])
      const look = lookOf(row.mix, rng.next())
      const tower: Tower = {
        x,
        w,
        top: row.base - floors * floorPx,
        floors,
        floorPx,
        pitch: look.pitch[Math.floor(rng.next() * look.pitch.length)] ?? look.pitch[0] ?? 5,
        facade: look.facade,
        crown: Math.floor(rng.next() * 3),
        mast: rng.next(),
        seed: Math.floor(rng.next() * 1e6),
      }

      x += w + row.gap[0] + rng.next() * (row.gap[1] - row.gap[0])

      if (row.clear === 0 || Math.abs(tower.x + w / 2 - centre) >= row.clear) {
        paintTower(scene, { tower, colour: look.colour, haze: row.haze })
      }
    }
  }
}

// The facade a draw picks: below the first cut the first tone, and so on; past the last, the last.
function lookOf(mix: readonly number[], draw: number): Look {
  const index = mix.findIndex((cut) => draw < cut)

  return TONES[index < 0 ? TONES.length - 1 : index] ?? TONES[0]
}

interface TowerJob {
  readonly tower: Tower
  readonly colour: string
  readonly haze: number
}

function paintTower(scene: CityScene, job: TowerJob): void {
  const { g, dark } = scene
  const { tower } = job
  const base = mixTone(job.colour, scene.horizon, job.haze)
  const night = (hex: string, share: number): string => mixTone(hex, NIGHT_TONE, dark * share)
  const height = GROUND - tower.top

  g.fillStyle = night(base, BODY_NIGHT)
  g.fillRect(tower.x, tower.top, tower.w, height)
  g.fillStyle = night(mixTone(base, '#FFFFFF', 0.2), BODY_NIGHT)
  g.fillRect(tower.x, tower.top, tower.w * 0.16, height)
  g.fillStyle = night(mixTone(base, '#1A2A48', 0.26), BODY_NIGHT)
  g.fillRect(tower.x + tower.w * 0.76, tower.top, tower.w * 0.24, height)
  paintFacade(scene, tower)

  const roof = night(mixTone(base, '#FFFFFF', 0.32), ROOF_NIGHT)

  g.fillStyle = roof
  g.fillRect(tower.x, tower.top - 1.6, tower.w, 1.6)
  paintCrown(scene, { tower, body: night(base, BODY_NIGHT), roof })

  if (scene.lit > 0) {
    paintLights(scene, job)
  }
}

// Floor lines and window glints in the tower's style; the fine mullions and window blocks only
// from the middle detail up.
function paintFacade(scene: CityScene, tower: Tower): void {
  const { g, minute } = scene
  const isNight = scene.dark > NIGHT_MIN_DARK
  const fine = minute.detail > 0
  const hasBlocks = tower.facade === 'concrete' && fine

  for (let floor = 0; floor < tower.floors; floor++) {
    const y = tower.top + floor * tower.floorPx

    if (hasBlocks) {
      paintWindowBlocks(scene, { tower, y, isNight })
    } else {
      paintFloorLine(g, { tower, y, isNight })
    }
  }

  if (fine && tower.facade !== 'concrete') {
    g.fillStyle = isNight ? 'rgba(0,0,0,.1)' : 'rgba(22,38,66,.14)'

    for (let x = tower.x + 1; x < tower.x + tower.w - 1; x += tower.pitch) {
      g.fillRect(x, tower.top, 0.5, tower.floors * tower.floorPx)
    }
  }
}

// A dark line along a floor, and by day a lighter strip under it.
function paintFloorLine(
  g: CanvasRenderingContext2D,
  at: { readonly tower: Tower; readonly y: number; readonly isNight: boolean }
): void {
  const { tower } = at

  g.fillStyle = at.isNight ? 'rgba(0,0,0,.22)' : 'rgba(24,40,68,.3)'
  g.fillRect(tower.x + 1, at.y, tower.w - 2, 0.9)

  if (!at.isNight) {
    g.fillStyle = 'rgba(236,243,250,.2)'
    g.fillRect(tower.x + 1, at.y + 1.2, tower.w - 2, tower.floorPx * 0.3)
  }
}

function paintWindowBlocks(
  scene: CityScene,
  at: { readonly tower: Tower; readonly y: number; readonly isNight: boolean }
): void {
  const { g } = scene
  const { tower } = at

  g.fillStyle = at.isNight ? 'rgba(6,10,22,.5)' : 'rgba(44,60,86,.58)'

  for (let x = tower.x + 1; x + tower.pitch <= tower.x + tower.w - 1; x += tower.pitch) {
    g.fillRect(
      x + tower.pitch * 0.2,
      at.y + tower.floorPx * 0.24,
      tower.pitch * 0.6,
      tower.floorPx * 0.5
    )
  }
}

// Some towers carry a box on the roof, some a box and a mast.
function paintCrown(
  scene: CityScene,
  at: { readonly tower: Tower; readonly body: string; readonly roof: string }
): void {
  const { g } = scene
  const { tower } = at
  const roofY = tower.top - 1.6

  if (tower.crown === 0) {
    g.fillStyle = at.body
    g.fillRect(tower.x + tower.w * 0.18, roofY - 7.4, tower.w * 0.64, 7.4)
    g.fillStyle = at.roof
    g.fillRect(tower.x + tower.w * 0.18, roofY - 8.8, tower.w * 0.64, 1.4)
  } else if (tower.crown === 1) {
    g.fillStyle = at.body
    g.fillRect(tower.x + tower.w * 0.3, roofY - 12.4, tower.w * 0.4, 12.4)
    g.fillStyle = at.roof
    g.fillRect(tower.x + tower.w * 0.3, roofY - 13.8, tower.w * 0.4, 1.4)
    g.fillStyle = at.body
    g.fillRect(tower.x + tower.w * 0.47, roofY - 32.4 - tower.mast * 8, 1, 20)
  }
}

// After dusk, windows lit here and there, fewer in the hazier rows.
function paintLights(scene: CityScene, job: TowerJob): void {
  const { g, lit } = scene
  const { tower } = job
  const cols = Math.max(1, Math.floor((tower.w - 2) / tower.pitch))
  const rng = createRng(tower.seed)
  const count = Math.round(tower.floors * cols * lit * LIT_SHARE * (1.3 - job.haze))

  g.fillStyle = LIT_WINDOW
  g.globalAlpha = LIT_ALPHA

  for (let n = count; n > 0; n--) {
    const y =
      tower.top + Math.floor(rng.next() * tower.floors) * tower.floorPx + tower.floorPx * 0.3
    const x = tower.x + 1 + Math.floor(rng.next() * cols) * tower.pitch + tower.pitch * 0.2

    g.fillRect(x, y, tower.pitch * 0.6, tower.floorPx * 0.46)
  }

  g.globalAlpha = 1
}
