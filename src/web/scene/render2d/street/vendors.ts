import type { CityScene } from '@/web/scene/render2d/street/city-blocks'
import type { PaintPart } from '@/web/scene/render2d/street/paint'
import type { VendorView } from '@/web/scene/street-types'
import type { RegionPack } from '@/web/scene/world/regions'
import { citySceneOf } from '@/web/scene/render2d/street/city'
import { shadeOf } from '@/web/scene/render2d/street/park-props'
import {
  type CartScene,
  paintBanhMiCart,
  paintCartWord,
  paintCooler,
  paintPhoCart,
} from '@/web/scene/render2d/street/vendor-carts'
import { paintCartCover } from '@/web/scene/render2d/street/weather'
import {
  BANH_MI_CART,
  isOpen,
  STOOL_ROW_Y,
  STOOL_ROWS,
  siteModeOf,
  TEA_CORNER,
} from '@/web/scene/sim/street/vendors'
import { WORLD } from '@/web/scene/types'

const TONES = Object.freeze({
  shadow: 'rgba(0,0,0,.15)',
  stools: ['#D8453B', '#3F7FC5', '#E8C94A', '#4CAF73'],
  stoolLeg: '#6A7080',
  table: '#D8C9A3',
  tableEdge: '#B5A27A',
  eveningTable: '#CFE0EA',
  eveningEdge: '#9DB5C4',
  tableShadow: 'rgba(0,0,0,.14)',
  bowl: '#F4F1E8',
  herbs: '#5FAF72',
  chilli: '#D8453B',
  bottle: '#4CAF73',
  jugLid: '#8A93A6',
  broth: '#B9803F',
  glass: '#F2EFE6',
  tea: '#E9C46A',
  pole: '#8A6B3E',
  cooler: '#3F7FC5',
  teaCooler: '#4CAF73',
  teaSign: '#F4F1E8',
  teaInk: '#2E7D4F',
  jug: '#3F7FC5',
  steam: '#F4F6F8',
})
// The warm light the stalls throw on the pavement after dusk, and from how dark.
const GLOW = Object.freeze({ rgb: '255,214,130', from: 0.25, alpha: 0.5, rx: 12, ry: 3.4 })
const TEA_GLOW = Object.freeze({ rx: 9, ry: 2.6 })
// The cooks' and sellers' skin.
const SKINS = Object.freeze({ pho: '#D9AE86', banhMi: '#D9AE86' })
// Steam: three puffs climbing over the pot, each this high and this faint at most.
const STEAM = Object.freeze({ puffs: 3, rise: 3.4, alpha: 0.34, r: 0.5, grow: 0.6, sway: 0.55 })

/** The pavement vendors: the phở and evening stools, the iced tea corner and the bánh mì cart by
 *  their hours on the static layer, the steam over the phở pot on the moving one. */
export const VENDORS_PART: PaintPart = {
  paintStatic: (g, pack, minute) => {
    const scene = citySceneOf(g, pack, minute)
    const carts: CartScene = { g, dark: scene.dark, detail: minute.detail }

    paintRow(scene, { id: 'pho', pack, carts })
    paintRow(scene, { id: 'crossing', pack, carts })
    paintTeaCorner(scene, { pack, carts })

    if (isOpen(pack, 'banhMi', minute.clock)) {
      paintBanhMiCart(carts, { ...BANH_MI_CART, skin: SKINS.banhMi })
    }
  },
  paintMoving: (g, view) => paintSteam(g, view.vendors),
}

// Low stools along the pavement behind a long low table; phở bowls and the cook's cart in the
// morning, glasses and a cooler in the evening, a warm light after dusk.
function paintRow(
  scene: CityScene,
  at: { readonly id: 'pho' | 'crossing'; readonly pack: RegionPack; readonly carts: CartScene }
): void {
  const mode = siteModeOf(at.id, at.pack, scene.minute.clock)
  const row = STOOL_ROWS[at.id]
  const last = row.seats.at(-1) ?? 0
  const x0 = row.x0 - 0.6
  const x1 = row.x0 + last + 3.4

  if (mode === undefined || mode === 'tea') {
    return
  }

  paintGlow(scene, { x: (x0 + x1) / 2, y: STOOL_ROW_Y.table - 1.5 })
  row.seats.forEach((dx, index) => {
    paintStool(scene, {
      x: row.x0 + dx,
      y: STOOL_ROW_Y.seat,
      tone: TONES.stools[index % TONES.stools.length],
    })
  })

  const cart = { x: row.x0 + row.cart, y: STOOL_ROW_Y.cart }

  if (mode === 'pho') {
    paintPhoCart(at.carts, { ...cart, skin: SKINS.pho })

    if (scene.minute.weather.rain > 0) {
      paintCartCover(scene.g, { at: cart, w: 3.6, h: 5, dark: scene.dark })
    }
  } else {
    paintCooler(at.carts, { ...cart, tone: TONES.cooler, hasCrate: true })
  }

  paintTable(scene, { x0, x1, mode })

  for (const dx of row.seats) {
    paintOnTable(scene, { x: row.x0 + dx, y: STOOL_ROW_Y.table - 2, mode })
  }

  paintTableMiddle(scene, { x: (x0 + x1) / 2, mode })
}

