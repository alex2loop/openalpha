import type { FloorId, Point, RoomId } from '@/web/scene/types'
import { type Box, box, type Spot } from '@/web/scene/render3d/boxes'
import { HEIGHT_K } from '@/web/scene/render3d/space'
import {
  CARD,
  DARKWOOD,
  FABRIC,
  METAL,
  OUTLINE,
  PALETTE,
  PROP_TONES,
  WOOD,
} from '@/web/scene/sprites/palette'
import { isWallMounted, type PropDef, type PropKind, propsOn } from '@/web/scene/world/props'
import { roomById, WALL_BAND_PX } from '@/web/scene/world/rooms'
import { SEATS, SOFA_SEATS, TEAM_SEATS } from '@/web/scene/world/seats'

/** A floor's furniture: static boxes by room, glass, and the parts that change while it shows. */
export interface FloorProps {
  readonly rooms: Map<RoomId, Box[]>
  readonly glass: Box[]
  /** Each computer's screen face, and the seat in front of it whose worker lights it. */
  readonly screens: Screen[]
  /** Each lamp's shade and the room whose switch it follows. */
  readonly lamps: Lamp[]
}

interface Screen {
  readonly at: readonly [x: number, y: number, z: number]
  readonly size: readonly [w: number, h: number, d: number]
  readonly seat: Point
}

interface Lamp {
  readonly room: RoomId
  readonly at: Point
  readonly shadeY: number
}

interface Build {
  readonly prop: PropDef
  readonly out: Box[]
  readonly floor: FloorProps
}

type Recipe = (job: Build) => void

const SCREEN_BEZEL = '#2B2433'
const BOARD_FRAME = '#C9CDD6'
const ART = ['#D9B98F', '#C9B9D9', '#E8C9A0', '#BFD3EE'] as const
const RACK_TONE = '#3A3F52'
const COOLER_BODY = '#D9DEE8'
const COOLER_WATER = '#8FD3F4'
const VENDING_FACE = '#2F3F78'
const PHONE_TONE = '#D86A66'
// A desk phone's height counts the desk under it.
const PHONE_ON_DESK_PX = 4.5
const PHONE_PX = 1.6
const COUNTER_PX = 13
const MACHINE_TONE = '#9DB0CC'
const TANK_WATER = '#8CCBEA'
const DESK_TOP_PX = 2
const LEG_PX = 2
const SEAT_PX = 7
const CHAIR_BACK_PX = 14
const MONITOR_BASE_PX = 15
const MONITOR_PX = 9
const WALL_FACE_PROUD = 0.8
const FACE_PLATE_PX = 0.3
const LAMP_SHADE = Object.freeze({ w: 10, h: 8, y: 50 })
const LAMP_BASE = Object.freeze({ w: 8, h: 2 })
const LAMP_POLE = 1.6
// The seat a screen's worker sits at stands this far south of the monitor.
const SCREEN_SEAT_DZ = 8

/** The furniture of `floor`, built once per floor from `world/props`. */
export function buildFloorProps(floor: FloorId): FloorProps {
  const built: FloorProps = { rooms: new Map(), glass: [], screens: [], lamps: [] }

  for (const prop of propsOn(floor)) {
    const out = built.rooms.get(prop.room) ?? []

    built.rooms.set(prop.room, out)

    if (isWallMounted(prop)) {
      wallPiece({ prop, out, floor: built })
    } else {
      RECIPES[prop.kind]?.({ prop, out, floor: built })
    }
  }

  return built
}

function spot(prop: PropDef, rise: readonly [y: number, h: number], inset = 0): Spot {
  const { x, y, w, h } = prop.rect

  return [x + inset, y + inset, w - inset * 2, h - inset * 2, rise[0], rise[1]]
}

