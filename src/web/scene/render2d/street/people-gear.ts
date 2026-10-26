import type { PersonView } from '@/web/scene/street-types'
import { fill } from '@/web/scene/render2d/street/vehicle-art'
import { UMBRELLA_TONES } from '@/web/scene/sprites/palette'

/** Bare-headed, a conical hat, a cap. */
export const HAT_KINDS = 3
/** A person under an umbrella or a hat needs a taller sprite. */
export const GEAR_BOX = Object.freeze({ h: 9.5, anchorY: 8.7 })
const UMBRELLA = Object.freeze({
  y: -5.6,
  r: 2.4,
  handle: [-0.12, -5.6, 0.24, 2.3] as const,
  handleTone: '#1F2230',
})
const HAT = Object.freeze({
  conical: '#E6D3A0',
  conicalEdge: '#BFA978',
  cap: '#3F5A8A',
  coneW: 1.5,
  coneTop: -5.7,
  coneBase: -4.45,
  crown: [-0.9, -4.95, 1.8, 0.55] as const,
  brim: [-0.2, -4.55, 1.5, 0.3] as const,
})

/** A conical hat or a cap against the sun; a side-on cap shows its brim ahead. `tone` darkens a
 *  colour for the night as the rest of the figure is. */
export function paintHat(
  g: CanvasRenderingContext2D,
  person: PersonView,
  tone: (hex: string) => string
): void {
  if (person.hat === 1) {
    g.fillStyle = tone(HAT.conical)
    g.beginPath()
    g.moveTo(-HAT.coneW, HAT.coneBase)
    g.lineTo(HAT.coneW, HAT.coneBase)
    g.lineTo(0, HAT.coneTop)
    g.closePath()
    g.fill()
    fill(g, tone(HAT.conicalEdge), [-HAT.coneW, HAT.coneBase - 0.15, HAT.coneW * 2, 0.2])
    return
  }

  if (person.hat !== 2) {
    return
  }

  fill(g, tone(HAT.cap), HAT.crown)

  if (person.facing === 'east' || person.facing === 'west') {
    const x = person.facing === 'east' ? HAT.brim[0] : -HAT.brim[0] - HAT.brim[2]

    fill(g, tone(HAT.cap), [x, HAT.brim[1], HAT.brim[2], HAT.brim[3]])
  }
}

/** An open umbrella over the head, in its own tone. */
export function paintUmbrella(
  g: CanvasRenderingContext2D,
  person: PersonView,
  tone: (hex: string) => string
): void {
  const canopy = UMBRELLA_TONES[person.umbrella - 1]

  if (canopy === undefined) {
    return
  }

  fill(g, tone(UMBRELLA.handleTone), UMBRELLA.handle)
  g.fillStyle = tone(canopy)
  g.beginPath()
  g.arc(0, UMBRELLA.y, UMBRELLA.r, Math.PI, Math.PI * 2)
  g.closePath()
  g.fill()
}
