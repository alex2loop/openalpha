import type { PropDef, PropKind } from '@/web/scene/world/props'
import { castShadow, drawBlock, fill, framed, INK } from '@/web/scene/render2d/building'
import { CREW_PAINTERS } from '@/web/scene/render2d/crew-props'
import {
  paintBin,
  paintKeyboard,
  paintMeetingTable,
  paintMonitor,
  paintMug,
  paintOperatorDesk,
  paintPhone,
  paintStandby,
  paintStudio,
} from '@/web/scene/render2d/desk-devices'
import { paintFish } from '@/web/scene/render2d/pets'
import { type Painter, type PaintScene, WALL_PAINTERS } from '@/web/scene/render2d/wall-props'
import {
  CARD,
  DARKWOOD,
  DEVICE_TONES,
  FABRIC,
  METAL,
  PALETTE,
  PROP_TONES,
  UMBRELLA_TONES,
  WOOD,
} from '@/web/scene/sprites/palette'
import { isWallMounted } from '@/web/scene/world/props'

const SCREEN_EDGE = '#5C6474'
const NOTE_INK = '#8E8497'
// The desk looks a desk prop's `variant` picks.
const DESK_LOOK = Object.freeze({ plain: 0, counter: 1, operator: 2, senior: 3 })
const BANKER_LAMP = 1
const RACK_TONES = Object.freeze({
  body: '#C9D1DE',
  top: '#E4E9F2',
  slot: '#343B55',
  fresh: '#32D74B',
  stale: '#FFB340',
  busy: '#7FD6FF',
})
const TRAY_HANGER_STEP = 22
const LAMP_TONES = Object.freeze({
  bankerOn: ['#D9B25C', '#9CFFC0', '#E6FFF0'],
  bankerOff: ['#D9B25C', '#5FA878', '#8CCB98'],
  deskOn: '#FFE9A8',
  tray: ['#B9C0CC', '#AAB1BD'],
} as const)
const LED_OFF = '#4B5370'
const LAMP_SHADE_FRONT = '#CFC4A8'
const LAMP_LIT_FRONT = '#F2D58B'
const PASTEL = ['#C9B9D9', '#F2C9C2', '#BFD3EE', '#F6E3A8', '#B9D9B5'] as const
// Flat on the floor: under furniture and people standing at the same depth.
const DECAL_KINDS: ReadonlySet<PropKind> = new Set(['cat-bed', 'tray'])

const PAINTERS: Readonly<Record<PropKind, Painter>> = Object.freeze({
  ...WALL_PAINTERS,
  ...CREW_PAINTERS,
  desk: paintDesk,
  chair: paintChair,
  shelf: paintShelf,
  books: paintBooks,
  computer: paintComputer,
  printer: paintPrinter,
  copier: (g, p) =>
    drawBlock(g, [p.draw.x, p.draw.y, 17, 8], { front: 16, tones: PROP_TONES.copier }),
  rack: paintRack,
  tray: (g, p) => framed(g, [p.draw.x, p.draw.y, p.draw.w, 5], METAL[2]),
  box: paintBox,
  phone: (g, p) => framed(g, [p.draw.x, p.draw.y, p.draw.w, p.draw.h - 1], PROP_TONES.screenOff),
  table: paintTable,
  cooler: paintCooler,
  coffee: paintCoffee,
  drinks: (g, p) => {
    drawBlock(g, [p.draw.x, p.draw.y + 3, p.draw.w, 4], { front: 5, tones: WOOD })
    cup(g, p.draw.x + 2, p.draw.y)
  },
  vending: paintVending,
  sofa: paintSofa,
  window: (g, p) => fill(g, [p.draw.x, p.draw.y, p.draw.w, p.draw.h], 'rgba(207,230,255,.3)'),
  plant: paintPlant,
  lamp: paintLamp,
  tank: paintTank,
  'cat-bed': (g, p) => {
    fill(g, [p.draw.x, p.draw.y, p.draw.w, p.draw.h], PROP_TONES.catBed[0])
    fill(g, [p.draw.x + 3, p.draw.y + 3, p.draw.w - 6, p.draw.h - 6], PROP_TONES.catBed[1])
  },
  cabinet: paintCabinet,
  catalogue: paintCatalogue,
  'news-rack': paintNewsRack,
  'coat-rack': paintCoatRack,
  ladder: paintLadder,
  'umbrella-stand': paintUmbrellaStand,
  'desk-lamp': paintDeskLamp,
  'cable-tray': paintCableTray,
} satisfies Record<PropKind, Painter>)

