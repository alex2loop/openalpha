import {
  CARD,
  castShadow,
  DARKWOOD,
  drawBlock,
  FABRIC,
  fill,
  framed,
  INK,
  METAL,
  type Tones,
  WOOD,
} from '@/web/scene/render2d/building'
import { type Painter, type PaintScene, WALL_PAINTERS } from '@/web/scene/render2d/wall-props'
import { type PropDef, type PropKind, spriteRectOf } from '@/web/scene/world/props'

const PAPER = '#F7F5EF'
const MONITOR_PX = 9
const PHONE_PX = 5
const SCREEN_OFF = '#3E4452'
const SCREEN_EDGE = '#5C6474'
const LED_OFF = '#4B5370'
const LED_PRINT = '#7FD49A'
const LAMP_SHADE = '#E9DFC6'
const LAMP_SHADE_FRONT = '#CFC4A8'
const LAMP_LIT = '#FFF3C4'
const LAMP_LIT_FRONT = '#F2D58B'
const BOOK_TONES = [
  '#8C9EC2',
  '#C9A86A',
  '#9AB5A8',
  '#B98AA8',
  '#D2B48C',
  '#7F8FA6',
  '#A88C6A',
] as const
const PASTEL = ['#C9B9D9', '#F2C9C2', '#BFD3EE', '#F6E3A8', '#B9D9B5'] as const
const COPIER_TONES: Tones = ['#F7F4EC', '#E9E6DF', '#CFCBC2']
const LEAF = ['#8CCB98', '#5FA872', '#3E7E52'] as const
// Wall-mounted pieces drawn over the cached floor and under everything that stands on it.
const BACK_KINDS: ReadonlySet<PropKind> = new Set([
  'clock',
  'wall-screen',
  'whiteboard',
  'results-board',
  'frame',
  'light-switch',
  'lift-door',
  'window',
])
// Flat on the floor: under furniture and people standing at the same depth.
const DECAL_KINDS: ReadonlySet<PropKind> = new Set(['cat-bed', 'tray'])

const PAINTERS: Readonly<Record<PropKind, Painter>> = Object.freeze({
  ...WALL_PAINTERS,
  desk: paintDesk,
  chair: paintChair,
  shelf: paintShelf,
  books: paintBooks,
  computer: paintComputer,
  printer: paintPrinter,
  copier: (g, p) =>
    drawBlock(g, [p.rect.x, p.rect.y, p.rect.w, 8], { front: p.rect.h - 9, tones: COPIER_TONES }),
  rack: paintRack,
  tray: (g, p) => framed(g, [p.rect.x, p.rect.y, p.rect.w, 5], METAL[2]),
  box: paintBox,
  phone: (g, p) => framed(g, [p.rect.x, p.rect.y + 2, p.rect.w, PHONE_PX], SCREEN_OFF),
  table: paintTable,
  cooler: paintCooler,
  coffee: paintCoffee,
  drinks: (g, p) => {
    drawBlock(g, [p.rect.x, p.rect.y + 3, p.rect.w, 4], { front: 5, tones: WOOD })
    cup(g, p.rect.x + 2, p.rect.y)
  },
  vending: paintVending,
  sofa: paintSofa,
  window: (g, p) => fill(g, [p.rect.x, p.rect.y, p.rect.w, p.rect.h], 'rgba(207,230,255,.3)'),
  plant: paintPlant,
  lamp: paintLamp,
  tank: paintTank,
  'cat-bed': (g, p) => {
    fill(g, [p.rect.x, p.rect.y, p.rect.w, p.rect.h], '#E6B7A8')
    fill(g, [p.rect.x + 3, p.rect.y + 3, p.rect.w - 6, p.rect.h - 6], '#F9E3DA')
  },
  'guest-desk': (g, p) =>
    drawBlock(g, [p.rect.x, p.rect.y, p.rect.w, 10], { front: 13, tones: WOOD }),
  cabinet: paintCabinet,
  catalogue: paintCatalogue,
  'news-rack': paintNewsRack,
  'coat-rack': paintCoatRack,
  ladder: paintLadder,
} satisfies Record<PropKind, Painter>)

/** Paints a prop over the box it covers on screen, derived from its footprint and height. */
export function paintProp(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  PAINTERS[prop.kind](g, { ...prop, rect: spriteRectOf(prop) }, scene)
}

export function isBackProp(prop: PropDef): boolean {
  return BACK_KINDS.has(prop.kind)
}

/** The y-sort tie order: a decal under furniture under a person at the same depth. */
export function tieRankOf(prop: PropDef): number {
  return DECAL_KINDS.has(prop.kind) ? 0 : 1
}

function paintDesk(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w, h } = prop.rect

  drawBlock(g, [x, y, w, h - 8], { front: 8, tones: WOOD })
  fill(g, [x + 1, y + h, 2, 3], INK)
  fill(g, [x + w - 3, y + h, 2, 3], INK)
  fill(g, [x + 6, y + 2, 10, 6], PAPER)
}