const RECIPES: Readonly<Partial<Record<PropKind, Recipe>>> = Object.freeze({
  desk: deskOf(WOOD),
  'guest-desk': deskOf(WOOD),
  table: (job) => deskOf(tableTones(job.prop))(job),
  chair: chair,
  shelf: shelf,
  books: ({ prop, out }) => {
    for (const [i, tone] of PROP_TONES.books.slice(0, 3).entries()) {
      out.push(box(spot(prop, [i * 2, 2], i), tone, true))
    }
  },
  computer: computer,
  printer: ({ prop, out }) => {
    out.push(box(spot(prop, [0, prop.height - 2]), METAL[1], true))
    out.push(box(spot(prop, [prop.height - 2, 2], 1), METAL[0], true))
  },
  copier: ({ prop, out }) => {
    out.push(box(spot(prop, [0, prop.height]), PROP_TONES.copier[1], true))
    out.push(box(spot(prop, [prop.height - 3, 3], 1), PROP_TONES.copier[0], true))
  },
  rack: ({ prop, out }) => {
    out.push(box(spot(prop, [0, prop.height]), RACK_TONE, true))
    for (let row = 6; row < prop.height - 4; row += 6) {
      out.push(
        box(
          [prop.rect.x + 2, prop.rect.y + prop.rect.h, prop.rect.w - 4, 0.6, row, 1],
          PROP_TONES.ledOn
        )
      )
    }
  },
  tray: ({ prop, out }) => out.push(box(spot(prop, [4.6, 1]), METAL[2])),
  box: ({ prop, out }) => {
    out.push(box(spot(prop, [0, prop.height]), CARD[1], true))
    out.push(
      box(
        [
          prop.rect.x + prop.rect.w / 2 - 1.5,
          prop.rect.y,
          3,
          prop.rect.h + 0.2,
          prop.height - 0.4,
          0.6,
        ],
        CARD[0]
      )
    )
  },
  phone: ({ prop, out }) =>
    out.push(box(spot(prop, [prop.height - PHONE_ON_DESK_PX, PHONE_PX], 1), PHONE_TONE, true)),
  cooler: ({ prop, out }) => {
    out.push(box(spot(prop, [0, prop.height - 12]), COOLER_BODY, true))
    out.push(box(spot(prop, [prop.height - 12, 12], 2), COOLER_WATER, true))
  },
  coffee: (job) => {
    const { rect } = job.prop

    deskOf(WOOD)({ ...job, prop: { ...job.prop, height: COUNTER_PX } })
    job.out.push(
      box(
        [rect.x + 4, rect.y + 2, 10, Math.min(9, rect.h - 2), COUNTER_PX, COUNTER_PX],
        MACHINE_TONE,
        true
      )
    )
  },
  drinks: ({ prop, out }) => {
    out.push(box(spot(prop, [0, prop.height - 3]), WOOD[1], true))
    out.push(box([prop.rect.x + 2, prop.rect.y + 2, 3, 3, prop.height - 3, 3], PALETTE.paper, true))
  },
  vending: ({ prop, out }) => {
    out.push(box(spot(prop, [0, prop.height]), PROP_TONES.vending, true))
    out.push(
      box(
        [prop.rect.x + 2, prop.rect.y + prop.rect.h, prop.rect.w - 4, 0.6, 6, prop.height - 12],
        VENDING_FACE
      )
    )
  },
  sofa: sofa,
  plant: ({ prop, out }) => {
    out.push(box(spot(prop, [0, 6], 1), PROP_TONES.pot, true))
    out.push(box(spot(prop, [6, 6], -1), PROP_TONES.leaf[1], true))
    out.push(box(spot(prop, [11, 5], 1), PROP_TONES.leaf[0], true))
  },
  lamp: lamp,
  tank: ({ prop, out, floor }) => {
    out.push(box(spot(prop, [0, 8]), DARKWOOD[1], true))
    floor.glass.push(box(spot(prop, [8.8, 8.6], 0.2), TANK_WATER))
    out.push(box(spot(prop, [17.2, 1], -0.4), '#E7E9EE'))
  },
  'cat-bed': ({ prop, out }) => {
    out.push(box(spot(prop, [0, 2]), PROP_TONES.catBed[0], true))
    out.push(box(spot(prop, [2, 0.6], 3), PROP_TONES.catBed[1], true))
  },
  cabinet: ({ prop, out }) => {
    out.push(box(spot(prop, [0, prop.height]), METAL[1], true))
    for (let row = 4; row < prop.height; row += 10) {
      out.push(
        box([prop.rect.x + 1, prop.rect.y + prop.rect.h, prop.rect.w - 2, 0.6, row, 7], METAL[0])
      )
    }
  },
  catalogue: ({ prop, out }) => {
    out.push(box(spot(prop, [0, prop.height]), WOOD[2], true))
    for (let row = 3; row < prop.height - 2; row += 5) {
      out.push(
        box([prop.rect.x + 1, prop.rect.y + prop.rect.h, prop.rect.w - 2, 0.6, row, 3.4], WOOD[0])
      )
    }
  },
  'news-rack': ({ prop, out }) => {
    out.push(box(spot(prop, [0, prop.height]), METAL[2], true))
    out.push(
      box(
        [prop.rect.x + 2, prop.rect.y + prop.rect.h, prop.rect.w - 4, 0.6, prop.height - 10, 8],
        PALETTE.paper
      )
    )
  },
  'coat-rack': ({ prop, out }) => {
    out.push(box(spot(prop, [0, 1.5], 1), DARKWOOD[2], true))
    out.push(box(spot(prop, [0, prop.height], 3), DARKWOOD[1]))
    out.push(box(spot(prop, [prop.height - 8, 1.4], 0), DARKWOOD[1]))
  },
  ladder: ({ prop, out }) => {
    const { x, y, w, h } = prop.rect

    out.push(
      box([x, y, 1.4, h, 0, prop.height], WOOD[2]),
      box([x + w - 1.4, y, 1.4, h, 0, prop.height], WOOD[2])
    )
    for (let rung = 5; rung < prop.height; rung += 6) {
      out.push(box([x, y + h / 2 - 0.5, w, 1, rung, 1], WOOD[1]))
    }
  },
})