export function paintProp(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  PAINTERS[prop.kind](g, prop, scene)
}

/** Wall-mounted pieces are drawn over the cached floor and under everything that stands on it. */
export function isBackProp(prop: PropDef): boolean {
  return isWallMounted(prop)
}

// A desk lamp lit exactly while its room's switch is on: your angled lamp, or the library's green
// banker's lamp.
function paintDeskLamp(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  const { x, y } = prop.draw
  const isOn = scene.lit.has(prop.room)

  if (prop.variant === BANKER_LAMP) {
    const [brass, shade, rim] = isOn ? LAMP_TONES.bankerOn : LAMP_TONES.bankerOff

    fill(g, [x + 2, y + 9, 6, 3], brass)
    fill(g, [x + 4, y + 4, 1, 6], brass)
    fill(g, [x, y, 10, 5], INK)
    fill(g, [x + 1, y + 1, 8, 3], shade)
    fill(g, [x + 1, y + 1, 8, 1], rim)
    return
  }

  fill(g, [x, y + 12, 6, 2], METAL[2])
  fill(g, [x + 2, y + 3, 1, 9], METAL[2])
  fill(g, [x + 2, y + 3, 7, 1], METAL[2])
  fill(g, [x + 5, y, 9, 5], INK)
  fill(g, [x + 6, y + 1, 7, 3], isOn ? LAMP_TONES.deskOn : PROP_TONES.lampOff)
}

// A cable tray across the store's ceiling with a hanger every few steps.
function paintCableTray(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w } = prop.draw

  fill(g, [x, y, w, 2], LAMP_TONES.tray[0])
  fill(g, [x, y + 2, w, 1], METAL[2])

  for (let i = 0; i < w; i += TRAY_HANGER_STEP) {
    fill(g, [x + i, y + 2, 1, 3], LAMP_TONES.tray[1])
  }
}

/** The y-sort tie order: a decal under furniture under a person at the same depth. */
export function tieRankOf(prop: PropDef): number {
  return DECAL_KINDS.has(prop.kind) ? 0 : 1
}

// The mockup's desk: the top and its legs, a bin beside it, the desktop box, the keyboard, and a
// phone and mug, or a StandBy stand on a senior desk; the alert desk is a long counter.
function paintDesk(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  const { x, y, w, h } = prop.draw

  if (prop.variant === DESK_LOOK.counter) {
    drawBlock(g, [x, y, w, 10], { front: h - 10, tones: WOOD })
    fill(g, [x + 14, y + 2, 10, 6], PALETTE.paper)
    fill(g, [x + 38, y + 3, 8, 2], DEVICE_TONES.page)
    fill(g, [x + 39, y + 4, 6, 1], NOTE_INK)
    return
  }

  if (prop.variant === DESK_LOOK.operator) {
    drawBlock(g, [x, y, w, 14], { front: h - 14, tones: WOOD })
    paintOperatorDesk(g, { x, y }, scene)
    return
  }

  const cx = x + w / 2

  drawBlock(g, [x, y, w, 12], { front: h - 12, tones: WOOD })
  fill(g, [x + 1, y + h, 2, 4], INK)
  fill(g, [x + w - 3, y + h, 2, 4], INK)
  paintBin(g, x - 6, y + 8)
  paintKeyboard(g, cx, y + 5)
  paintStudio(g, x + 1, y + 1)

  if (prop.variant === DESK_LOOK.senior) {
    paintStandby(g, { x: x + w - 14, y: y + 2, view: 'flow' }, scene)
    return
  }

  paintPhone(g, { x: x + w - 13, y: y + 1, owner: prop.id })
  paintMug(g, x + w - 5, y + 7)
}

