import type { MessageKey } from '@/i18n'
import type { CityScene } from '@/web/scene/render2d/street/city-blocks'
import type { MovingScene, PaintPart } from '@/web/scene/render2d/street/paint'
import type { PersonView, VendorView } from '@/web/scene/street-types'
import type { RegionPack } from '@/web/scene/world/regions'
import { citySceneOf } from '@/web/scene/render2d/street/city'
import { paintLabel } from '@/web/scene/render2d/street/label'
import { shadeOf } from '@/web/scene/render2d/street/park-props'
import { drawPerson } from '@/web/scene/render2d/street/people'
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
import { STREET_RECT } from '@/web/scene/view'
import { tr } from '@/web/text/tr'

const TONES = Object.freeze({
  shadow: 'rgba(0,0,0,.15)',
  stools: ['#D8453B', '#3F7FC5', '#E8C94A', '#4CAF73'],
  stoolLeg: '#6A7080',
  table: '#D8C9A3',
  tableEdge: '#B5A27A',
  eveningTable: '#CFE0EA',
  eveningEdge: '#9DB5C4',
  bowl: '#F4F1E8',
  broth: '#B9803F',
  glass: '#F2EFE6',
  tea: '#E9C46A',
  cart: '#8E9AA3',
  cartTop: '#B9C2C9',
  wheel: '#171B26',
  pot: '#D5D8DE',
  pole: '#8A6B3E',
  phoSign: '#D8453B',
  cooler: '#3F7FC5',
  coolerLid: '#F2EFE6',
  teaCooler: '#4CAF73',
  teaSign: '#F4F1E8',
  teaInk: '#2E7D4F',
  jug: '#3F7FC5',
  breadCart: '#9B7A52',
  breadTop: '#C9A878',
  glassCase: '#F2F0EA',
  parasol: ['#D8514B', '#F2EFE6'],
  steam: '#F4F6F8',
  signInk: '#FFFFFF',
  breadInk: '#F8E7C4',
})
// The warm light the stalls throw on the pavement after dusk, and from how dark.
const GLOW = Object.freeze({ rgb: '255,214,130', from: 0.25, alpha: 0.5, rx: 12, ry: 3.4 })
const WORDS = Object.freeze({
  pho: 'ui.office.street.vendor.pho',
  tea: 'ui.office.street.vendor.tea',
  banhMi: 'ui.office.street.vendor.banhMi',
} satisfies Record<string, MessageKey>)
const WORD_PX = 1
// The cooks and sellers, standing at their carts.
const COOK: PersonView = vendorAt(
  STOOL_ROWS.pho.x0 + STOOL_ROWS.pho.cart + 0.4,
  STOOL_ROW_Y.cart - 1
)
const SELLER: PersonView = vendorAt(BANH_MI_CART.x + 0.5, BANH_MI_CART.y - 1.2)
// Steam: three puffs climbing over the pot, each this high and this faint at most.
const STEAM = Object.freeze({ puffs: 3, rise: 3.4, alpha: 0.34, r: 0.5, grow: 0.6, sway: 0.55 })

/** The pavement vendors: the phở and evening stools, the iced tea corner and the bánh mì cart by
 *  their hours on the static layer, the steam over the phở pot on the moving one. */
export const VENDORS_PART: PaintPart = {
  paintStatic: (g, pack, minute) => {
    const scene = citySceneOf(g, pack, minute)
    const people: MovingScene = { rect: STREET_RECT, px: 1, minute, pack }

    paintRow(scene, { id: 'pho', pack, people })
    paintRow(scene, { id: 'crossing', pack, people })
    paintTeaCorner(scene, pack)
    paintBanhMi(scene, { pack, people })
  },
  paintMoving: (g, view) => paintSteam(g, view.vendors),
}

function vendorAt(x: number, y: number): PersonView {
  return Object.freeze({
    kind: 'walker',
    facing: 'south',
    frame: 0,
    look: 0,
    item: undefined,
    staff: undefined,
    prev: { x, y },
    at: { x, y },
    umbrella: 0,
    hat: 0,
  })
}

