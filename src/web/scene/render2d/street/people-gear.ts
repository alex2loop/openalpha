import { fill } from '@/web/scene/render2d/street/vehicle-art'
import { type PersonView, WAVE_FRAME } from '@/web/scene/street-types'

/** The street's umbrella canopies. */
export const STREET_UMBRELLAS = ['#3F7FC5', '#D8453B', '#2E7D4F', '#E8C94A'] as const
/** Bare-headed, a conical hat, a cap. */
export const HAT_KINDS = 3
/** A person under an umbrella or a hat needs a taller sprite. */
export const GEAR_BOX = Object.freeze({ h: 9.5, anchorY: 8.7 })
const UMBRELLA = Object.freeze({
  y: -5.2,
  r: 2.6,
  handle: [-0.08, -5.3, 0.16, 2.1] as const,
  handleTone: '#2A2D36',
})
const HAT = Object.freeze({
  conical: '#DCC896',
  conicalEdge: '#B9A272',
  coneW: 1.8,
  coneTop: -6,
  coneBase: -4.3,
  edge: [-1.8, -4.38, 3.6, 0.2] as const,
  caps: ['#3F7FC5', '#C9544A', '#2E7D4F', '#F2F0EA'] as const,
  capY: -4.2,
  capR: 0.95,
  brimSide: [0.3, -4.5, 1.1, 0.36] as const,
  brimFront: [-0.95, -4.28, 1.9, 0.3] as const,
})
// Arms face on (sleeve, swing share of the stride, hand) and side on (shoulder to elbow, the
// reach and the elbow's height, a jogger's higher and wider).
const ARM = Object.freeze({
  front: [-1.25, -3.1, 0.35, 1.3] as const,
  swing: 0.65 * 0.45,
  jogSwing: 0.9 * 0.45,
  hand: [0.35, 0.3] as const,
  shoulder: -3.05,
  elbow: -1.95,
  jogElbow: -2.5,
  reach: 0.8,
  jogReach: 1.1,
  w: 0.55,
  sideHand: [0.4, 0.35] as const,
})
const FACE = Object.freeze({
  eyes: [-0.45, 0.25] as const,
  eyeY: -4.05,
  eye: 0.22,
  sideEye: 0.45,
  mouth: [-0.2, -3.55, 0.4, 0.1] as const,
})
const WAVE = Object.freeze({
  x: 1.3,
  lift: 0.35,
  arm: [-0.22, -5.3, 0.45, 2.2],
  hand: 0.42,
} as const)
const HEADBAND = Object.freeze({ tone: '#D84A4A', rect: [-0.9, -4.7, 1.8, 0.35] as const })

/** A conical hat (its rim from the middle detail) or a cap in a colour of its own, its brim
 *  ahead side on and over the brow face on; a jogger's headband. `tone` darkens a colour for the
 *  night as the rest of the figure is. */
export function paintHat(
  g: CanvasRenderingContext2D,
  hat: { readonly person: PersonView; readonly detail: number; readonly seed: number },
  tone: (hex: string) => string
): void {
  const { person } = hat

  if (person.kind === 'jogger') {
    fill(g, tone(HEADBAND.tone), HEADBAND.rect)
  }

  if (person.hat === 1) {
    g.fillStyle = tone(HAT.conical)
    g.beginPath()
    g.moveTo(-HAT.coneW, HAT.coneBase)
    g.lineTo(0, HAT.coneTop)
    g.lineTo(HAT.coneW, HAT.coneBase)
    g.closePath()
    g.fill()

    if (hat.detail > 0) {
      fill(g, tone(HAT.conicalEdge), HAT.edge)
    }

    return
  }

  if (person.hat !== 2) {
    return
  }

  g.fillStyle = tone(HAT.caps[hat.seed % HAT.caps.length] ?? HAT.caps[0])
  g.beginPath()
  g.arc(0, HAT.capY, HAT.capR, Math.PI, Math.PI * 2)
  g.fill()

  if (person.facing === 'east' || person.facing === 'west') {
    const dir = person.facing === 'east' ? 1 : -1
    const [x, y, w, h] = HAT.brimSide

    g.fillRect(dir * x, y, dir * w, h)
  } else if (person.facing === 'south') {
    g.fillRect(HAT.brimFront[0], HAT.brimFront[1], HAT.brimFront[2], HAT.brimFront[3])
  }
}

/** An open umbrella over the head, in its own tone. */
export function paintUmbrella(
  g: CanvasRenderingContext2D,
  person: PersonView,
  tone: (hex: string) => string
): void {
  const canopy = STREET_UMBRELLAS[person.umbrella - 1]

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

export function isSideOn(person: PersonView): boolean {
  return person.facing === 'east' || person.facing === 'west'
}

export function facingDirOf(person: PersonView): -1 | 1 {
  return person.facing === 'west' ? -1 : 1
}

/** Sleeves swinging with the stride (-1, 0, 1) and the hands; side on, the near arm swings from
 *  the shoulder. */
export function paintArms(
  g: CanvasRenderingContext2D,
  arms: {
    readonly person: PersonView
    readonly stride: number
    readonly sleeve: string
    readonly hand: string
  }
): void {
  const { person, stride } = arms
  const isJogger = person.kind === 'jogger'

  if (isSideOn(person)) {
    const x = -facingDirOf(person) * stride * (isJogger ? ARM.jogReach : ARM.reach)
    const y = isJogger && stride !== 0 ? ARM.jogElbow : ARM.elbow

    g.strokeStyle = arms.sleeve
    g.lineWidth = ARM.w
    g.lineCap = 'round'
    g.beginPath()
    g.moveTo(0, ARM.shoulder)
    g.lineTo(x, y)
    g.stroke()
    fill(g, arms.hand, [x - ARM.sideHand[0] / 2, y - 0.1, ARM.sideHand[0], ARM.sideHand[1]])
    return
  }

  const swing = stride * (isJogger ? ARM.jogSwing : ARM.swing)
  const [x, y, w, h] = ARM.front

  fill(g, arms.sleeve, [x, y, w, h + swing])
  fill(g, arms.sleeve, [-x - w, y, w, h - swing])
  fill(g, arms.hand, [x, y + h + swing - 0.1, ARM.hand[0], ARM.hand[1]])
  fill(g, arms.hand, [-x - w, y + h - swing - 0.1, ARM.hand[0], ARM.hand[1]])
}

/** Eyes and a mouth face on, one eye side on. */
export function paintFace(
  g: CanvasRenderingContext2D,
  face: { readonly person: PersonView; readonly eye: string }
): void {
  const { person, eye } = face

  if (person.facing === 'south') {
    for (const x of FACE.eyes) {
      fill(g, eye, [x, FACE.eyeY, FACE.eye, FACE.eye])
    }

    fill(g, eye, FACE.mouth)
  } else if (isSideOn(person)) {
    fill(g, eye, [facingDirOf(person) * FACE.sideEye - 0.1, FACE.eyeY, FACE.eye, FACE.eye])
  }
}

/** A raised hand on the wave frames, higher on the second. */
export function paintWave(
  g: CanvasRenderingContext2D,
  wave: { readonly frame: number; readonly hand: string }
): void {
  if (wave.frame < WAVE_FRAME) {
    return
  }

  const x = WAVE.x + (wave.frame > WAVE_FRAME ? WAVE.lift : 0)

  g.fillStyle = wave.hand
  g.fillRect(x + WAVE.arm[0], WAVE.arm[1], WAVE.arm[2], WAVE.arm[3])
  g.beginPath()
  g.arc(x, WAVE.arm[1], WAVE.hand, 0, Math.PI * 2)
  g.fill()
}
