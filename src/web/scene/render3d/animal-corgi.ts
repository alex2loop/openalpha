import type { DetailLevel } from '@/web/scene/sim/life/animal-model'
import {
  type AnimalPart,
  type Ellipsoid,
  e,
  GLINT,
  leanedAt,
  type ModelPose,
  part,
  type Vec,
} from '@/web/scene/render3d/animal-parts'

// The mockup's corgi colours.
const CORGI = Object.freeze({
  fur: '#CB8841',
  fur2: '#B5743A',
  white: '#F5EADB',
  white2: '#EAD2B4',
  nose: '#1C1517',
  eye: '#2A1B17',
  inner: '#E9C7A6',
})
// Where the head and the tail hang off the body in each stance.
const CORGI_HEAD_AT = Object.freeze({
  stand: [37, 39.5, 0],
  sleep: [33, 12.5, 0],
  lie: [34, 31, 0],
} as const)
const CORGI_TAIL_AT = Object.freeze({
  stand: [-30, 22, 0],
  sleep: [-29, 10, 0],
  lie: [-29, 12.5, 0],
} as const)

/** The mockup's corgi in `pose` at a detail level. */
export function corgiShape(pose: ModelPose, level: DetailLevel): AnimalPart[] {
  const { fur2, white, white2, inner } = CORGI
  const sleeping = pose === 'sleep'
  const standing = pose === 'stand'
  const earLean = sleeping ? 0.85 : 0.15
  const body = standing ? corgiStandingBody() : corgiLyingBody(sleeping)
  const legs = standing ? corgiLegs() : []
  const head = corgiHead(sleeping, level, earLean)

  const ear = [e([0, 6.5, 0], [4.6, 7.6, 1.5], { tone: fur2 })]

  if (level >= 1) {
    ear.push(e([0, 5.8, 0], [2.9, 5.2, 1.62], { tone: inner }))
  }

  const tail = [
    e([-2.5, 0, 0], [5, 4, 4], { tone: white2 }),
    e([-8, -2.8, 0], [8, 3, 3.2], { tone: white2, turn: [0.45, 0] }),
  ]

  if (level >= 2) {
    tail.push(e([-12, -5, 0], [4, 2.4, 2.6], { tone: white, turn: [0.5, 0] }))
  }

  const stance = corgiStanceOf(pose)

  return [
    part('body', { at: [0, 0, 0] }, body),
    part(
      'head',
      { parent: 'body', at: CORGI_HEAD_AT[stance], ...(sleeping ? { turn: [-0.1, 0] } : {}) },
      head
    ),
    part('ear', { parent: 'head', at: [-3, 3, 4.6], turn: [earLean, 0] }, ear),
    part('tail', { parent: 'body', at: CORGI_TAIL_AT[stance] }, tail),
    ...legs,
  ]
}

// The corgi's head: the skull, muzzle and nose, its cheeks and eyes, and the far ear on it.
function corgiHead(sleeping: boolean, level: DetailLevel, earLean: number): Ellipsoid[] {
  const { fur, fur2, white, white2, nose, eye, inner } = CORGI
  const head: Ellipsoid[] = [
    e([0, 0, 0], [7.8, 7.2, 6.8], { tone: fur }),
    e([7, -0.2, 0], [6.5, 2.3, 2.8], { tone: fur }),
    e([8, -3.2, 0], [7, 3.6, 3.9], { tone: white2 }),
    e([14.6, -1.3, 0], [1.8, 1.5, 2], { tone: nose }),
  ]

  if (level >= 2) {
    head.push(e([4.5, 2.8, 0], [5, 1.1, 1.1], { tone: white }))
  }

  for (const s of [-1, 1]) {
    head.push(e([3, -3.6, 4.1 * s], [5, 4, 2.5], { tone: white }))
    head.push(e([5.2, 2.4, 5.1 * s], corgiEye(sleeping, level), { tone: eye }))

    if (level >= 2 && !sleeping) {
      head.push(
        e([5.9, 3.4, 5.8 * s], [0.55, 0.6, 0.4], { tone: GLINT }),
        e([6.1, 3.9, 4.2 * s], [1, 0.7, 0.8], { tone: fur2 })
      )
    }
  }

  const farEar = leanedAt([-3, 3, -4.6], 6.5, earLean)

  head.push(e(farEar, [4.6, 7.6, 1.5], { tone: fur2, turn: [earLean, 0] }))

  if (level >= 1) {
    head.push(e(farEar, [2.9, 5.2, 1.62], { tone: inner, turn: [earLean, 0] }))
  }

  return head
}

