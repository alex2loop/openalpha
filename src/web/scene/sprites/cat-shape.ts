import {
  type AnimalPart,
  type Band,
  type Ellipsoid,
  e,
  lean,
  NO_TURN,
  part,
  type Turn,
  type Vec3,
  WHITE,
} from '@/web/scene/sprites/animal-parts'

const PI = Math.PI
const CAT = Object.freeze({
  O: '#E49A4F',
  O2: '#CF7F36',
  DK: '#B0622B',
  CR: '#F7DFBB',
  PK: '#E89B9B',
  G: '#A3CBA4',
  PUP: '#1B1416',
})

const CAT_HEADS: Readonly<Record<'walk' | 'sleep' | 'sit', { head: Vec3; turn: Turn }>> = {
  walk: { head: [12.5, 16.5, 0], turn: [0, 0] },
  sleep: { head: [9, 6, 7], turn: [-0.15, -0.25] },
  sit: { head: [8, 29, 0], turn: [0, -0.85] },
}

export function catShape(pose: string, lv: number): AnimalPart[] {
  const sl = pose === 'sleep'
  const wk = pose === 'walk'
  const ea = sl ? 0.55 : 0
  const legs: AnimalPart[] = []
  const b = catBody(legs, { wk, sl, lv })
  const h = catHead(sl, lv, ea)
  const ear = catEar('ear', { c: [0, 0, 0], ea, lv })
  const { tl, tail } = catTail(sl, wk, lv)
  const { head, turn: headTurn } = CAT_HEADS[catPoseOf(wk, sl)]

  return [
    part('body', { T: [0, 0, 0], A: NO_TURN, prims: b }),
    part('head', { parent: 'body', T: head, A: headTurn, prims: h }),
    part('ear', { parent: 'head', T: [-1.2, 3.4, 4.4], A: [ea, 0], prims: ear }),
    part('tail', { parent: 'body', T: tl, A: NO_TURN, prims: tail }),
    ...legs,
  ]
}

function catPoseOf(wk: boolean, sl: boolean): 'walk' | 'sleep' | 'sit' {
  if (wk) {
    return 'walk'
  }

  return sl ? 'sleep' : 'sit'
}

function catBody(
  legs: AnimalPart[],
  at: { readonly wk: boolean; readonly sl: boolean; readonly lv: number }
): Ellipsoid[] {
  if (at.wk) {
    return catWalking(legs, at.lv)
  }

  return at.sl ? catSleeping(at.lv) : catSitting(at.lv)
}

function tabby(lv: number, at: readonly Band[]): readonly Band[] | undefined {
  return lv >= 1 ? at : undefined
}

function catWalking(legs: AnimalPart[], lv: number): Ellipsoid[] {
  const { O, DK, CR } = CAT
  const bd = tabby(lv, [
    [-0.6, -0.5, DK],
    [-0.16, -0.06, DK],
    [0.3, 0.4, DK],
  ])

  for (const s of [-1, 1]) {
    legs.push(
      part(`legF${s < 0 ? 'a' : 'b'}`, {
        parent: 'body',
        T: [6.5, 8, 3 * s],
        A: NO_TURN,
        prims: [e([[0, -3.6, 0], [2.2, 4.6, 2.1], O]), e([[1, -7.6, 0], [3, 1.4, 2.2], CR])],
      }),
      part(`legB${s < 0 ? 'b' : 'a'}`, {
        parent: 'body',
        T: [-7.5, 8, 3.4 * s],
        A: NO_TURN,
        prims: [e([[0, -3.6, 0], [2.4, 4.6, 2.3], O]), e([[1, -7.6, 0], [3.2, 1.4, 2.3], CR])],
      })
    )
  }

  return [
    e([[0, 11, 0], [11.5, 6, 5.4], O, undefined, bd]),
    e([[7, 9.6, 0], [5, 4.6, 4.4], CR]),
    e([[-8, 11.4, 0], [5, 5.6, 5], O]),
  ]
}

function catSitting(lv: number): Ellipsoid[] {
  const { O, DK, CR } = CAT
  const bd = tabby(lv, [
    [-0.6, -0.5, DK],
    [-0.16, -0.06, DK],
    [0.3, 0.4, DK],
  ])
  const hb = tabby(lv, [
    [-0.3, -0.2, DK],
    [0.4, 0.5, DK],
  ])
  const b = [
    e([[-2, 13.5, 0], [8.5, 13, 7.5], O, [-0.25, 0], bd]),
    e([[3.5, 12, 0], [4.6, 8.5, 5.6], CR, [-0.25, 0]]),
    e([[4, 24, 0], [5, 5, 5], O]),
  ]

  for (const s of [-1, 1]) {
    b.push(
      e([[-6, 8, 5.2 * s], [8.5, 8, 5.4], O, undefined, hb]),
      e([[6.5, 8.5, 3 * s], [2.6, 9, 2.3], O]),
      e([[8, 1.3, 3 * s], [3.8, 1.6, 2.6], CR])
    )
  }

  return b
}

function catSleeping(lv: number): Ellipsoid[] {
  const { O, DK, CR } = CAT
  const bd = tabby(lv, [
    [-0.62, -0.54, DK],
    [-0.2, -0.12, DK],
    [0.38, 0.46, DK],
  ])

  return [
    e([[0, 5.5, -0.5], [13, 5.5, 9.5], O, undefined, bd]),
    e([[-6, 6, 2.5], [7.5, 5, 5.5], O]),
    e([[9, 4.5, 3], [4, 3.4, 5], CR]),
    e([[13, 2, 7.5], [3.6, 1.8, 2.2], CR]),
    e([[14.5, 2, 4], [3.4, 1.8, 2.2], CR]),
  ]
}

