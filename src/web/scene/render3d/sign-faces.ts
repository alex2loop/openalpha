import type { FloorId, LiftView, RoomId } from '@/web/scene/types'
import { isPrintingRun, roomStatus } from '@/web/scene/data/room-status'
import {
  paintCopier,
  paintLift,
  paintPlaque,
  paintVending,
  type VendingRow,
} from '@/web/scene/render3d/face-paint-signs'
import { liftPanelOf } from '@/web/scene/render3d/lift'
import { LIFT_LAMP_FLOORS } from '@/web/scene/sprites/lift-look'
import { type PropDef, propsOn } from '@/web/scene/world/props'
import { roomById } from '@/web/scene/world/rooms'
import { knownMarkets } from '@/web/state/market'
import { locale } from '@/web/state/session'
import { tr } from '@/web/text/tr'

// A face stands this far in front of what it covers, so the two never share a plane.
const FACE_LIFT_PX = 0.06
// The mockup's vending front and copier screen, from their prop's corner.
const VENDING_FACE = Object.freeze({ dx: 9, y: 22, w: 15, h: 31, proud: 0.15 })
const COPIER_FACE = Object.freeze({ dx: 13, dz: 10.5, rise: 0.9, w: 7.4, h: 3.7, tilt: -0.5 })
// The front desk's plaque, on its front below the top.
const PLAQUE_FACE = Object.freeze({ w: 14, h: 3.5, y: 8, proud: 0.45 })

/** A sign the page's state paints: the lift's indicator, the vending front, the front desk's
 *  plaque and the copier's screen. */
export interface SignFace {
  readonly kind: 'lift' | 'vending' | 'plaque' | 'copier'
  readonly room: RoomId
  readonly at: readonly [x: number, y: number, z: number]
  readonly size: readonly [w: number, h: number]
  readonly tilt: number
}

/** What the signs read from the frame: the lift, which is not a page signal. */
export interface SignFrame {
  readonly lift: LiftView
}

/** The floor's signs, one per prop that carries one. */
export function signFacesOf(floor: FloorId): SignFace[] {
  return propsOn(floor).flatMap((prop) => {
    const face = signOf(prop)

    return face === undefined ? [] : [face]
  })
}

/** What a sign's face reads, by value: unchanged values ask no face again. */
export function signInputsOf(frame: SignFrame): readonly unknown[] {
  return [frame.lift.floor, frame.lift.called.join(), knownMarkets.value, locale.value]
}

/** A sign's signature now and the painter that draws it. */
export function signJobOf(
  face: SignFace,
  frame: SignFrame
): { readonly key: string; readonly paint: (c: CanvasRenderingContext2D) => void } {
  switch (face.kind) {
    case 'lift': {
      const roomFloor = roomById(face.room)?.floor
      const lift = {
        digits: LIFT_LAMP_FLOORS.map((_, i) => String(i + 1)),
        at: LIFT_LAMP_FLOORS.indexOf(frame.lift.floor),
        isCalled: roomFloor !== undefined && frame.lift.called.includes(roomFloor),
      }

      return { key: JSON.stringify(lift), paint: (c) => paintLift(c, lift) }
    }
    case 'vending': {
      const rows = vendingRows()

      return { key: JSON.stringify(rows), paint: (c) => paintVending(c, rows) }
    }
    case 'plaque': {
      const text = tr('ui.office.crew.receptionist').toLocaleUpperCase(locale.value)

      return { key: text, paint: (c) => paintPlaque(c, text) }
    }
    default: {
      const isBusy = isPrintingRun(roomStatus.value.get('lib')?.runs[0])
      const copier = {
        text: tr(isBusy ? 'ui.office.copier.printing' : 'ui.office.copier.ready'),
        isBusy,
      }

      return { key: JSON.stringify(copier), paint: (c) => paintCopier(c, copier) }
    }
  }
}

function signOf(prop: PropDef): SignFace | undefined {
  const { x, y, w, h } = prop.rect
  const base = { room: prop.room, tilt: 0 }

  switch (prop.kind) {
    case 'lift-door': {
      const panel = liftPanelOf(prop)

      return {
        ...base,
        kind: 'lift',
        at: [panel.at[0], panel.at[1], panel.at[2] + FACE_LIFT_PX],
        size: panel.size,
      }
    }
    case 'vending':
      return {
        ...base,
        kind: 'vending',
        at: [x + VENDING_FACE.dx, VENDING_FACE.y, y + h + VENDING_FACE.proud],
        size: [VENDING_FACE.w, VENDING_FACE.h],
      }
    case 'guest-desk':
      return {
        ...base,
        kind: 'plaque',
        at: [x + w / 2, PLAQUE_FACE.y, y + h + PLAQUE_FACE.proud],
        size: [PLAQUE_FACE.w, PLAQUE_FACE.h],
      }
    case 'copier':
      return {
        ...base,
        kind: 'copier',
        at: [x + COPIER_FACE.dx, prop.height + COPIER_FACE.rise, y + COPIER_FACE.dz],
        size: [COPIER_FACE.w, COPIER_FACE.h],
        tilt: COPIER_FACE.tilt,
      }
    default:
      return undefined
  }
}

// One slot per market, lit while it trades; a market with no session hours never closes.
function vendingRows(): readonly VendingRow[] {
  return knownMarkets.value.map((market) => {
    const phase = market.session?.phase

    return {
      name: market.benchmark?.ticker ?? market.label,
      isOpen: phase === undefined || phase === 'open',
    }
  })
}
