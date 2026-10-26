import type { PaintPart } from '@/web/scene/render2d/street/paint'
import type { Frontage } from '@/web/scene/world/frontage'
import { litShareOf } from '@/web/scene/render2d/street/city'
import { paintBoard } from '@/web/scene/render2d/street/led-board'
import { LED } from '@/web/scene/render2d/street/led-face'
import { mixTone, NIGHT_TONE } from '@/web/scene/render2d/street/tone'
import { frontageOf, isLightsOut } from '@/web/scene/world/frontage'
import { createRng, seedOf } from '@/web/scene/world/rng'
import { NORTH } from '@/web/scene/world/street-layout'
import { MINUTES_PER_HOUR } from '@/web/text/time-units'

const WALL = Object.freeze({ top: '#D4CBBB', foot: '#B6AD9D', topNight: 0.64, footNight: 0.68 })
const WINDOW = Object.freeze({
  glass: '#6C7F96',
  sill: '#8E8574',
  w: 7,
  h: 6,
  pitchX: 12,
  pitchY: 11,
  inset: 6,
  margin: 5,
  warm: ['#FFE6A8', '#FFD27A'] as const,
})
const CORNICE = '#E8E1D2'
const GLASS_DAY = ['#C3D8E6', '#7F9DB2'] as const
const GLASS_LIT = ['#D8BE86', '#B9975A'] as const
const DOOR = Object.freeze({ frame: '#D8DCE8', glassDay: '#9FB6C8', glassLit: '#E6CE98', halfW: 9 })
const HOUSING = '#1C2230'
const HOUSING_PAD = 1.5
// The lobby glass is lit after dusk until the shops close at this hour.
const SHOP_LIT_UNTIL_MIN = 21.5 * MINUTES_PER_HOUR
const NIGHT_MIN_DARK = 0.3
const MULLION_PITCH = 5.5

/** The building across from the office on the far pavement, one storey taller than a shop front:
 *  windows in rows lit like its neighbours', a glass shopfront with the door at the centre, and
 *  the housing of the rented LED board and ticker band on its face. The board and the band
 *  themselves, and the holiday greeting, are painted over it. */
export const FRONTAGE_PART: PaintPart = {
  paintStatic: (g, pack, minute) => {
    const frontage = frontageOf(pack.shops)

    if (frontage !== undefined) {
      paintBuilding(g, frontage, { dark: minute.light.dark, minute: minute.minute })
    }
  },
  paintMoving: (g, view, scene) => {
    const frontage = frontageOf(scene.pack.shops)

    if (frontage !== undefined && view.front.face !== undefined) {
      paintBoard(g, {
        scene,
        board: view.front.board,
        rects: { board: frontage.board, band: frontage.band },
      })
    }
  },
}

interface Light {
  readonly dark: number
  readonly minute: number
}

function paintBuilding(g: CanvasRenderingContext2D, frontage: Frontage, light: Light): void {
  const isNight = light.dark > NIGHT_MIN_DARK
  const isLit = isNight && !isLightsOut(light.minute)
  const night = (hex: string, share: number): string => mixTone(hex, NIGHT_TONE, light.dark * share)
  const { body } = frontage

  paintWall(g, frontage, { night, share: isNight ? litShareOf(light.minute) : 0, isLit })
  paintShopfront(g, frontage, { night, isShopLit: isLit && light.minute < SHOP_LIT_UNTIL_MIN })
  g.fillStyle = HOUSING
  g.fillRect(
    frontage.board.x - HOUSING_PAD,
    frontage.board.y - HOUSING_PAD,
    frontage.board.w + 2 * HOUSING_PAD,
    frontage.band.y + frontage.band.h - frontage.board.y + 2 * HOUSING_PAD
  )
  g.fillStyle = LED.face
  g.fillRect(frontage.board.x, frontage.board.y, frontage.board.w, frontage.board.h)
  g.fillStyle = LED.bandBg
  g.fillRect(frontage.band.x, frontage.band.y, frontage.band.w, frontage.band.h)
  g.fillStyle = 'rgba(30,40,56,.26)'
  g.fillRect(body.x, body.y + 0.4, body.w, 1.1)
}

