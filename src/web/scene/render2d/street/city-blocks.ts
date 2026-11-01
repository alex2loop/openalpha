import type { StreetLayers } from '@/web/scene/render2d/street/layer-cache'
import type { StreetMinute } from '@/web/scene/render2d/street/paint'
import type { Point } from '@/web/scene/types'
import type { HolidayId } from '@/web/scene/world/regions'
import { drawSprite, staticPxOf } from '@/web/scene/render2d/street/detail'
import { blossomOf, paintCrownLights } from '@/web/scene/render2d/street/festive-trees'
import { paintGroundShadow } from '@/web/scene/render2d/street/shadow'
import { DARK_STEPS, isNightDark, mixTone, NIGHT_TONE } from '@/web/scene/render2d/street/tone'
import { HEIGHT_K } from '@/web/scene/view'
import { createRng, seedOf } from '@/web/scene/world/rng'

const WHITE = '#FFFFFF'
const BODY_NIGHT = 0.55
const ROOF_NIGHT = 0.5
const ROOF_LIGHTEN = 0.16
const WINDOW_TONES = ['#FFE6A8', '#FFD27A'] as const
const WINDOW_W = 2.2
const WINDOW_H = 2.6
const WINDOW_PITCH_X = 5
const WINDOW_PITCH_Y = 5.4
const WINDOW_ROW_SPAN = 6
const WINDOW_INSET = 2
const WINDOW_TOP = 3
const WARM_SHARE = 0.4
const LIT_ALPHA = 0.95
const UNLIT_ALPHA = 0.4
const UNLIT_NIGHT_FADE = 0.6
const UNLIT_LIGHTEN = 0.14
/** A balcony's person steps out for one of these slots of the day, in minutes. */
export const BALCONY_SLOT_MIN = 15
const BALCONY_SLOTS = 4
const BALCONY_BLOCKS = 3
const BALCONY_MIN_RISE = 20
const BALCONY_PERSON = '#2A2230'
const ROOF_KIT_SHARE = 0.35
const ROOF_KIT_NIGHT = 0.3
const TREE_TONES = ['#7CC68A', '#5FAF72', '#8DD39A'] as const
const TREE_NIGHT = '#2B4558'
const TREE_SHADE = '#1F3B2C'
const TREE_TRUNK = '#7A5A3E'
const TREE_TRUNK_NIGHT = '#1B1B28'
const CROWN_RADII = [5.4, 6.4, 5] as const
// Each crown is a few round blobs: x and y offsets and radius, as shares of the crown's radius.
const CROWN_BLOBS = [
  [
    [0, 0, 1],
    [0.55, 0.3, 0.62],
  ],
  [
    [0, 0, 1],
    [0.62, 0.3, 0.66],
    [-0.58, 0.28, 0.6],
  ],
  [
    [0, 0, 1],
    [-0.5, 0.35, 0.62],
  ],
] as const
const TRUNK_PX = 8
const TRUNK_NIGHT = 0.6
const TRUNK_STEP_PX = 1.4
const LAMP_TONE = '#B9BCC0'
const LAMP_NIGHT = '#10131F'
const LAMP_POLE_NIGHT = 0.5
const LAMP_HEIGHT_PX = 11
const LAMP_ARM_PX = 4
const LAMP_GLOW_PX = 16
const LAMP_GLOW_RGB = '255,214,130'
// Each lamp switches on at its own darkness in this span, so the street lights one by one.
const LAMP_ON_FROM = 0.12
const LAMP_ON_SPAN = 0.76
const BAND_TONE = '#9AACC4'
const BAND_HAZE = 0.5
const BAND_DEPTH = 12
const BAND_MIN_RISE = 9
const BAND_MAX_RISE = 41

/** What every city painter reads: the static canvas and the layers it may keep, the minute
 *  painted, how dark it is (0 day, 1 night), the share of windows lit, the sky's horizon colour the
 *  haze leans to, and the holiday the day falls in. */
export interface CityScene {
  readonly g: CanvasRenderingContext2D
  readonly layers: StreetLayers | undefined
  readonly minute: StreetMinute
  readonly dark: number
  readonly lit: number
  /** The slot of the pack's balcony hours the minute falls in; none outside them. */
  readonly balconySlot: number | undefined
  readonly horizon: string
  readonly holiday: HolidayId | undefined
}

