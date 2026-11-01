import type { DetailLevel } from '@/web/scene/sim/life/animal-model'
import {
  type AnimalPart,
  type Ellipsoid,
  e,
  GLINT,
  leanedAt,
  type ModelPose,
  NO_TURN,
  part,
  type Vec,
} from '@/web/scene/render3d/animal-parts'

// The mockup's tabby colours.
const CAT = Object.freeze({
  fur: '#E49A4F',
  fur2: '#CF7F36',
  dark: '#B0622B',
  cream: '#F7DFBB',
  pink: '#E89B9B',
  eye: '#A3CBA4',
  pupil: '#1B1416',
})
// The tail's segments: walking, its bends (x, y, turn); sitting, its curl round the feet (x, z,
// turn); asleep, the angles it wraps round the body at.
const TAIL = Object.freeze({
  walk: [
    [-2.5, 0.7, -0.25],
    [-6.5, 3, -0.6],
    [-9.6, 6.6, -1],
    [-10.8, 10.4, -1.3],
  ],
  sit: [
    [-12, 3, -1.2],
    [-10.5, 8.5, -1.37],
    [-5, 11.5, -0.3],
    [2, 11.8, 0],
    [9, 10.5, 0.17],
  ],
  sleep: [3, 2.4, 1.8, 1.3, 0.9],
} as const)
// Where the head hangs off the body, and how it turns, in each stance.
const CAT_HEAD = Object.freeze({
  sleep: { at: [9, 6, 7], turn: [-0.15, -0.25] },
  walk: { at: [12.5, 16.5, 0], turn: [0, 0] },
  sit: { at: [8, 29, 0], turn: [0, -0.85] },
} as const)

/** The mockup's cat in `pose` at a detail level. */
export function catShape(pose: ModelPose, level: DetailLevel): AnimalPart[] {
  const sleeping = pose === 'sleep'
  const earLean = sleeping ? 0.55 : 0
  const stance = catStanceOf(pose)
  const bodyParts = catBodyOf(stance, level)
  const headAt = CAT_HEAD[stance].at
  const headTurn = CAT_HEAD[stance].turn
  const tail = catTail(pose, level)

  return [
    part('body', { at: [0, 0, 0] }, bodyParts.body),
    part('head', { parent: 'body', at: headAt, turn: headTurn }, catHead(sleeping, level, earLean)),
    part(
      'ear',
      { parent: 'head', at: [-1.2, 3.4, 4.4], turn: [earLean, 0] },
      catEar('ear', [0, 0, 0], { level, earLean })
    ),
    part('tail', { parent: 'body', at: tail.at }, tail.prims),
    ...bodyParts.legs,
  ]
}

function stripes(
  level: DetailLevel,
  spans: readonly (readonly [number, number])[]
): Ellipsoid['bands'] {
  return level >= 1 ? spans.map(([from, to]) => [from, to, CAT.dark] as const) : undefined
}

function catWalkingBody(level: DetailLevel): { body: Ellipsoid[]; legs: AnimalPart[] } {
  const { fur, cream } = CAT
  const bands = stripes(level, [
    [-0.6, -0.5],
    [-0.16, -0.06],
    [0.3, 0.4],
  ])
  const body = [
    e([0, 11, 0], [11.5, 6, 5.4], { tone: fur, bands }),
    e([7, 9.6, 0], [5, 4.6, 4.4], { tone: cream }),
    e([-8, 11.4, 0], [5, 5.6, 5], { tone: fur }),
  ]
  const legs = [-1, 1].flatMap((s) => [
    part(`legF${s < 0 ? 'a' : 'b'}`, { parent: 'body', at: [6.5, 8, 3 * s] }, [
      e([0, -3.6, 0], [2.2, 4.6, 2.1], { tone: fur }),
      e([1, -7.6, 0], [3, 1.4, 2.2], { tone: cream }),
    ]),
    part(`legB${s < 0 ? 'b' : 'a'}`, { parent: 'body', at: [-7.5, 8, 3.4 * s] }, [
      e([0, -3.6, 0], [2.4, 4.6, 2.3], { tone: fur }),
      e([1, -7.6, 0], [3.2, 1.4, 2.3], { tone: cream }),
    ]),
  ])

  return { body, legs }
}