// Low stools along the pavement behind a long low table; phở bowls and the cook's cart in the
// morning, glasses and a cooler in the evening, a warm light after dusk.
function paintRow(
  scene: CityScene,
  at: { readonly id: 'pho' | 'crossing'; readonly pack: RegionPack; readonly people: MovingScene }
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

  if (mode === 'pho') {
    paintPhoCart(scene, { x: row.x0 + row.cart, people: at.people })
  } else {
    paintCooler(scene, { x: row.x0 + row.cart, y: STOOL_ROW_Y.cart, tone: TONES.cooler })
  }

  paintTable(scene, { x0, x1, mode })

  for (const dx of row.seats) {
    paintOnTable(scene, { x: row.x0 + dx, y: STOOL_ROW_Y.table - 2, mode })
  }
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
    g.fillStyle = shadeOf(scene, TONES.bowl)
    g.beginPath()
    g.ellipse(at.x + 0.3, at.y + 0.05, 0.95, 0.4, 0, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = shadeOf(scene, TONES.broth)
    g.beginPath()
    g.ellipse(at.x + 0.3, at.y - 0.05, 0.65, 0.2, 0, 0, Math.PI * 2)
    g.fill()
  } else {
    paintGlass(scene, { x: at.x - 0.1, y: at.y })
  }
}

function paintGlass(scene: CityScene, at: { readonly x: number; readonly y: number }): void {
  scene.g.fillStyle = shadeOf(scene, TONES.glass)
  scene.g.fillRect(at.x - 0.28, at.y - 0.9, 0.56, 0.85)
  scene.g.fillStyle = shadeOf(scene, TONES.tea)
  scene.g.fillRect(at.x - 0.28, at.y - 0.55, 0.56, 0.45)
}

// The cook behind a steel cart with the broth pot, and the red sign on its pole.
function paintPhoCart(
  scene: CityScene,
  at: { readonly x: number; readonly people: MovingScene }
): void {
  const { g } = scene
  const { x } = at
  const y = STOOL_ROW_Y.cart

  drawPerson(g, COOK, at.people)
  g.fillStyle = shadeOf(scene, TONES.cart)
  g.fillRect(x - 3.2, y - 2.6, 6.4, 2.6)
  g.fillStyle = shadeOf(scene, TONES.cartTop)
  g.fillRect(x - 3.2, y - 2.9, 6.4, 0.4)
  paintWheels(scene, { x, y, apart: 2.2 })
  g.fillStyle = shadeOf(scene, TONES.pot)
  g.fillRect(x - 2.4, y - 4.5, 3, 1.6)
  g.fillStyle = shadeOf(scene, TONES.pole)
  g.fillRect(x - 3.4, y - 6.6, 0.3, 6.6)
  g.fillStyle = shadeOf(scene, TONES.phoSign)
  g.fillRect(x - 3.7, y - 7.6, 3.4, 1.4)
  paintWord(scene, { key: WORDS.pho, x: x - 2, y: y - 6.9, maxW: 3.2 })

  if (scene.minute.weather.rain > 0) {
    paintCartCover(g, { at: { x, y }, w: 3.6, h: 5, dark: scene.dark })
  }
}