/** One building seen from the south: its facade `height` (before the rise), its roof `depth`,
 *  the share of the lit-window curve it follows, and the seed of its windows. */
interface Block {
  readonly x: number
  readonly base: number
  readonly w: number
  readonly depth: number
  readonly height: number
  readonly tone: string
  readonly lit: number
  readonly seed: number
}

/** A row of hazy far blocks from `x0` to `x1`, rows from `y0` to `y1`, none rising above
 *  `capTop`; only blocks within `reach` of `near` show window bands. */
interface Band {
  readonly x0: number
  readonly x1: number
  readonly y0: number
  readonly y1: number
  readonly step: number
  readonly capTop: number
  readonly seed: string
  readonly near: number
  readonly reach: number
}

export function paintBlock(scene: CityScene, block: Block): void {
  const { g } = scene
  const rise = block.height * HEIGHT_K
  const top = block.base - rise
  const rng = createRng(block.seed)

  paintGroundShadow(g, scene.minute, {
    at: { x: block.x + block.w / 2, y: block.base },
    w: block.w,
    h: block.height,
  })
  g.fillStyle = shade(scene, block.tone, BODY_NIGHT)
  g.fillRect(block.x, top, block.w, rise)
  g.fillStyle = shade(scene, mixTone(block.tone, WHITE, ROOF_LIGHTEN), ROOF_NIGHT)
  g.fillRect(block.x, top - block.depth, block.w, block.depth)
  paintWindows(scene, { block, top, rise, next: rng.next })

  if (rise > BALCONY_MIN_RISE && isBalconyOut(scene, block.seed)) {
    paintBalcony(g, { block, top, rise })
  }

  if (scene.minute.detail > 0 && rng.next() < ROOF_KIT_SHARE) {
    paintRoofKit(scene, { block, roofTop: top - block.depth })
  }
}

/** Hazy blocks in rows, body and roof only; the ones near `near` keep faint window bands and a
 *  few windows lit after dusk. */
export function paintFarBand(scene: CityScene, band: Band): void {
  const { g } = scene
  const tone = mixTone(BAND_TONE, scene.horizon, BAND_HAZE)
  const body = shade(scene, tone, BODY_NIGHT)
  const roof = shade(scene, mixTone(tone, WHITE, ROOF_LIGHTEN), ROOF_NIGHT)

  for (let row = 0, base = band.y0; base <= band.y1; base += band.step, row++) {
    const rng = createRng(seedOf(band.seed, String(row)))

    for (let x = band.x0 + rng.next() * 10; x < band.x1 - 10; ) {
      const w = Math.min(24 + rng.next() * 20, band.x1 - x)
      const height = Math.max(
        BAND_MIN_RISE,
        Math.min(
          17 + rng.next() * (20 + (row % 3) * 5),
          BAND_MAX_RISE,
          (base - band.capTop - BAND_DEPTH) / HEIGHT_K
        )
      )
      const rise = height * HEIGHT_K

      g.fillStyle = body
      g.fillRect(x, base - rise, w, rise)
      g.fillStyle = roof
      g.fillRect(x, base - rise - BAND_DEPTH, w, BAND_DEPTH)

      if (Math.abs(x - band.near) < band.reach) {
        paintBandWindows(scene, { x, base, w, rise, next: rng.next })
      }

      x += w + 2 + rng.next() * 5
    }
  }
}