// A tabby's head: wide and a little flat, two cream whisker pads, a pink nose, almond eyes set
// wide, tall pointed ears.
function catHead(sl: boolean, lv: number, ea: number): Ellipsoid[] {
  const { O, DK, CR, PK } = CAT
  const h = [
    e([[0, 0, 0], [5.6, 4.7, 6.6], O]),
    e([[4.3, -1.9, 1.5], [2.1, 1.6, 1.9], CR]),
    e([[4.3, -1.9, -1.5], [2.1, 1.6, 1.9], CR]),
    e([[3.6, -3.6, 0], [1.7, 1.1, 2], CR]),
    e([[5.9, -0.4, 0], [0.8, 0.6, 1.1], PK]),
  ]

  if (lv >= 1) {
    h.push(e([[5.7, -1.5, 0], [0.3, 0.9, 0.3], DK]))
  }

  if (lv >= 2) {
    h.push(
      e([[3.2, 3.8, 1.4], [0.5, 1.7, 0.5], DK]),
      e([[3.2, 3.8, -1.4], [0.5, 1.7, 0.5], DK]),
      e([[3.5, 4, 0], [0.5, 1.5, 0.5], DK])
    )
  }

  for (const s of [-1, 1]) {
    h.push(...catCheek(s, { sl, lv }))
  }

  h.push(...catEar('head', { c: [-1.2, 3.4, -4.4], ea, lv }))

  return h
}

// One side of the cat's face: the cheek, the whisker marks when close, the eye and its pupil.
function catCheek(s: number, at: { readonly sl: boolean; readonly lv: number }): Ellipsoid[] {
  const { O, DK, G, PUP } = CAT
  const { sl, lv } = at
  const out = [e([[1.4, -2.3, 5.5 * s], [3, 2.3, 1.5], O])]

  if (lv >= 2) {
    out.push(
      e([[1.8, -0.2, 6.3 * s], [2.4, 0.45, 0.6], DK, [-0.2, 0]]),
      e([[1.6, -1.5, 6.2 * s], [2.2, 0.4, 0.6], DK, [-0.1, 0]])
    )
  }

  if (sl) {
    out.push(e([[3.9, 1, 3.4 * s], [1.5, 0.35, 1.4], DK]))
    return out
  }

  out.push(e([[3.9, 0.9, 3.3 * s], lv > 0 ? [1.1, 0.95, 1.7] : [1.6, 1.6, 1.7], G]))

  if (lv >= 1) {
    out.push(e([[4.9, 0.9, 3.6 * s], [0.35, 0.95, 0.4], PUP]))
  }

  if (lv >= 2) {
    out.push(e([[5.1, 1.5, 3.5 * s], [0.35, 0.35, 0.35], WHITE]))
  }

  return out
}

function catEar(
  on: 'head' | 'ear',
  at: { readonly c: Vec3; readonly ea: number; readonly lv: number }
): Ellipsoid[] {
  const { O, PK } = CAT
  const { c, ea } = at
  const turn: Turn = on === 'head' ? [ea, 0] : NO_TURN
  const off = (d: number): Vec3 => (on === 'head' ? lean(c, d, ea) : [c[0], c[1] + d, c[2]])
  const out = [e([c, [2.8, 3.1, 1.1], O, turn]), e([off(3.2), [1.5, 3, 0.9], O, turn])]

  if (at.lv >= 1) {
    out.push(e([off(0.6), [1.4, 2.5, 1.2], PK, turn]))
  }

  return out
}

function catTail(
  sl: boolean,
  wk: boolean,
  lv: number
): { readonly tl: Vec3; readonly tail: Ellipsoid[] } {
  const { O, O2, DK } = CAT
  const tb = tabby(lv >= 1 && !sl ? lv : 0, [[-0.2, 0.2, DK]])

  if (wk) {
    return walkingTail(tb)
  }

  if (!sl) {
    const tl: Vec3 = [-12, 2.2, 3]
    const curls = [
      [-12, 3, -1.2],
      [-10.5, 8.5, -1.37],
      [-5, 11.5, -0.3],
      [2, 11.8, 0],
      [9, 10.5, 0.17],
    ] as const

    return {
      tl,
      tail: curls.map(([x, z, th]) =>
        e([[x - tl[0], 0, z - tl[2]], [4.2, 2.2, 2.2], x > 8 ? O2 : O, [0, th], tb])
      ),
    }
  }

  return {
    tl: [0, 2.2, 0],
    tail: [3, 2.4, 1.8, 1.3, 0.9].map((a, i) =>
      e([
        [11.5 * Math.cos(a), 0, 11.5 * Math.sin(a)],
        [4.4, 2.2, 2.2],
        i === 4 ? O2 : O,
        [0, PI / 2 - a],
      ])
    ),
  }
}

// A walking cat's tail curls up behind it in four bends.
function walkingTail(tb: readonly Band[] | undefined): {
  readonly tl: Vec3
  readonly tail: Ellipsoid[]
} {
  const { O, O2 } = CAT

  const bends = [
    [-2.5, 0.7, -0.25],
    [-6.5, 3, -0.6],
    [-9.6, 6.6, -1],
    [-10.8, 10.4, -1.3],
  ] as const

  return {
    tl: [-12, 10.5, 0],
    tail: bends.map(([x, y, a], i) => e([[x, y, 0], [3.6, 2, 2], i > 2 ? O2 : O, [a, 0], tb])),
  }
}
