import {
  type AnimalPart,
  type Ellipsoid,
  e,
  lean,
  NO_TURN,
  part,
  type Vec3,
  WHITE,
} from '@/web/scene/sprites/animal-parts'

const CORGI = Object.freeze({
  F: '#CB8841',
  F2: '#B5743A',
  W: '#F5EADB',
  W2: '#EAD2B4',
  NOSE: '#1C1517',
  EYE: '#2A1B17',
  IN: '#E9C7A6',
})

// Where the corgi's head and tail hang from its body in each pose, and the cat's head.
const CORGI_PLACES: Readonly<Record<'stand' | 'sleep' | 'lie', { head: Vec3; tl: Vec3 }>> = {
  stand: { head: [37, 39.5, 0], tl: [-30, 22, 0] },
  sleep: { head: [33, 12.5, 0], tl: [-29, 10, 0] },
  lie: { head: [34, 31, 0], tl: [-29, 12.5, 0] },
}

export function corgiShape(pose: string, lv: number): AnimalPart[] {
  const { F2, W, W2, IN } = CORGI
  const sl = pose === 'sleep'
  const st = pose === 'stand'
  const ea = sl ? 0.85 : 0.15
  const b: Ellipsoid[] = []
  const legs: AnimalPart[] = []

  if (st) {
    corgiStanding(b, legs)
  } else {
    corgiLying(b, sl)
  }

  const h = corgiHead({ sl, lv, ea })

  const ear = [e([[0, 6.5, 0], [4.6, 7.6, 1.5], F2])]

  if (lv >= 1) {
    ear.push(e([[0, 5.8, 0], [2.9, 5.2, 1.62], IN]))
  }

  const tail = [e([[-2.5, 0, 0], [5, 4, 4], W2]), e([[-8, -2.8, 0], [8, 3, 3.2], W2, [0.45, 0]])]

  if (lv >= 2) {
    tail.push(e([[-12, -5, 0], [4, 2.4, 2.6], W, [0.5, 0]]))
  }

  const { head, tl } = CORGI_PLACES[corgiPoseOf(st, sl)]

  return [
    part('body', { T: [0, 0, 0], A: NO_TURN, prims: b }),
    part('head', { parent: 'body', T: head, A: sl ? [-0.1, 0] : NO_TURN, prims: h }),
    part('ear', { parent: 'head', T: [-3, 3, 4.6], A: [ea, 0], prims: ear }),
    part('tail', { parent: 'body', T: tl, A: NO_TURN, prims: tail }),
    ...legs,
  ]
}

function corgiPoseOf(st: boolean, sl: boolean): 'stand' | 'sleep' | 'lie' {
  if (st) {
    return 'stand'
  }

  return sl ? 'sleep' : 'lie'
}

function corgiEye(sl: boolean, lv: number): Vec3 {
  if (sl) {
    return [1.8, 0.45, 0.9]
  }

  return lv > 0 ? [1.6, 1.9, 1.1] : [2.2, 2.2, 1.4]
}

function corgiLying(b: Ellipsoid[], sl: boolean): void {
  const { F, F2, W } = CORGI
  const y0 = sl ? -2 : 0
  const less = sl ? 1 : 0

  b.push(
    e([[0, 13 + y0, 0], [28, 8.6 - less, 10], F]),
    e([[20, 12 + y0, 0], [10, 8 - less, 8.5], W]),
    sl ? e([[22, 15, 0], [6.5, 6.5, 6], F, [-1, 0]]) : e([[22, 22, 0], [6.5, 9, 6], F, [-0.35, 0]])
  )

  if (!sl) {
    b.push(e([[26.5, 20, 0], [4, 7, 4.8], W, [-0.35, 0]]))
  }

  for (const s of [-1, 1]) {
    b.push(
      e([[-15, 10 + y0, 7.5 * s], [12, 8.6 - less, 5.5], F]),
      e([[13, 14 + y0, 6 * s], [8, 7.4 - less, 4], F2]),
      e([[17, 7 + y0, 5.5 * s], [6, 5.5 - (sl ? 0.5 : 0), 3.4], F2]),
      e([[27, 3.6 + y0 * 0.3, 5.4 * s], [9.5, 3.4, 3.1], W]),
      e([[35, 2.4 + y0 * 0.1, 5.2 * s], [4.4, 2.4, 3.1], W]),
      e([[-4, 2.6 + y0 * 0.2, 13 * s], [8, 2.5, 3.2], W])
    )
  }
}

function corgiStanding(b: Ellipsoid[], legs: AnimalPart[]): void {
  const { F, F2, W } = CORGI

  b.push(
    e([[0, 20, 0], [29, 10, 9.6], F]),
    e([[20, 16.5, 0], [9.5, 9, 8.4], W]),
    e([[26, 29, 0], [6.2, 9, 5.6], F, [-0.5, 0]]),
    e([[30, 27.5, 0], [4, 6.5, 4.6], W, [-0.5, 0]])
  )

  for (const s of [-1, 1]) {
    const n = s < 0 ? 'a' : 'b'

    b.push(e([[-17, 19, 5.8 * s], [10.5, 9.5, 5], F]), e([[14, 20, 5.8 * s], [8.5, 8, 4], F2]))
    legs.push(
      part(`legF${n}`, {
        parent: 'body',
        T: [16, 18, 5.4 * s],
        A: NO_TURN,
        prims: [
          e([[1, -8, -0.4 * s], [4, 10, 3.5], F2]),
          e([[2.5, -13.8, -0.4 * s], [3.6, 4.6, 3.2], W]),
          e([[4.5, -16.6, -0.4 * s], [5, 2, 3.4], W]),
        ],
      }),
      part(`legB${n}`, {
        parent: 'body',
        T: [-18, 17, 5.4 * s],
        A: NO_TURN,
        prims: [e([[-1, -10, 0], [3.6, 7, 3], W, [0.15, 0]]), e([[1.5, -15.7, 0], [5, 2, 3.2], W])],
      })
    )
  }
}

// The corgi's head: the muzzle and nose, the eyes, the white blaze when close, and the far ear.
function corgiHead(at: {
  readonly sl: boolean
  readonly lv: number
  readonly ea: number
}): Ellipsoid[] {
  const { F, F2, W, W2, NOSE, EYE, IN } = CORGI
  const { sl, lv, ea } = at
  const h = [
    e([[0, 0, 0], [7.8, 7.2, 6.8], F]),
    e([[7, -0.2, 0], [6.5, 2.3, 2.8], F]),
    e([[8, -3.2, 0], [7, 3.6, 3.9], W2]),
    e([[14.6, -1.3, 0], [1.8, 1.5, 2], NOSE]),
  ]

  if (lv >= 2) {
    h.push(e([[4.5, 2.8, 0], [5, 1.1, 1.1], W]))
  }

  for (const s of [-1, 1]) {
    h.push(e([[3, -3.6, 4.1 * s], [5, 4, 2.5], W]))
    h.push(e([[5.2, 2.4, 5.1 * s], corgiEye(sl, lv), EYE]))

    if (lv >= 2 && !sl) {
      h.push(
        e([[5.9, 3.4, 5.8 * s], [0.55, 0.6, 0.4], WHITE]),
        e([[6.1, 3.9, 4.2 * s], [1, 0.7, 0.8], F2])
      )
    }
  }

  const fe = lean([-3, 3, -4.6], 6.5, ea)

  h.push(e([fe, [4.6, 7.6, 1.5], F2, [ea, 0]]))

  if (lv >= 1) {
    h.push(e([fe, [2.9, 5.2, 1.62], IN, [ea, 0]]))
  }

  return h
}