function paintChair(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w } = prop.draw
  const back = prop.variant === 1 ? 9 : 11

  fill(g, [x, y, w, back], INK)
  fill(g, [x + 1, y + 1, w - 2, back - 2], '#5C6E90')
  fill(g, [x + 1, y + 1, w - 2, 1], '#7C8EB0')

  if (prop.variant === 1) {
    fill(g, [x + w / 2 - 1, y + back, 2, 4], INK)
  }
}

function paintShelf(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w, h } = prop.draw

  castShadow(g, [x + 2, y + h, w, 3])
  framed(g, [x, y, w, h], DARKWOOD[1])

  for (let row = y + 2; row < y + h - 4; row += 12) {
    for (let i = 0; i < w - 4; i += 3) {
      const tall = 7 + ((i * 5 + row) % 4)

      fill(
        g,
        [x + 2 + i, row + 10 - tall, 2, tall],
        PROP_TONES.books[(i / 3 + row) % PROP_TONES.books.length] ?? INK
      )
    }

    fill(g, [x, row + 10, w, 2], DARKWOOD[2])
  }
}

function paintBooks(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, h } = prop.draw
  const base = y + h - 6

  fill(g, [x - 1, base + 5, 15, 1], INK)

  for (let i = 0; i < PASTEL.length; i++) {
    const shift = prop.variant === 1 ? i : i * 2

    fill(g, [x + (i % 2), base - shift, 12 + (i % 3), 5], PASTEL[i] ?? PALETTE.paper)
  }
}

// The monitor stands on its desk and sorts with it, in front of whoever sits there.
function paintComputer(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  paintMonitor(g, prop.draw, scene)
}

function paintPrinter(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  const { x, y } = prop.draw

  drawBlock(g, [x, y, 22, 8], { front: 10, tones: METAL })
  fill(g, [x + 4, y + 2, 14, 3], SCREEN_EDGE)
  fill(g, [x + 17, y + 11, 2, 2], scene.isPrinting ? PROP_TONES.ledOn : SCREEN_EDGE)

  if (scene.isPrinting) {
    fill(g, [x + 5, y - 3, 12, 4], PALETTE.paper)
  }
}

// The store's rack: a slot a row, a light a data source, green while it answers and amber once it
// fails, its activity light lit while the store refreshes; all dark once the office is quiet.
function paintRack(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  const { x, y, w, h } = prop.draw
  const isAwake = !scene.life.isQuiet

  framed(g, [x, y, w, h], RACK_TONES.body)
  fill(g, [x, y, w, 1], RACK_TONES.top)

  for (let i = 0, row = y + 3; row + 4 <= y + h - 2; i++, row += 5) {
    const source = scene.sources[i]

    fill(g, [x + 2, row, w - 4, 4], RACK_TONES.slot)
    fill(g, [x + 13, row + 1, 6, 2], LED_OFF)
    fill(g, [x + 3, row + 1, 2, 2], isAwake && source !== undefined ? RACK_TONES[source] : LED_OFF)
    fill(g, [x + 7, row + 1, 1, 2], isAwake && scene.isRefreshing ? RACK_TONES.busy : LED_OFF)
  }
}

function paintBox(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w, h } = prop.draw

  drawBlock(g, [x, y, w, 8], { front: h - 9, tones: CARD })
  fill(g, [x + w / 2 - 1, y, 2, 8], '#F1DDB4')
  fill(g, [x + 3, y + 10, 6, 3], PALETTE.paper)
}