function tableTones(prop: PropDef): readonly [string, string, string] {
  if (prop.room === 'meet') {
    return DARKWOOD
  }

  return prop.variant === 1 ? METAL : WOOD
}

function deskOf(tones: readonly [string, string, string]): Recipe {
  return ({ prop, out }) => {
    const { x, y, w, h } = prop.rect
    const top = prop.height - DESK_TOP_PX

    out.push(box([x - 0.5, y - 0.5, w + 1, h + 1, top, DESK_TOP_PX], tones[0], true))
    out.push(box([x + 1, y + 1, w - 2, LEG_PX, 0, top], tones[2]))
    out.push(box([x + 1, y + 1, LEG_PX, h - 2, 0, top], tones[1]))
    out.push(box([x + w - 1 - LEG_PX, y + 1, LEG_PX, h - 2, 0, top], tones[1]))
  }
}

// A chair's back stands on the side away from where its sitter looks.
function chair({ prop, out }: Build): void {
  const { x, y, w, h } = prop.rect
  const facesCamera = seatFacing(prop) === 'down'
  const backZ = facesCamera ? y : y + h - 2

  out.push(box([x, y, w, h, SEAT_PX - 2, 2], FABRIC[1], true))
  out.push(box([x + w / 2 - 1, y + h / 2 - 1, 2, 2, 0, SEAT_PX - 2], OUTLINE))
  out.push(box([x, backZ, w, 2, SEAT_PX, CHAIR_BACK_PX - SEAT_PX], FABRIC[2], true))
}

function seatFacing(prop: PropDef): string | undefined {
  const all = [
    ...SEATS.meet,
    ...SEATS.lib,
    ...SEATS.assist,
    ...TEAM_SEATS,
    ...SOFA_SEATS.office,
    ...SOFA_SEATS.team,
  ]
  const { x, y, w, h } = prop.rect

  return all.find(
    (seat) => seat.at.x >= x && seat.at.x <= x + w && seat.at.y >= y - 4 && seat.at.y <= y + h + 4
  )?.face
}

function shelf({ prop, out }: Build): void {
  out.push(box(spot(prop, [0, prop.height]), WOOD[2], true))

  for (let row = 2; row < prop.height - 4; row += 9) {
    PROP_TONES.books.forEach((tone, i) => {
      const w = (prop.rect.w - 4) / PROP_TONES.books.length

      out.push(
        box(
          [prop.rect.x + 2 + i * w, prop.rect.y + prop.rect.h, w - 0.6, 0.8, row, 6 + (i % 2)],
          tone
        )
      )
    })
  }
}