function catSittingBody(level: DetailLevel): { body: Ellipsoid[]; legs: AnimalPart[] } {
  const { fur, cream } = CAT
  const bands = stripes(level, [
    [-0.6, -0.5],
    [-0.16, -0.06],
    [0.3, 0.4],
  ])
  const haunch = stripes(level, [
    [-0.3, -0.2],
    [0.4, 0.5],
  ])
  const body = [
    e([-2, 13.5, 0], [8.5, 13, 7.5], { tone: fur, turn: [-0.25, 0], bands }),
    e([3.5, 12, 0], [4.6, 8.5, 5.6], { tone: cream, turn: [-0.25, 0] }),
    e([4, 24, 0], [5, 5, 5], { tone: fur }),
  ]

  for (const s of [-1, 1]) {
    body.push(
      e([-6, 8, 5.2 * s], [8.5, 8, 5.4], { tone: fur, bands: haunch }),
      e([6.5, 8.5, 3 * s], [2.6, 9, 2.3], { tone: fur }),
      e([8, 1.3, 3 * s], [3.8, 1.6, 2.6], { tone: cream })
    )
  }

  return { body, legs: [] }
}

function catSleepingBody(level: DetailLevel): { body: Ellipsoid[]; legs: AnimalPart[] } {
  const { fur, cream } = CAT
  const bands = stripes(level, [
    [-0.62, -0.54],
    [-0.2, -0.12],
    [0.38, 0.46],
  ])

  return {
    body: [
      e([0, 5.5, -0.5], [13, 5.5, 9.5], { tone: fur, bands }),
      e([-6, 6, 2.5], [7.5, 5, 5.5], { tone: fur }),
      e([9, 4.5, 3], [4, 3.4, 5], { tone: cream }),
      e([13, 2, 7.5], [3.6, 1.8, 2.2], { tone: cream }),
      e([14.5, 2, 4], [3.4, 1.8, 2.2], { tone: cream }),
    ],
    legs: [],
  }
}

function catBodyOf(
  stance: 'sit' | 'sleep' | 'walk',
  level: DetailLevel
): { body: Ellipsoid[]; legs: AnimalPart[] } {
  if (stance === 'walk') {
    return catWalkingBody(level)
  }

  return stance === 'sleep' ? catSleepingBody(level) : catSittingBody(level)
}

// Which of the cat's three stances a pose takes.
function catStanceOf(pose: ModelPose): 'sit' | 'sleep' | 'walk' {
  if (pose === 'walk' || pose === 'sleep') {
    return pose
  }

  return 'sit'
}

// A tabby's head: wide and a little flat, cream whisker pads, a pink nose, almond eyes, tall ears.
function catHead(sleeping: boolean, level: DetailLevel, earLean: number): Ellipsoid[] {
  const { fur, cream, pink, dark } = CAT
  const head = [
    e([0, 0, 0], [5.6, 4.7, 6.6], { tone: fur }),
    e([4.3, -1.9, 1.5], [2.1, 1.6, 1.9], { tone: cream }),
    e([4.3, -1.9, -1.5], [2.1, 1.6, 1.9], { tone: cream }),
    e([3.6, -3.6, 0], [1.7, 1.1, 2], { tone: cream }),
    e([5.9, -0.4, 0], [0.8, 0.6, 1.1], { tone: pink }),
  ]

  if (level >= 1) {
    head.push(e([5.7, -1.5, 0], [0.3, 0.9, 0.3], { tone: dark }))
  }

  if (level >= 2) {
    head.push(
      e([3.2, 3.8, 1.4], [0.5, 1.7, 0.5], { tone: dark }),
      e([3.2, 3.8, -1.4], [0.5, 1.7, 0.5], { tone: dark }),
      e([3.5, 4, 0], [0.5, 1.5, 0.5], { tone: dark })
    )
  }

  for (const s of [-1, 1]) {
    head.push(...catHeadSide(s, { sleeping, level }))
  }

  head.push(...catEar('head', [-1.2, 3.4, -4.4], { level, earLean }))

  return head
}