// The store's cart on wheels, the meeting room's dark table with its things, the team floor's
// table with two papers.
function paintTable(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  const { x, y, w, h } = prop.draw
  const isCart = prop.variant === 1
  const isMeeting = prop.room === 'meet'
  const front = isCart ? 6 : 8
  const wood = isMeeting ? DARKWOOD : WOOD

  drawBlock(g, [x, y, w, h - front], { front, tones: isCart ? METAL : wood })

  if (isCart) {
    fill(g, [x + 2, y + h, 4, 3], INK)
    fill(g, [x + w - 6, y + h, 4, 3], INK)
  } else if (isMeeting) {
    paintMeetingTable(g, { x, y }, scene)
  } else {
    fill(g, [x + 10, y + 2, 10, 6], PALETTE.paper)
    fill(g, [x + 54, y + 3, 12, 5], PALETTE.paper)
  }
}

function paintCooler(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y } = prop.draw
  const body = y + 17

  drawBlock(g, [x, body, 12, 6], { front: 18, tones: METAL })
  framed(g, [x + 2, y + 1, 8, 15], '#5AAAE9')
  fill(g, [x + 3, y + 1, 6, 4], '#D9EFFB')
  fill(g, [x + 3, body + 9, 3, 2], '#4F8FD6')
  fill(g, [x + 7, body + 9, 3, 2], '#D8625A')
}

function paintCoffee(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w } = prop.draw
  const isBar = prop.variant !== 1
  const top = isBar ? y + 8 : y + 12

  drawBlock(g, [x, top, w, isBar ? 5 : 10], { front: isBar ? 6 : 12, tones: WOOD })
  framed(g, isBar ? [x + 2, y + 1, 6, 7] : [x + 5, y + 1, 10, 11], '#4E5A6E')
  cup(g, x + w - 7, top - 4)
}

function cup(g: CanvasRenderingContext2D, x: number, y: number): void {
  fill(g, [x, y, 4, 1], '#4A2C17')
  fill(g, [x, y + 1, 4, 2], PALETTE.paper)
  fill(g, [x + 4, y + 1, 1, 2], PALETTE.paper)
}

function paintVending(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w, h } = prop.draw

  framed(g, [x, y, w, h], PROP_TONES.vending)
  fill(g, [x + 1, y + 1, w - 2, h - 12], '#2B3050')

  for (let row = 0; row < 3; row++) {
    fill(g, [x + 2, y + 3 + row * 8, 6, 6], LED_OFF)
    fill(g, [x + 9, y + 3 + row * 8, 6, 6], LED_OFF)
  }
}

function paintSofa(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w } = prop.draw

  fill(g, [x - 1, y, w + 2, 9], INK)
  fill(g, [x, y + 1, w, 7], FABRIC[1])
  drawBlock(g, [x, y + 8, w, 10], { front: 10, tones: FABRIC })
}

function paintPlant(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y } = prop.draw

  castShadow(g, [x, y + 14, 12, 3])
  framed(g, [x + 2, y + 9, 8, 6], PROP_TONES.pot)
  framed(g, [x, y - 1, 12, 9], PROP_TONES.leaf[1])
  framed(g, [x + 3, y - 4, 6, 4], PROP_TONES.leaf[0])
  fill(g, [x + 1, y + 4, 4, 3], PROP_TONES.leaf[2])
}

// The room's floor lamp, lit exactly while its switch is on.
function paintLamp(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  const { x, y, w, h } = prop.draw
  const cx = x + w / 2
  const base = y + h
  const isOn = scene.lit.has(prop.room)

  castShadow(g, [cx - 6, base - 1, 12, 3])
  framed(g, [cx - 4, base - 3, 8, 2], METAL[2])
  framed(g, [cx - 1, y + 13, 2, h - 16], METAL[2])
  framed(g, [x, y, w, 7], isOn ? PROP_TONES.lampLit : PROP_TONES.lampOff)
  fill(g, [x, y + 7, w, 6], isOn ? LAMP_LIT_FRONT : LAMP_SHADE_FRONT)
}

