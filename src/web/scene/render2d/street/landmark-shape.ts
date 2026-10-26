import { mixTone, NIGHT_TONE } from '@/web/scene/render2d/street/tone'

// The tower is drawn in its own design frame, 1 px to 0.5 m, with its foot centre at the origin
// and y up negative: 262 m to the spire, the podium at its foot, a curved glass shaft above it.
export const DESIGN = Object.freeze({
  height: 524,
  spire: 16,
  podium: 55,
  podiumW: 112,
  podiumPad: 5,
  glassH: 11,
  shaftHalfW: 52,
  drum: { x: -61, w: 30, h: 46 },
  // Where the curved silver panel beside the drum ends: the frontage's board left edge.
  panelRight: -23.5,
  // Floors are 4 m (8 px); the shaft steps in over a recessed band one floor tall, this many
  // floors above the podium's roof.
  floor: 8,
  bandFloors: 12,
  bandH: 8,
  helipadY: -380,
})
export const ROOF_Y = -DESIGN.podium
export const TIP_Y = -DESIGN.height + DESIGN.spire
export const BAND_Y = ROOF_Y - 7 - DESIGN.floor * DESIGN.bandFloors
// The shaft swells to its widest in the lower third, then tapers to the spire.
const SWELL_END = 0.3
const SWELL_BASE = 0.96
const TAPER_POWER = 1.85
const TAPER_DROP = 0.97
const SEAM_BASE = 0.22
const SEAM_SWEEP = 0.7
const SEAM_DECAY = 0.12
const BAND_INSET = 1.6
const BAND_STEP_IN = 3.4

/** What the tower painters read: the canvas, the darkness, the share of lit floors, the haze the
 *  distance puts over it, the sky's top and bottom, whether the night lights are on and whether
 *  the lobby still glows (the dead of night puts it out). */
export interface TowerPaint {
  readonly g: CanvasRenderingContext2D
  readonly dark: number
  readonly lit: number
  readonly haze: number
  readonly sky: readonly [string, string]
  readonly isNight: boolean
  readonly isLobbyLit: boolean
}

/** `hex` hazed toward the sky's bottom by the tower's distance, then darkened by `share` of the
 *  night. */
export function hazeTone(t: TowerPaint, hex: string, share: number): string {
  return nightTone(t, mixTone(hex, t.sky[1], t.haze), share)
}

/** `hex` darkened by `share` of the night. */
export function nightTone(t: TowerPaint, hex: string, share: number): string {
  return mixTone(hex, NIGHT_TONE, t.dark * share)
}

/** The shaft's half width at design `y`. */
export function halfWidthAt(y: number): number {
  const t = Math.min(1, Math.max(0, (ROOF_Y - y) / (ROOF_Y - TIP_Y)))
  const profile =
    t < SWELL_END
      ? SWELL_BASE + (1 - SWELL_BASE) * Math.sin(((t / SWELL_END) * Math.PI) / 2)
      : 1 - TAPER_DROP * ((t - SWELL_END) / (1 - SWELL_END)) ** TAPER_POWER
  const width = DESIGN.shaftHalfW * profile

  if (y < BAND_Y) {
    return width - BAND_INSET
  }

  return y < BAND_Y + DESIGN.bandH ? width - BAND_STEP_IN : width
}

/** Where the petal seam runs at design `y`: it sweeps up from the lower left. */
export function seamAt(y: number): number {
  const t = Math.min(1, Math.max(0, (ROOF_Y - y) / (ROOF_Y - TIP_Y)))

  return halfWidthAt(y) * -(SEAM_BASE + SEAM_SWEEP * Math.exp(-t / SEAM_DECAY))
}