// Which of the corgi's three stances a pose takes.
function corgiStanceOf(pose: ModelPose): 'stand' | 'sleep' | 'lie' {
  if (pose === 'stand' || pose === 'sleep') {
    return pose
  }

  return 'lie'
}

function corgiEye(sleeping: boolean, level: DetailLevel): Vec {
  if (sleeping) {
    return [1.8, 0.45, 0.9]
  }

  return level > 0 ? [1.6, 1.9, 1.1] : [2.2, 2.2, 1.4]
}

function corgiStandingBody(): Ellipsoid[] {
  const { fur, fur2, white } = CORGI
  const body = [
    e([0, 20, 0], [29, 10, 9.6], { tone: fur }),
    e([20, 16.5, 0], [9.5, 9, 8.4], { tone: white }),
    e([26, 29, 0], [6.2, 9, 5.6], { tone: fur, turn: [-0.5, 0] }),
    e([30, 27.5, 0], [4, 6.5, 4.6], { tone: white, turn: [-0.5, 0] }),
  ]

  for (const s of [-1, 1]) {
    body.push(
      e([-17, 19, 5.8 * s], [10.5, 9.5, 5], { tone: fur }),
      e([14, 20, 5.8 * s], [8.5, 8, 4], { tone: fur2 })
    )
  }

  return body
}

// The four legs hang from a hip or shoulder pivot and swing while the corgi walks.
function corgiLegs(): AnimalPart[] {
  const { fur2, white } = CORGI

  return [-1, 1].flatMap((s) => {
    const side = s < 0 ? 'a' : 'b'

    return [
      part(`legF${side}`, { parent: 'body', at: [16, 18, 5.4 * s] }, [
        e([1, -8, -0.4 * s], [4, 10, 3.5], { tone: fur2 }),
        e([2.5, -13.8, -0.4 * s], [3.6, 4.6, 3.2], { tone: white }),
        e([4.5, -16.6, -0.4 * s], [5, 2, 3.4], { tone: white }),
      ]),
      part(`legB${side}`, { parent: 'body', at: [-18, 17, 5.4 * s] }, [
        e([-1, -10, 0], [3.6, 7, 3], { tone: white, turn: [0.15, 0] }),
        e([1.5, -15.7, 0], [5, 2, 3.2], { tone: white }),
      ]),
    ]
  })
}

function corgiLyingBody(sleeping: boolean): Ellipsoid[] {
  const { fur, fur2, white } = CORGI
  const y0 = sleeping ? -2 : 0
  const flat = sleeping ? 1 : 0
  const body = [
    e([0, 13 + y0, 0], [28, 8.6 - flat, 10], { tone: fur }),
    e([20, 12 + y0, 0], [10, 8 - flat, 8.5], { tone: white }),
    sleeping
      ? e([22, 15, 0], [6.5, 6.5, 6], { tone: fur, turn: [-1, 0] })
      : e([22, 22, 0], [6.5, 9, 6], { tone: fur, turn: [-0.35, 0] }),
  ]

  if (!sleeping) {
    body.push(e([26.5, 20, 0], [4, 7, 4.8], { tone: white, turn: [-0.35, 0] }))
  }

  for (const s of [-1, 1]) {
    body.push(
      e([-15, 10 + y0, 7.5 * s], [12, 8.6 - flat, 5.5], { tone: fur }),
      e([13, 14 + y0, 6 * s], [8, 7.4 - flat, 4], { tone: fur2 }),
      e([17, 7 + y0, 5.5 * s], [6, 5.5 - flat * 0.5, 3.4], { tone: fur2 }),
      e([27, 3.6 + y0 * 0.3, 5.4 * s], [9.5, 3.4, 3.1], { tone: white }),
      e([35, 2.4 + y0 * 0.1, 5.2 * s], [4.4, 2.4, 3.1], { tone: white }),
      e([-4, 2.6 + y0 * 0.2, 13 * s], [8, 2.5, 3.2], { tone: white })
    )
  }

  return body
}