function paintTank(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  const { x, y, w } = prop.draw
  const isOn = scene.lit.has(prop.room)

  drawBlock(g, [x, y + 17, w, 2], { front: 7, tones: DARKWOOD })
  framed(g, [x, y + 2, w, 13], isOn ? '#BFE6F5' : '#5E8399')
  fill(g, [x, y, w, 2], isOn ? '#FFF7C2' : '#7A7F8C')
  fill(g, [x, y + 13, w, 2], isOn ? '#E6D3A3' : '#9C8E6E')
  fill(g, [x + 7, y + 6, 1, 7], '#4FA373')
  fill(g, [x + 25, y + 8, 1, 5], '#3F9163')
  paintFish(g, { x, y: y + 2, w, h: 13 }, { fish: scene.life.fish, level: scene.detail })
}

function paintCabinet(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w, h } = prop.draw

  drawBlock(g, [x, y, w, 6], { front: h - 7, tones: METAL })

  for (let i = 0; i < 3; i++) {
    fill(g, [x + 1, y + 8 + i * 10, w - 2, 1], METAL[2])
    fill(g, [x + w / 2 - 2, y + 10 + i * 10, 4, 1], SCREEN_EDGE)
  }
}

function paintCatalogue(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y } = prop.draw

  drawBlock(g, [x, y, 28, 5], { front: 17, tones: DARKWOOD })

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      fill(g, [x + 2 + col * 9, y + 7 + row * 5, 7, 3], DARKWOOD[2])
      fill(g, [x + 4 + col * 9, y + 8 + row * 5, 3, 1], '#E8D5A8')
    }
  }
}

function paintNewsRack(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w, h } = prop.draw

  framed(g, [x, y, w, h - 2], DARKWOOD[1])
  fill(g, [x, y + h - 2, w, 2], DARKWOOD[2])

  for (let i = 0; i < 3; i++) {
    fill(g, [x + 1 + i * 4, y + 2, 3, 15 - i], PASTEL[(i + 1) % PASTEL.length] ?? PALETTE.paper)
  }
}

function paintCoatRack(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, h } = prop.draw
  const pole = x + 4

  castShadow(g, [pole - 4, y + h - 3, 10, 3])
  fill(g, [pole - 4, y + h - 3, 10, 2], METAL[2])
  fill(g, [pole, y, 2, h - 2], INK)
  fill(g, [pole - 5, y + 3, 12, 2], WOOD[2])
  framed(g, [pole + 3, y + 7, 4, 9], '#A9C2E8')
}

function paintLadder(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w, h } = prop.draw

  fill(g, [x, y, 1, h], WOOD[2])
  fill(g, [x + w - 1, y, 1, h], WOOD[2])

  for (let rung = 0; rung < 6; rung++) {
    fill(g, [x, y + 3 + rung * 5, w, 1], WOOD[1])
  }
}

// Two closed umbrellas in the stand by the street exit; in the rain one lies open on the mat.
function paintUmbrellaStand(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  const { x, y, w, h } = prop.draw
  const [first, second] = UMBRELLA_TONES

  if (scene.isRaining) {
    g.fillStyle = first
    g.beginPath()
    g.arc(x + w + 4, y - 4, 6, Math.PI, Math.PI * 2)
    g.fill()
    fill(g, [x + w + 3.5, y - 4, 1, 5], INK)
  } else {
    fill(g, [x + 2, y, 2, h - 6], first)
  }

  fill(g, [x + 5, y + 1, 2, h - 7], second)
  castShadow(g, [x, y + h - 3, w, 3])
  framed(g, [x + 1, y + h - 8, w - 2, 6], PROP_TONES.umbrellaStand)
}