function paintChair(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w } = prop.rect
  const back = prop.variant === 1 ? 9 : 11

  fill(g, [x, y, w, back], INK)
  fill(g, [x + 1, y + 1, w - 2, back - 2], '#5C6E90')
  fill(g, [x + 1, y + 1, w - 2, 1], '#7C8EB0')

  if (prop.variant === 1) {
    fill(g, [x + w / 2 - 1, y + back, 2, 4], INK)
  }
}

function paintShelf(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w, h } = prop.rect

  castShadow(g, [x + 2, y + h, w, 3])
  framed(g, [x, y, w, h], DARKWOOD[1])

  for (let row = y + 2; row < y + h - 4; row += 12) {
    for (let i = 0; i < w - 4; i += 3) {
      const tall = 7 + ((i * 5 + row) % 4)

      fill(
        g,
        [x + 2 + i, row + 10 - tall, 2, tall],
        BOOK_TONES[(i / 3 + row) % BOOK_TONES.length] ?? INK
      )
    }

    fill(g, [x, row + 10, w, 2], DARKWOOD[2])
  }
}

function paintBooks(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, h } = prop.rect
  const base = y + h - 6

  fill(g, [x - 1, base + 5, 15, 1], INK)

  for (let i = 0; i < PASTEL.length; i++) {
    const shift = prop.variant === 1 ? i : i * 2

    fill(g, [x + (i % 2), base - shift, 12 + (i % 3), 5], PASTEL[i] ?? PAPER)
  }
}

// Dark unless someone works at it: no one does until the crew sits down.
// The screen stands on its desk at the top of the box the computer covers.
function paintComputer(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w } = prop.rect

  framed(g, [x, y, w, MONITOR_PX], SCREEN_OFF)
  fill(g, [x + 1, y + 1, w - 2, 1], SCREEN_EDGE)
  fill(g, [x + w / 2 - 1, y + MONITOR_PX, 2, 3], SCREEN_EDGE)
  fill(g, [x + w / 2 - 4, y + MONITOR_PX + 3, 8, 1], SCREEN_EDGE)
}

function paintPrinter(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  const { x, y } = prop.rect

  drawBlock(g, [x, y, 22, 8], { front: 10, tones: METAL })
  fill(g, [x + 4, y + 2, 14, 3], SCREEN_EDGE)
  fill(g, [x + 17, y + 11, 2, 2], scene.isPrinting ? LED_PRINT : SCREEN_EDGE)

  if (scene.isPrinting) {
    fill(g, [x + 5, y - 3, 12, 4], PAPER)
  }
}

function paintRack(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w, h } = prop.rect

  framed(g, [x, y, w, h], '#C9D1DE')

  for (let row = y + 3; row + 4 <= y + h - 2; row += 5) {
    fill(g, [x + 2, row, w - 4, 4], '#343B55')
    fill(g, [x + 3, row + 1, 2, 2], LED_OFF)
  }
}

function paintBox(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w, h } = prop.rect

  drawBlock(g, [x, y, w, 8], { front: h - 9, tones: CARD })
  fill(g, [x + w / 2 - 1, y, 2, 8], '#F1DDB4')
  fill(g, [x + 3, y + 10, 6, 3], PAPER)
}

function paintTable(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w, h } = prop.rect
  const isCart = prop.variant === 1
  const front = isCart ? 6 : 8

  drawBlock(g, [x, y, w, h - front], { front, tones: isCart ? METAL : DARKWOOD })

  if (isCart) {
    fill(g, [x + 2, y + h, 4, 3], INK)
    fill(g, [x + w - 6, y + h, 4, 3], INK)
  }
}

function paintCooler(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y } = prop.rect
  const body = y + 17

  drawBlock(g, [x, body, 12, 6], { front: 18, tones: METAL })
  framed(g, [x + 2, y + 1, 8, 15], '#5AAAE9')
  fill(g, [x + 3, y + 1, 6, 4], '#D9EFFB')
  fill(g, [x + 3, body + 9, 3, 2], '#4F8FD6')
  fill(g, [x + 7, body + 9, 3, 2], '#D8625A')
}

function paintCoffee(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w } = prop.rect
  const isBar = prop.variant !== 1
  const top = isBar ? y + 8 : y + 12

  drawBlock(g, [x, top, w, isBar ? 5 : 10], { front: isBar ? 6 : 12, tones: WOOD })
  framed(g, isBar ? [x + 2, y + 1, 6, 7] : [x + 5, y + 1, 10, 11], '#4E5A6E')
  cup(g, x + w - 7, top - 4)
}

function cup(g: CanvasRenderingContext2D, x: number, y: number): void {
  fill(g, [x, y, 4, 1], '#4A2C17')
  fill(g, [x, y + 1, 4, 2], PAPER)
  fill(g, [x + 4, y + 1, 1, 2], PAPER)
}