/** A street tree standing at `at`: trunk and a crown of round blobs, `kind` 0 to 2. */
export function paintTree(scene: CityScene, at: Point, kind: number): void {
  const { g } = scene
  const look = kind % CROWN_RADII.length
  const radius = CROWN_RADII[look] ?? CROWN_RADII[0]
  const crownY = at.y - (TRUNK_PX + look * TRUNK_STEP_PX) * HEIGHT_K - radius * 0.4
  const darkStep = Math.round(scene.dark * DARK_STEPS)
  const blossom = blossomOf(scene.holiday, look)

  paintGroundShadow(g, scene.minute, { at, w: radius * 1.6, h: at.y - crownY + radius })
  g.fillStyle = mixTone(TREE_TRUNK, TREE_TRUNK_NIGHT, scene.dark * TRUNK_NIGHT)
  g.fillRect(at.x - 0.9, crownY + radius * 0.3, 1.8, at.y - crownY - radius * 0.3)
  drawSprite(
    g,
    {
      key: `crown|${look}|${darkStep}|${blossom ?? ''}`,
      box: {
        w: radius * 3,
        h: radius * 3,
        anchor: { x: radius * 1.5, y: radius * 1.3 },
        pxPerWorld: staticPxOf(scene.minute.detail),
      },
      at: { x: at.x, y: crownY },
    },
    (sprite) => paintCrown(sprite, { look, radius, dark: darkStep / DARK_STEPS, blossom })
  )

  if (scene.holiday === 'noel') {
    paintCrownLights(g, { x: at.x, y: crownY, radius, look, dark: scene.dark })
  }
}

/** A street lamp at `at`, its arm reaching to `side` (-1 west, 1 east); it lights once the
 *  darkness passes its own threshold. */
export function paintLamp(scene: CityScene, at: Point, side: -1 | 1): void {
  const { g, dark } = scene
  const top = at.y - LAMP_HEIGHT_PX * HEIGHT_K
  const threshold =
    LAMP_ON_FROM + LAMP_ON_SPAN * createRng(seedOf('lamp', String(at.x), String(at.y))).next()
  const headX = at.x + side * LAMP_ARM_PX

  g.fillStyle = mixTone(LAMP_TONE, LAMP_NIGHT, dark * LAMP_POLE_NIGHT)
  g.fillRect(at.x - 0.6, top, 1.2, at.y - top)
  g.fillRect(Math.min(at.x, headX), top, LAMP_ARM_PX, 1.2)

  if (dark <= threshold) {
    return
  }

  const glow = g.createRadialGradient(headX, top + 1, 0, headX, top + 1, LAMP_GLOW_PX)

  glow.addColorStop(0, `rgba(${LAMP_GLOW_RGB},${0.85 * dark})`)
  glow.addColorStop(1, `rgba(${LAMP_GLOW_RGB},0)`)
  g.fillStyle = glow
  g.fillRect(headX - LAMP_GLOW_PX, top - LAMP_GLOW_PX + 1, LAMP_GLOW_PX * 2, LAMP_GLOW_PX * 2)
  g.fillStyle = `rgba(${LAMP_GLOW_RGB},${0.2 * dark})`
  g.beginPath()
  g.ellipse(headX, at.y + 2, 9, 3.2, 0, 0, Math.PI * 2)
  g.fill()
}

function paintWindows(
  scene: CityScene,
  at: {
    readonly block: Block
    readonly top: number
    readonly rise: number
    readonly next: () => number
  }
): void {
  const { g } = scene
  const { block } = at
  const cols = Math.max(2, Math.floor(block.w / WINDOW_PITCH_X))
  const rows = Math.max(2, Math.floor(at.rise / WINDOW_ROW_SPAN))
  const share = scene.lit * block.lit
  const pitch = (block.w - WINDOW_INSET - 1) / cols
  // Unlit windows show only from the middle detail level.
  const unlitLook =
    scene.minute.detail > 0
      ? {
          alpha: UNLIT_ALPHA * (1 - scene.dark * UNLIT_NIGHT_FADE),
          tone: mixTone(block.tone, WHITE, UNLIT_LIGHTEN),
        }
      : undefined

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const isLit = at.next() < share
      const litTone = at.next() > WARM_SHARE ? WINDOW_TONES[0] : WINDOW_TONES[1]
      const look = isLit ? { alpha: LIT_ALPHA, tone: litTone } : unlitLook

      if (look !== undefined) {
        g.globalAlpha = look.alpha
        g.fillStyle = look.tone
        g.fillRect(
          block.x + WINDOW_INSET + col * pitch,
          at.top + WINDOW_TOP + row * WINDOW_PITCH_Y,
          WINDOW_W,
          WINDOW_H
        )
      }
    }
  }

  g.globalAlpha = 1
}