// One side of the cat's head: the cheek, the whiskers close up, the eye with its pupil and glint.
function catHeadSide(
  s: number,
  at: { readonly sleeping: boolean; readonly level: DetailLevel }
): Ellipsoid[] {
  const { fur, dark, eye, pupil } = CAT
  const { sleeping, level } = at
  const side: Ellipsoid[] = []

  side.push(e([1.4, -2.3, 5.5 * s], [3, 2.3, 1.5], { tone: fur }))

  if (level >= 2) {
    side.push(
      e([1.8, -0.2, 6.3 * s], [2.4, 0.45, 0.6], { tone: dark, turn: [-0.2, 0] }),
      e([1.6, -1.5, 6.2 * s], [2.2, 0.4, 0.6], { tone: dark, turn: [-0.1, 0] })
    )
  }

  side.push(
    sleeping
      ? e([3.9, 1, 3.4 * s], [1.5, 0.35, 1.4], { tone: dark })
      : e([3.9, 0.9, 3.3 * s], level > 0 ? [1.1, 0.95, 1.7] : [1.6, 1.6, 1.7], { tone: eye })
  )

  if (level >= 1 && !sleeping) {
    side.push(e([4.9, 0.9, 3.6 * s], [0.35, 0.95, 0.4], { tone: pupil }))
  }

  if (level >= 2 && !sleeping) {
    side.push(e([5.1, 1.5, 3.5 * s], [0.35, 0.35, 0.35], { tone: GLINT }))
  }

  return side
}

// An ear: on the head it leans with the head's ear angle; as its own part it stands straight.
function catEar(
  owner: 'head' | 'ear',
  c: Vec,
  at: { readonly level: DetailLevel; readonly earLean: number }
): Ellipsoid[] {
  const lift = (d: number): Vec =>
    owner === 'head' ? leanedAt(c, d, at.earLean) : [c[0], c[1] + d, c[2]]
  const turn: readonly [number, number] = owner === 'head' ? [at.earLean, 0] : NO_TURN
  const ear = [
    e(c, [2.8, 3.1, 1.1], { tone: CAT.fur, turn }),
    e(lift(3.2), [1.5, 3, 0.9], { tone: CAT.fur, turn }),
  ]

  if (at.level >= 1) {
    ear.push(e(lift(0.6), [1.4, 2.5, 1.2], { tone: CAT.pink, turn }))
  }

  return ear
}

function catTail(pose: ModelPose, level: DetailLevel): { at: Vec; prims: Ellipsoid[] } {
  const bands = level >= 1 && pose !== 'sleep' ? ([[-0.2, 0.2, CAT.dark]] as const) : undefined

  if (pose === 'walk') {
    return {
      at: [-12, 10.5, 0],
      prims: TAIL.walk.map(([x, y, a], i) =>
        e([x, y, 0], [3.6, 2, 2], {
          tone: i > 2 ? CAT.fur2 : CAT.fur,
          turn: [a, 0],
          ...(bands === undefined ? {} : { bands }),
        })
      ),
    }
  }

  if (pose !== 'sleep') {
    const at: Vec = [-12, 2.2, 3]

    return {
      at,
      prims: TAIL.sit.map(([x, z, th]) =>
        e([x - at[0], 0, z - at[2]], [4.2, 2.2, 2.2], {
          tone: x > 8 ? CAT.fur2 : CAT.fur,
          turn: [0, th],
          ...(bands === undefined ? {} : { bands }),
        })
      ),
    }
  }

  return {
    at: [0, 2.2, 0],
    prims: TAIL.sleep.map((a, i) =>
      e([11.5 * Math.cos(a), 0, 11.5 * Math.sin(a)], [4.4, 2.2, 2.2], {
        tone: i === 4 ? CAT.fur2 : CAT.fur,
        turn: [0, Math.PI / 2 - a],
      })
    ),
  }
}