function paintCooler(
  scene: CityScene,
  at: { readonly x: number; readonly y: number; readonly tone: string }
): void {
  const { g } = scene

  g.fillStyle = TONES.shadow
  g.beginPath()
  g.ellipse(at.x, at.y + 0.2, 3, 0.7, 0, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = shadeOf(scene, at.tone)
  g.fillRect(at.x - 2.2, at.y - 2.2, 4.4, 2.2)
  g.fillStyle = shadeOf(scene, TONES.coolerLid)
  g.fillRect(at.x - 2.4, at.y - 2.6, 4.8, 0.5)
}

// The iced tea corner by the east side street: two stools at a round table with the jug, a third
// at a small table behind, and the green cooler with its sign.
function paintTeaCorner(scene: CityScene, pack: RegionPack): void {
  const { g } = scene
  const [first, second, third] = TEA_CORNER.seats
  const tableX = WORLD.w + 19.2

  if (siteModeOf('tea', pack, scene.minute.clock) === undefined) {
    return
  }

  paintGlow(scene, { x: tableX, y: first.y })
  paintCooler(scene, { x: tableX + 0.2, y: first.y - 4.4, tone: TONES.teaCooler })
  g.fillStyle = shadeOf(scene, TONES.teaSign)
  g.fillRect(tableX - 1.9, first.y - 10.1, 4.2, 1.3)
  paintWord(scene, { key: WORDS.tea, x: tableX + 0.2, y: first.y - 9.45, maxW: 4 })

  for (const [index, seat] of [first, second, third].entries()) {
    paintStool(scene, { x: seat.x, y: seat.y, tone: TONES.stools[index] })
  }

  for (const [y, r] of [
    [first.y, 1.6],
    [third.y, 1.2],
  ] as const) {
    paintRoundTable(scene, { x: tableX, y, r })
  }

  g.fillStyle = shadeOf(scene, TONES.jug)
  g.fillRect(tableX - 0.6, first.y - 3.4, 1, 1.5)
  paintGlass(scene, { x: tableX - 1.3, y: first.y - 1.5 })
}

function paintRoundTable(
  scene: CityScene,
  at: { readonly x: number; readonly y: number; readonly r: number }
): void {
  const { g } = scene

  g.fillStyle = shadeOf(scene, TONES.stoolLeg)
  g.fillRect(at.x - 0.15, at.y - 1.2, 0.3, 1.3)
  g.fillStyle = shadeOf(scene, TONES.eveningTable)
  g.beginPath()
  g.ellipse(at.x, at.y - 1.4, at.r, 0.5, 0, 0, Math.PI * 2)
  g.fill()
}

// The bánh mì glass cart under its striped parasol, the seller behind it.
function paintBanhMi(
  scene: CityScene,
  at: { readonly pack: RegionPack; readonly people: MovingScene }
): void {
  const { g } = scene
  const { x, y } = BANH_MI_CART

  if (!isOpen(at.pack, 'banhMi', scene.minute.clock)) {
    return
  }

  drawPerson(g, SELLER, at.people)
  g.fillStyle = shadeOf(scene, TONES.breadCart)
  g.fillRect(x - 4, y - 3, 8, 2.8)
  g.fillStyle = shadeOf(scene, TONES.breadTop)
  g.fillRect(x - 4, y - 3.4, 8, 0.8)
  g.fillStyle = shadeOf(scene, TONES.glassCase)
  g.fillRect(x - 1.5, y - 4.4, 3, 1.1)
  paintWheels(scene, { x, y, apart: 2.8 })
  g.fillStyle = shadeOf(scene, TONES.pole)
  g.fillRect(x - 0.1, y - 8.2, 0.3, 5)

  for (let index = 0; index < 6; index++) {
    g.fillStyle = shadeOf(scene, TONES.parasol[index % 2] ?? TONES.glassCase)
    g.beginPath()
    g.moveTo(x + 0.05, y - 8.2)
    g.lineTo(x - 5 + index * 1.667, y - 5.8)
    g.lineTo(x - 5 + (index + 1) * 1.667, y - 5.8)
    g.closePath()
    g.fill()
  }

  paintWord(scene, { key: WORDS.banhMi, x, y: y - 1.6, maxW: 7 })
}

function paintWheels(
  scene: CityScene,
  at: { readonly x: number; readonly y: number; readonly apart: number }
): void {
  const { g } = scene

  g.fillStyle = shadeOf(scene, TONES.wheel)
  g.beginPath()
  g.arc(at.x - at.apart, at.y + 0.1, 0.75, 0, Math.PI * 2)
  g.arc(at.x + at.apart, at.y + 0.1, 0.75, 0, Math.PI * 2)
  g.fill()
}

// A stall's word, close up only.
function paintWord(
  scene: CityScene,
  word: { readonly key: MessageKey; readonly x: number; readonly y: number; readonly maxW: number }
): void {
  if (scene.minute.detail === 2) {
    paintLabel(scene.g, tr(word.key), {
      x: word.x,
      y: word.y,
      size: WORD_PX,
      colour: TONES.signInk,
      maxW: word.maxW,
    })
  }
}

function paintGlow(scene: CityScene, at: { readonly x: number; readonly y: number }): void {
  const { g, dark } = scene

  if (dark < GLOW.from) {
    return
  }

  const glow = g.createRadialGradient(at.x, at.y, 0, at.x, at.y, GLOW.rx)

  glow.addColorStop(0, `rgba(${GLOW.rgb},${GLOW.alpha * Math.min(1, dark * 1.4)})`)
  glow.addColorStop(1, `rgba(${GLOW.rgb},0)`)
  g.save()
  g.translate(at.x, at.y)
  g.scale(1, GLOW.ry / GLOW.rx)
  g.translate(-at.x, -at.y)
  g.fillStyle = glow
  g.fillRect(at.x - GLOW.rx, at.y - GLOW.rx, GLOW.rx * 2, GLOW.rx * 2)
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