function isBalconyOut(scene: CityScene, seed: number): boolean {
  const slot = scene.balconySlot

  return slot !== undefined && (slot + seed) % BALCONY_SLOTS === 0 && seed % BALCONY_BLOCKS === 0
}

// A lit doorway halfway up the facade, a person in it and the railing in front.
function paintBalcony(
  g: CanvasRenderingContext2D,
  at: { readonly block: Block; readonly top: number; readonly rise: number }
): void {
  const { block } = at
  const cols = Math.max(2, Math.floor(block.w / WINDOW_PITCH_X))
  const pitch = (block.w - WINDOW_INSET - 1) / cols
  const x = block.x + WINDOW_INSET + (block.seed % cols) * pitch
  const y = at.top + WINDOW_TOP + Math.floor(at.rise / WINDOW_ROW_SPAN / 2) * WINDOW_PITCH_Y

  g.fillStyle = WINDOW_TONES[0]
  g.fillRect(x - 0.3, y - 0.4, 2.8, 3.2)
  g.fillStyle = BALCONY_PERSON
  g.fillRect(x + 0.5, y + 0.5, 1.2, 2.3)
  g.fillRect(x + 0.45, y - 0.1, 1.3, 0.9)
  g.fillStyle = mixTone(block.tone, NIGHT_TONE, 0.4)
  g.fillRect(x - 0.6, y + 2.5, 3.4, 0.5)
}

// A water tank and an antenna on the roof.
function paintRoofKit(
  scene: CityScene,
  at: { readonly block: Block; readonly roofTop: number }
): void {
  const { g } = scene
  const { block, roofTop } = at

  g.fillStyle = mixTone(block.tone, NIGHT_TONE, 0.25 + scene.dark * ROOF_KIT_NIGHT)
  g.fillRect(block.x + block.w * 0.3, roofTop - 5, block.w * 0.3, 5)
  g.fillRect(block.x + block.w * 0.62, roofTop - 11, 1.1, 11)
}

function paintBandWindows(
  scene: CityScene,
  at: {
    readonly x: number
    readonly base: number
    readonly w: number
    readonly rise: number
    readonly next: () => number
  }
): void {
  const { g } = scene

  g.fillStyle = isNightDark(scene.dark) ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.1)'

  for (let y = at.base - at.rise + 4; y < at.base - 3; y += 6) {
    g.fillRect(at.x + 2, y, at.w - 4, 2)
  }

  if (scene.lit <= 0) {
    return
  }

  g.fillStyle = WINDOW_TONES[1]
  g.globalAlpha = 0.75

  for (let k = Math.floor(((at.w * at.rise) / 150) * scene.lit); k > 0; k--) {
    g.fillRect(
      at.x + 2 + at.next() * (at.w - 5),
      at.base - at.rise + 3 + at.next() * (at.rise - 6),
      2,
      1.6
    )
  }

  g.globalAlpha = 1
}

function paintCrown(
  g: CanvasRenderingContext2D,
  crown: {
    readonly look: number
    readonly radius: number
    readonly dark: number
    readonly blossom: string | undefined
  }
): void {
  const base = crown.blossom ?? TREE_TONES[crown.look] ?? TREE_TONES[0]
  const body = mixTone(base, TREE_NIGHT, crown.dark * 0.8)
  const blobs = CROWN_BLOBS[crown.look] ?? CROWN_BLOBS[0]

  for (const [tone, dy] of [
    [mixTone(body, TREE_SHADE, 0.4), 1.5],
    [body, 0],
  ] as const) {
    g.fillStyle = tone

    for (const [dx, oy, size] of blobs) {
      g.beginPath()
      g.arc(dx * crown.radius, oy * crown.radius + dy, crown.radius * size, 0, Math.PI * 2)
      g.fill()
    }
  }

  g.fillStyle = mixTone(body, WHITE, 0.22)
  g.beginPath()
  g.arc(-crown.radius * 0.3, -crown.radius * 0.32, crown.radius * 0.42, 0, Math.PI * 2)
  g.fill()
}

/** `hex` darkened for the night by `share` of the scene's darkness. */
function shade(scene: CityScene, hex: string, share: number): string {
  return mixTone(hex, NIGHT_TONE, scene.dark * share)
}