function paintVending(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w, h } = prop.rect

  framed(g, [x, y, w, h], '#D8D0E8')
  fill(g, [x + 1, y + 1, w - 2, h - 12], '#2B3050')

  for (let row = 0; row < 3; row++) {
    fill(g, [x + 2, y + 3 + row * 8, 6, 6], LED_OFF)
    fill(g, [x + 9, y + 3 + row * 8, 6, 6], LED_OFF)
  }
}

function paintSofa(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w } = prop.rect

  fill(g, [x - 1, y, w + 2, 9], INK)
  fill(g, [x, y + 1, w, 7], FABRIC[1])
  drawBlock(g, [x, y + 8, w, 10], { front: 10, tones: FABRIC })
}

// The leaves spread two px past the pot each side.
function paintPlant(g: CanvasRenderingContext2D, prop: PropDef): void {
  const x = prop.rect.x - 2
  const { y } = prop.rect

  castShadow(g, [x, y + 14, 12, 3])
  framed(g, [x + 2, y + 9, 8, 6], '#C9845A')
  framed(g, [x, y - 1, 12, 9], LEAF[1])
  framed(g, [x + 3, y - 4, 6, 4], LEAF[0])
  fill(g, [x + 1, y + 4, 4, 3], LEAF[2])
}

// The room's floor lamp, lit exactly while its switch is on.
function paintLamp(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  const { x, y, w, h } = prop.rect
  const cx = x + w / 2
  const base = y + h
  const isOn = scene.lit.has(prop.room)

  castShadow(g, [cx - 6, base - 1, 12, 3])
  framed(g, [cx - 4, base - 3, 8, 2], METAL[2])
  framed(g, [cx - 1, y + 13, 2, h - 16], METAL[2])
  framed(g, [x, y, w, 7], isOn ? LAMP_LIT : LAMP_SHADE)
  fill(g, [x, y + 7, w, 6], isOn ? LAMP_LIT_FRONT : LAMP_SHADE_FRONT)
}

function paintTank(g: CanvasRenderingContext2D, prop: PropDef, scene: PaintScene): void {
  const { x, y, w } = prop.rect
  const isOn = scene.lit.has(prop.room)

  drawBlock(g, [x, y + 17, w, 2], { front: 7, tones: DARKWOOD })
  framed(g, [x, y + 2, w, 13], isOn ? '#BFE6F5' : '#5E8399')
  fill(g, [x, y, w, 2], isOn ? '#FFF7C2' : '#7A7F8C')
  fill(g, [x, y + 13, w, 2], isOn ? '#E6D3A3' : '#9C8E6E')
  fill(g, [x + 7, y + 6, 1, 7], '#4FA373')
  fill(g, [x + 25, y + 8, 1, 5], '#3F9163')
}

function paintCabinet(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w, h } = prop.rect

  drawBlock(g, [x, y, w, 6], { front: h - 7, tones: METAL })

  for (let i = 0; i < 3; i++) {
    fill(g, [x + 1, y + 8 + i * 10, w - 2, 1], METAL[2])
    fill(g, [x + w / 2 - 2, y + 10 + i * 10, 4, 1], SCREEN_EDGE)
  }
}

function paintCatalogue(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y } = prop.rect

  drawBlock(g, [x, y, 28, 5], { front: prop.rect.h - 6, tones: DARKWOOD })

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      fill(g, [x + 2 + col * 9, y + 7 + row * 5, 7, 3], DARKWOOD[2])
      fill(g, [x + 4 + col * 9, y + 8 + row * 5, 3, 1], '#E8D5A8')
    }
  }
}

function paintNewsRack(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w, h } = prop.rect

  framed(g, [x, y, w, h - 2], DARKWOOD[1])
  fill(g, [x, y + h - 2, w, 2], DARKWOOD[2])

  for (let i = 0; i < 3; i++) {
    fill(g, [x + 1 + i * 4, y + 2, 3, 15 - i], PASTEL[(i + 1) % PASTEL.length] ?? PAPER)
  }
}

function paintCoatRack(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, h } = prop.rect
  const pole = x + 4

  castShadow(g, [pole - 4, y + h - 3, 10, 3])
  fill(g, [pole - 4, y + h - 3, 10, 2], METAL[2])
  fill(g, [pole, y, 2, h - 2], INK)
  fill(g, [pole - 5, y + 3, 12, 2], WOOD[2])
  framed(g, [pole + 3, y + 7, 4, 9], '#A9C2E8')
}

function paintLadder(g: CanvasRenderingContext2D, prop: PropDef): void {
  const { x, y, w, h } = prop.rect

  fill(g, [x, y, 1, h], WOOD[2])
  fill(g, [x + w - 1, y, 1, h], WOOD[2])

  for (let rung = 0; rung < 6; rung++) {
    fill(g, [x, y + 3 + rung * 5, w, 1], WOOD[1])
  }
}