// The wall with its rows of windows, the shade at both ends and the cornice.
function paintWall(
  g: CanvasRenderingContext2D,
  frontage: Frontage,
  look: {
    readonly night: (hex: string, share: number) => string
    readonly share: number
    readonly isLit: boolean
  }
): void {
  const { body, glass } = frontage
  const fill = g.createLinearGradient(0, body.y, 0, body.y + body.h)

  fill.addColorStop(0, look.night(WALL.top, WALL.topNight))
  fill.addColorStop(1, look.night(WALL.foot, WALL.footNight))
  g.fillStyle = fill
  g.fillRect(body.x, body.y, body.w, body.h)

  const rng = createRng(seedOf('frontage'))

  for (let y = body.y + WINDOW.margin; y < glass.y - 9; y += WINDOW.pitchY) {
    for (let x = body.x + WINDOW.inset; x < body.x + body.w - 8; x += WINDOW.pitchX) {
      const isOn = rng.next() < look.share
      const warm = rng.next()

      g.fillStyle = look.night(WINDOW.glass, 0.65)
      g.fillRect(x, y, WINDOW.w, WINDOW.h)

      if (isOn) {
        g.globalAlpha = warm > 0.6 ? 0.7 : 0.54
        g.fillStyle = warm > 0.6 ? WINDOW.warm[0] : WINDOW.warm[1]
        g.fillRect(x, y, WINDOW.w, WINDOW.h)
        g.globalAlpha = 1
      } else {
        g.fillStyle = 'rgba(236,243,250,.22)'
        g.fillRect(x, y, WINDOW.w, 1.3)
      }

      g.fillStyle = look.night(WINDOW.sill, 0.5)
      g.fillRect(x - 0.6, y + WINDOW.h, WINDOW.w + 1.2, 0.9)
    }
  }

  paintEdgeShade(g, frontage)
  g.fillStyle = look.night(CORNICE, 0.5)
  g.fillRect(body.x - 1.2, body.y - 2.2, body.w + 2.4, 2.6)
}

function paintEdgeShade(g: CanvasRenderingContext2D, frontage: Frontage): void {
  const { body } = frontage
  const shade = g.createLinearGradient(body.x, 0, body.x + body.w, 0)

  shade.addColorStop(0, 'rgba(20,30,46,.26)')
  shade.addColorStop(0.07, 'rgba(20,30,46,0)')
  shade.addColorStop(0.93, 'rgba(20,30,46,0)')
  shade.addColorStop(1, 'rgba(20,30,46,.26)')
  g.fillStyle = shade
  g.fillRect(body.x, body.y, body.w, body.h)
}

// The glass shopfront at the foot with its mullions, and the door at the centre; warm while the
// shops are open after dusk.
function paintShopfront(
  g: CanvasRenderingContext2D,
  frontage: Frontage,
  look: { readonly night: (hex: string, share: number) => string; readonly isShopLit: boolean }
): void {
  const { glass, body } = frontage
  const pane = look.isShopLit ? GLASS_LIT : GLASS_DAY
  const fill = g.createLinearGradient(0, glass.y, 0, glass.y + glass.h)

  fill.addColorStop(0, look.isShopLit ? pane[0] : look.night(pane[0], 0.7))
  fill.addColorStop(1, look.isShopLit ? pane[1] : look.night(pane[1], 0.7))
  g.fillStyle = fill
  g.fillRect(glass.x, glass.y, glass.w, glass.h)
  g.fillStyle = look.isShopLit ? 'rgba(90,64,30,.55)' : look.night('#566A80', 0.6)

  for (let x = glass.x + MULLION_PITCH; x < glass.x + glass.w; x += MULLION_PITCH) {
    g.fillRect(x, glass.y, 0.6, glass.h)
  }

  g.fillStyle = look.night('#D5DCE5', 0.5)
  g.fillRect(glass.x, glass.y - 0.4, glass.w, 1.1)
  g.fillStyle = look.night('#56637A', 0.6)
  g.fillRect(glass.x, NORTH.farTop - 0.9, glass.w, 0.9)

  const cx = body.x + body.w / 2

  g.fillStyle = look.night(DOOR.frame, 0.5)
  g.fillRect(cx - DOOR.halfW, glass.y + 1.2, DOOR.halfW * 2, glass.h - 1.2)
  g.fillStyle = look.isShopLit ? DOOR.glassLit : look.night(DOOR.glassDay, 0.7)
  g.fillRect(cx - DOOR.halfW + 1, glass.y + 2, DOOR.halfW * 2 - 2, glass.h - 2)
}