// A monitor on its stand; the screen face is drawn apart so it can light up.
function computer({ prop, out, floor }: Build): void {
  const { x, y, w, h } = prop.rect
  const cx = x + w / 2

  out.push(box([cx - 1, y, 2, h, MONITOR_BASE_PX - 1, 2], SCREEN_BEZEL))
  out.push(box([x, y, w, h, MONITOR_BASE_PX, MONITOR_PX], SCREEN_BEZEL, true))
  floor.screens.push({
    at: [cx, MONITOR_BASE_PX + MONITOR_PX / 2, y + h + 0.2],
    size: [w - 2, MONITOR_PX - 2, 0.4],
    seat: { x: cx, y: y + h + SCREEN_SEAT_DZ },
  })
}

function sofa({ prop, out }: Build): void {
  const { x, y, w, h } = prop.rect

  out.push(box([x, y, w, h, 0, 8], FABRIC[1], true))
  out.push(box([x, y, w, 4, 8, 10], FABRIC[2], true))
  out.push(
    box([x, y, 5, h, 8, 4], FABRIC[2], true),
    box([x + w - 5, y, 5, h, 8, 4], FABRIC[2], true)
  )
}

function lamp({ prop, out, floor }: Build): void {
  const cx = prop.rect.x + prop.rect.w / 2
  const cz = prop.rect.y + prop.rect.h / 2

  out.push(
    box(
      [cx - LAMP_BASE.w / 2, cz - LAMP_BASE.w / 2, LAMP_BASE.w, LAMP_BASE.w, 0, LAMP_BASE.h],
      METAL[2],
      true
    )
  )
  out.push(
    box(
      [
        cx - LAMP_POLE / 2,
        cz - LAMP_POLE / 2,
        LAMP_POLE,
        LAMP_POLE,
        LAMP_BASE.h,
        LAMP_SHADE.y - LAMP_BASE.h,
      ],
      METAL[2]
    )
  )
  floor.lamps.push({
    room: prop.room,
    at: { x: cx, y: cz },
    shadeY: LAMP_SHADE.y + LAMP_SHADE.h / 2,
  })
}

/** The lamp shade's size, for the instanced shades. */
export const LAMP_SHADE_SIZE: readonly [number, number, number] = [
  LAMP_SHADE.w,
  LAMP_SHADE.h,
  LAMP_SHADE.w,
]

function wallPiece({ prop, out, floor }: Build): void {
  const spots = wallSpotsOf(prop)
  const [frame, plate] = WALL_LOOKS[prop.kind] ?? [BOARD_FRAME, PALETTE.paper]
  const face = prop.kind === 'frame' ? (ART[(prop.variant ?? 0) % ART.length] ?? plate) : plate

  const faceList = prop.kind === 'window' ? floor.glass : out

  out.push(box(spots.frame, frame))
  faceList.push(box(spots.face, face))
}

/** A wall piece's frame and the face plate in front of it. One on a wall's band hangs on the north
 *  wall at the height that lines it up with 2D; one below the band stands on the floor facing the
 *  camera, its foot at the drawn box's bottom, so its face covers what 2D draws. */
export function wallSpotsOf(prop: PropDef): { readonly frame: Spot; readonly face: Spot } {
  const room = roomById(prop.room)
  const wallZ = (room?.rect.y ?? 0) + WALL_BAND_PX
  const { x, y, w, h } = prop.rect
  const isHung = y + h <= wallZ + 1
  const z = isHung ? wallZ : y + h
  const base = isHung ? (wallZ - (y + h)) / HEIGHT_K : 0
  const tall = h / HEIGHT_K

  return {
    frame: [x, z - (isHung ? 0 : WALL_FACE_PROUD), w, WALL_FACE_PROUD, base, tall],
    face: [x + 1, z + (isHung ? WALL_FACE_PROUD : 0), w - 2, FACE_PLATE_PX, base + 1, tall - 2],
  }
}

const WALL_LOOKS: Readonly<Partial<Record<PropKind, readonly [string, string]>>> = Object.freeze({
  whiteboard: [BOARD_FRAME, '#FAFAFC'],
  'results-board': [SCREEN_BEZEL, '#3E4C78'],
  'wall-screen': [SCREEN_BEZEL, '#27356A'],
  clock: [OUTLINE, PALETTE.paper],
  frame: [WOOD[2], PALETTE.paper],
  'light-switch': ['#F7F3EA', '#C9CDD6'],
  'lift-door': [PROP_TONES.liftFrame, PROP_TONES.liftLeaf],
  window: [BOARD_FRAME, '#CFE6FF'],
})