function paintStool(
  scene: CityScene,
  at: { readonly x: number; readonly y: number; readonly tone: string | undefined }
): void {
  const { g } = scene

  g.fillStyle = TONES.shadow
  g.beginPath()
  g.ellipse(at.x, at.y + 0.1, 1.3, 0.4, 0, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = shadeOf(scene, TONES.stoolLeg)
  g.fillRect(at.x - 0.85, at.y - 1, 0.22, 1.1)
  g.fillRect(at.x + 0.63, at.y - 1, 0.22, 1.1)
  g.fillStyle = shadeOf(scene, at.tone ?? TONES.stoolLeg)
  g.fillRect(at.x - 1.1, at.y - 1.5, 2.2, 0.55)
}

function paintTable(
  scene: CityScene,
  at: { readonly x0: number; readonly x1: number; readonly mode: 'pho' | 'evening' }
): void {
  const { g } = scene
  const y = STOOL_ROW_Y.table
  const isEvening = at.mode === 'evening'

  g.fillStyle = TONES.shadow
  g.fillRect(at.x0, y + 0.1, at.x1 - at.x0, 0.6)
  g.fillStyle = shadeOf(scene, TONES.stoolLeg)
  g.fillRect(at.x0 + 0.6, y - 1, 0.3, 1.1)
  g.fillRect(at.x1 - 0.9, y - 1, 0.3, 1.1)
  g.fillStyle = shadeOf(scene, isEvening ? TONES.eveningTable : TONES.table)
  g.fillRect(at.x0, y - 2.1, at.x1 - at.x0, 0.75)
  g.fillStyle = shadeOf(scene, isEvening ? TONES.eveningEdge : TONES.tableEdge)
  g.fillRect(at.x0, y - 1.35, at.x1 - at.x0, 0.4)
}

// A bowl of phở, or a glass of iced tea, at each place; close up only.
function paintOnTable(
  scene: CityScene,
  at: { readonly x: number; readonly y: number; readonly mode: 'pho' | 'evening' }
): void {
  const { g } = scene

  if (scene.minute.detail === 0) {
    return
  }

  if (at.mode === 'pho') {
    g.fillStyle = shadeOf(scene, TONES.pole)
    g.fillRect(at.x - 0.5, at.y - 0.1, 0.25, 0.14)
    g.fillStyle = shadeOf(scene, TONES.bowl)
    g.beginPath()
    g.ellipse(at.x + 0.3, at.y + 0.05, 0.95, 0.4, 0, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = shadeOf(scene, TONES.broth)
    g.beginPath()
    g.ellipse(at.x + 0.3, at.y - 0.05, 0.65, 0.2, 0, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = shadeOf(scene, TONES.herbs)
    g.fillRect(at.x + 0.1, at.y - 0.15, 0.4, 0.12)
  } else {
    paintGlass(scene, { x: at.x - 0.1, y: at.y - 0.05 })
    g.fillStyle = shadeOf(scene, TONES.bowl)
    g.beginPath()
    g.ellipse(at.x + 1, at.y + 0.05, 0.7, 0.28, 0, 0, Math.PI * 2)
    g.fill()
  }
}

// The chilli jar and the chopstick box in the middle of the phở table; two green bottles on the
// evening one.
function paintTableMiddle(
  scene: CityScene,
  at: { readonly x: number; readonly mode: 'pho' | 'evening' }
): void {
  const { g } = scene
  const y = STOOL_ROW_Y.table

  if (at.mode === 'pho') {
    g.fillStyle = shadeOf(scene, TONES.chilli)
    g.fillRect(at.x - 0.3, y - 2.9, 0.6, 0.8)
    g.fillStyle = shadeOf(scene, TONES.pole)
    g.fillRect(at.x + 1, y - 2.8, 0.7, 0.7)
    return
  }

  g.fillStyle = shadeOf(scene, TONES.bottle)

  for (const x of [at.x - 1.2, at.x + 0.4]) {
    g.fillRect(x, y - 3.3, 0.5, 1.2)
    g.fillRect(x + 0.1, y - 3.6, 0.3, 0.4)
  }
}

function paintGlass(scene: CityScene, at: { readonly x: number; readonly y: number }): void {
  scene.g.fillStyle = shadeOf(scene, TONES.glass)
  scene.g.fillRect(at.x - 0.28, at.y - 0.9, 0.56, 0.85)
  scene.g.fillStyle = shadeOf(scene, TONES.tea)
  scene.g.fillRect(at.x - 0.28, at.y - 0.55, 0.56, 0.45)
}

// The iced tea corner by the east side street: two stools at a round table with the jug and
// glasses, a third at a small table behind with its own jug, and the green cooler with its sign.
function paintTeaCorner(
  scene: CityScene,
  at: { readonly pack: RegionPack; readonly carts: CartScene }
): void {
  const { g } = scene
  const [first, second, third] = TEA_CORNER.seats
  const tableX = WORLD.w + 19.2
  const cooler = { x: tableX + 0.2, y: first.y - 4.4 }

  if (siteModeOf('tea', at.pack, scene.minute.clock) === undefined) {
    return
  }

  paintGlow(scene, { x: tableX, y: first.y - 0.5, rx: TEA_GLOW.rx, ry: TEA_GLOW.ry })
  paintCooler(at.carts, { ...cooler, tone: TONES.teaCooler, hasCrate: false })
  g.fillStyle = shadeOf(scene, TONES.pole)
  g.fillRect(cooler.x - 0.15, cooler.y - 4.6, 0.3, 2)
  g.fillStyle = shadeOf(scene, TONES.teaSign)
  g.fillRect(cooler.x - 2.1, cooler.y - 5.7, 4.2, 1.3)

  if (scene.minute.detail === 2) {
    paintCartWord(at.carts, {
      key: 'ui.office.street.vendor.tea',
      x: cooler.x,
      y: cooler.y - 5,
      maxW: 4,
      ink: shadeOf(scene, TONES.teaInk),
    })
  } else {
    g.fillStyle = shadeOf(scene, TONES.teaInk)
    g.fillRect(cooler.x - 1.4, cooler.y - 5.2, 2.8, 0.4)
  }

  for (const [index, seat] of [first, second, third].entries()) {
    paintStool(scene, { x: seat.x, y: seat.y, tone: TONES.stools[index] })
  }

  paintRoundTable(scene, { x: tableX, y: first.y, r: 1.6 })
  paintRoundTable(scene, { x: tableX, y: third.y, r: 1.2 })
  g.fillStyle = shadeOf(scene, TONES.jug)
  g.fillRect(tableX - 0.6, first.y - 3.4, 1, 1.5)
  g.fillRect(tableX + 0.5, third.y - 2.9, 0.7, 1.1)
  g.fillStyle = shadeOf(scene, TONES.jugLid)
  g.fillRect(tableX - 0.7, first.y - 3.6, 1.2, 0.3)
  g.fillRect(tableX + 0.4, first.y - 3.1, 0.4, 0.25)
  paintGlass(scene, { x: tableX - 1.3, y: first.y - 1.5 })
  paintGlass(scene, { x: tableX + 1.3, y: first.y - 1.5 })
  paintGlass(scene, { x: tableX - 0.3, y: third.y - 1.5 })
}

function paintRoundTable(
  scene: CityScene,
  at: { readonly x: number; readonly y: number; readonly r: number }
): void {
  const { g } = scene

  g.fillStyle = TONES.tableShadow
  g.beginPath()
  g.ellipse(at.x, at.y + 0.1, at.r + 0.2, 0.45, 0, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = shadeOf(scene, TONES.stoolLeg)
  g.fillRect(at.x - 0.15, at.y - 1.2, 0.3, 1.3)
  g.fillStyle = shadeOf(scene, TONES.eveningTable)
  g.beginPath()
  g.ellipse(at.x, at.y - 1.4, at.r, 0.5, 0, 0, Math.PI * 2)
  g.fill()
}

// The warm light the stalls throw on the pavement after dusk, an ellipse `rx` by `ry`.
function paintGlow(
  scene: CityScene,
  at: { readonly x: number; readonly y: number; readonly rx?: number; readonly ry?: number }
): void {
  const { g, dark } = scene

  if (dark < GLOW.from) {
    return
  }

  const rx = at.rx ?? GLOW.rx
  const ry = at.ry ?? GLOW.ry
  const glow = g.createRadialGradient(at.x, at.y, 0, at.x, at.y, rx)

  glow.addColorStop(0, `rgba(${GLOW.rgb},${GLOW.alpha * Math.min(1, dark * 1.4)})`)
  glow.addColorStop(1, `rgba(${GLOW.rgb},0)`)
  g.save()
  g.translate(at.x, at.y)
  g.scale(1, ry / rx)
  g.translate(-at.x, -at.y)
  g.fillStyle = glow
  g.fillRect(at.x - rx, at.y - rx, rx * 2, rx * 2)
  g.restore()
}

// A few faint puffs climbing and widening over the pot.
function paintSteam(g: CanvasRenderingContext2D, vendors: VendorView): void {
  const { pot } = vendors

  if (pot === undefined) {
    return
  }

  g.fillStyle = TONES.steam

  for (let index = 0; index < STEAM.puffs; index++) {
    const share = (vendors.steam + index / STEAM.puffs) % 1

    g.globalAlpha = STEAM.alpha * Math.sin(share * Math.PI)
    g.beginPath()
    g.arc(
      pot.x + Math.sin(share * 5 + index * 2.1) * STEAM.sway,
      pot.y - share * STEAM.rise,
      STEAM.r + share * STEAM.grow,
      0,
      Math.PI * 2
    )
    g.fill()
  }

  g.globalAlpha = 1
}
