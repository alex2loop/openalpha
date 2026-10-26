import { type Box, box } from '@/web/scene/render3d/boxes'
import { PALETTE } from '@/web/scene/sprites/palette'
import { seedOf } from '@/web/scene/world/rng'

const STUDIO = Object.freeze({ w: 6.4, h: 3.2, base: '#3B404B', body: '#C7CCD4', top: '#E4E7EC' })
const PORT = '#1F222A'
const TRAY = Object.freeze({ w: 13, d: 8, base: '#C9D0DC', rim: '#B9C1CE' })
// A junior's phone lying screen up; its finish is kept by its desk.
const PHONE = Object.freeze({ w: 5, d: 10.4, glass: '#050608' })
// The mockup's four phone finishes (silver, black, glacier, burgundy): body and bright edge.
const PHONE_FINISHES = [
  ['#C9CCD3', '#E6E8EC'],
  ['#2B2D33', '#4A4D55'],
  ['#A9C0D4', '#CBDAE7'],
  ['#6E2638', '#8F3A4F'],
] as const
const GLASS_WATER = '#BFE0F2'
const PLACARD_LINE = '#8E8497'
const CABLE = Object.freeze({ tray: '#B9C0CC', rail: '#AAB1BD', y: 36, gap: 22 })

/** Where a desk piece stands: its floor corner and the top it stands on. */
export interface Place {
  readonly x: number
  readonly z: number
  readonly top: number
}

// A Mac Studio: a darker base ring, the brushed body, its top, two front ports and the SD slot.
export function studio(out: Box[], at: Place): void {
  const { x, z, top } = at
  const { w, h } = STUDIO

  out.push(
    box([x + 0.25, z + 0.25, w - 0.5, w - 0.5, top, 0.5], STUDIO.base),
    box([x, z, w, w, top + 0.5, h - 0.5], STUDIO.body, true),
    box([x + 0.6, z + 0.6, w - 1.2, w - 1.2, top + h - 0.2, 0.3], STUDIO.top),
    box([x + 1, z + w - 0.1, 0.55, 0.2, top + 1.1, 0.4], PORT),
    box([x + 1.9, z + w - 0.1, 0.55, 0.2, top + 1.1, 0.4], PORT),
    box([x + 3.1, z + w - 0.1, 1.1, 0.2, top + 1.29, 0.22], PORT)
  )
}

// A phone lying screen up: its body and bright edge in its desk's finish, and the dark glass.
export function deskPhone(out: Box[], at: Place & { readonly key: string }): void {
  const { x, z, top } = at
  const { w, d } = PHONE
  const [body, edge] = PHONE_FINISHES[seedOf(at.key) % PHONE_FINISHES.length] ?? PHONE_FINISHES[0]

  out.push(
    box([x, z, w, d, top, 0.8], body, true),
    box([x + 0.15, z + 0.15, w - 0.3, d - 0.3, top + 0.8, 0.07], edge),
    box([x + 0.35, z + 0.35, w - 0.7, d - 0.7, top + 0.87, 0.04], PHONE.glass)
  )
}

// A turned mug of coffee, drawn with the floor's other mugs as one mesh.
export function mug(mugs: [number, number, number][], at: Place): void {
  mugs.push([at.x, at.top, at.z])
}

export function pitcher(out: Box[], at: Place): void {
  const { x, z, top } = at

  out.push(
    box([x, z, 3.6, 3.6, top, 6.5], GLASS_WATER, true),
    box([x + 3.4, z + 1, 1.4, 1.4, top + 3.5, 1], GLASS_WATER)
  )

  for (let i = 0; i < 3; i++) {
    out.push(box([x + 7 + i * 4, z + 0.5, 2.6, 2.6, top, 3], PALETTE.paper, true))
  }
}

export function placard(out: Box[], at: Place): void {
  out.push(
    box([at.x, at.z, 8, 1.4, at.top, 3.6], PALETTE.paper),
    box([at.x + 1.2, at.z + 1.45, 5.6, 0.3, at.top + 1, 0.6], PLACARD_LINE)
  )
}

// A cable tray overhead on posts every `CABLE.gap` px.
export function cableTray(
  out: Box[],
  at: { readonly x: number; readonly z: number; readonly w: number }
): void {
  const { x, z, w } = at

  out.push(
    box([x, z, w, 4, CABLE.y, 1.5], CABLE.tray),
    box([x, z, w, 0.8, CABLE.y + 1.5, 2.2], CABLE.rail),
    box([x, z + 3.2, w, 0.8, CABLE.y + 1.5, 2.2], CABLE.rail)
  )

  for (let i = 0; i < w; i += CABLE.gap) {
    out.push(box([x + i, z + 1, 2, 2, 0, CABLE.y], CABLE.rail))
  }
}

// The in-tray: a base and four low sides; its stack is placed by `effects`.
export function inTray(out: Box[], at: Place): void {
  const { x, z, top } = at
  const { w, d } = TRAY

  out.push(
    box([x, z, w, d, top, 0.8], TRAY.base),
    box([x, z, w, 0.8, top + 0.8, 2], TRAY.rim),
    box([x, z + d - 0.8, w, 0.8, top + 0.8, 2], TRAY.rim),
    box([x, z, 0.8, d, top + 0.8, 2], TRAY.rim),
    box([x + w - 0.8, z, 0.8, d, top + 0.8, 2], TRAY.rim)
  )
}
