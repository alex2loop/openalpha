import {
  type Art,
  curve,
  ellipse,
  line,
  oval,
  poly,
  STRIDE,
} from '@/web/scene/render2d/street/critter-shapes'

const CAT = Object.freeze({
  fur: '#858A92',
  dark: '#4F545D',
  white: '#E4E2DE',
  belly: '#B7B7BC',
  ear: '#C79A9E',
  nose: '#C98A8E',
  eye: '#B9B24F',
  pupil: '#16161A',
  glow: '#F2D26B',
})
const DOG = Object.freeze({
  coat: '#D38B49',
  shade: '#B97839',
  cream: '#F1E4CE',
  collar: '#3E6FB0',
  earBack: '#C07C3C',
  earIn: '#8E5A3A',
  nose: '#1C1C22',
  eye: '#201814',
  brow: '#EBC088',
  mouth: '#2A1A14',
})
// Cat eyes shine from this darkness.
const EYE_SHINE_FROM = 0.5
const CAT_TAIL_TIP = [-1.6, 0, 1.6, 0] as const
const DOG_STRIDE = [7, 0, -7, 0] as const

/** The stray grey tabby: sits with its tail round its feet, washes a paw, or walks the wall top
 *  with its tail raised; its eyes catch the light at night. */
export function paintCat(art: Art): void {
  if (art.critter.pose === 'walk') {
    paintWalkingCat(art)
    return
  }

  const { g, critter, tone } = art
  const isGroom = critter.pose === 'groom'
  const fur = tone(CAT.fur)
  const dark = tone(CAT.dark)
  const white = tone(CAT.white)
  const tip = 8 + (isGroom ? 0 : (CAT_TAIL_TIP[critter.frame % 4] ?? 0))

  curve(g, { points: [-12, -5, -25, -1.5, -14, 0.4, -2, 1.4, tip, -0.4], w: 4.6, tone: fur })

  if (art.detail >= 1) {
    for (const k of [0, 1, 2]) {
      line(g, {
        from: [-17 - k * 3, -2.4 + k * 0.6],
        to: [-18 - k * 3, 0.4 + k * 0.4],
        w: 2.2,
        tone: dark,
      })
    }
  }

  oval(g, [-6, -7.5, 8.8, 7.5], fur)
  oval(g, [-1, -11.5, 8, 8, 0.35], fur)
  oval(g, [3.5, -13, 5.4, 7.6], fur)

  for (const [a, b, c, d] of [
    [-11, -11, -8.4, -5],
    [-7.4, -14.4, -5, -8],
    [-3, -18, -1.4, -11],
  ] as const) {
    line(g, { from: [a, b], to: [c, d], w: 1.5, tone: dark })
  }

  if (art.detail >= 1) {
    oval(g, [5.4, -12.6, 3, 5.8, 0.05], white)
  }

  oval(g, [-1.2, -1.2, 5.4, 1.8], art.detail >= 1 ? white : fur)
  paintSittingPaws(art, isGroom)
  paintCatFace(art, isGroom ? [8.5, -19.5 + (critter.frame > 0 ? 0.8 : 0)] : [7.5, -24])
}

function paintSittingPaws(art: Art, isGroom: boolean): void {
  const { g, critter, tone } = art
  const fur = tone(CAT.fur)
  const sock = tone(art.detail >= 1 ? CAT.white : CAT.fur)

  if (isGroom) {
    const up = critter.frame > 0 ? 1.8 : 0

    line(g, { from: [6.5, -12], to: [8.6, -16.6 + up], w: 4, tone: fur })
    oval(g, [9.8, -17.6 + up, 2.2, 1.8], tone(CAT.white))
    line(g, { from: [6, -11], to: [6.4, -1.5], w: 4.2, tone: tone(CAT.dark) })
    oval(g, [8, -1, 3, 1.5], sock)
    return
  }

  line(g, { from: [6, -12], to: [6.5, -1.8], w: 4.4, tone: fur })
  oval(g, [8, -1, 3.2, 1.5], sock)
}

// Walking: the raised tail with its rings, the far legs, body and belly, the stripes, the near legs
// with white socks, then the neck, head, muzzle, ears and forehead stripes.
function paintWalkingCat(art: Art): void {
  const { g, critter, tone } = art
  const stride = STRIDE[critter.frame] ?? 0
  const fur = tone(CAT.fur)
  const dark = tone(CAT.dark)
  const white = tone(CAT.white)

  paintRaisedTail(art)
  line(g, { from: [9, -11], to: [9 - stride, critter.frame === 1 ? -2.6 : 0], w: 3.8, tone: dark })
  line(g, {
    from: [-9, -11],
    to: [-9 + stride, critter.frame === 3 ? -2.6 : 0],
    w: 3.8,
    tone: dark,
  })
  oval(g, [0, -15, 13.5, 6.4], fur)
  oval(g, [8, -14.6, 6.4, 6.4], fur)

  if (art.detail >= 1) {
    oval(g, [0, -11.4, 11, 2.6], tone(CAT.belly))
    oval(g, [9, -12.2, 3.4, 4.2], white)
  }

  for (const x of [-8, -4, 0, 4]) {
    line(g, { from: [x, -20.6], to: [x - 1, -14], w: 1.9, tone: dark })
  }

  for (const [x, reach, isUp, w] of [
    [9, stride, critter.frame === 3, 4],
    [-9, -stride, critter.frame === 1, 4.2],
  ] as const) {
    const footY = isUp ? -2.6 : 0

    line(g, { from: [x, -11], to: [x + reach, footY], w, tone: fur })

    if (art.detail >= 1) {
      line(g, { from: [x + reach, footY - 0.2], to: [x + reach, footY - 3.6], w, tone: white })
    }
  }

  paintWalkingHead(art)
}

// The raised tail of a walking cat, its rings and dark tip swaying with the step.
function paintRaisedTail(art: Art): void {
  const { g, tone } = art
  const fur = tone(CAT.fur)
  const dark = tone(CAT.dark)
  const tailX = -21.5 + (art.critter.frame % 2) * 1.2

  curve(g, { points: [-11, -16, -22, -19, tailX, -31], w: 3.9, tone: fur })

  if (art.detail >= 1) {
    for (const k of [0, 1, 2]) {
      line(g, {
        from: [-14 - k * 2.6, -17.4 - k * 3],
        to: [-17.4 - k * 2.6, -17.6 - k * 3],
        w: 2.2,
        tone: dark,
      })
    }
  }

  oval(g, [tailX, -31, 2, 2.2], dark)
}

// A walking cat's neck and head: ears, muzzle and nose, forehead stripes, the eye.
function paintWalkingHead(art: Art): void {
  const { g, tone } = art
  const fur = tone(CAT.fur)
  const dark = tone(CAT.dark)
  const white = tone(CAT.white)

  curve(g, { points: [9, -16.6, 13, -19.4, 17, -20.6], w: 8, tone: fur })
  oval(g, [18, -21.6, 5.4, 5], fur)
  paintEars(art, { x: 18, y: -21.6, s: 1 })
  oval(g, [22, -19.4, 3.1, 2.4], art.detail >= 1 ? white : fur)

  if (art.detail >= 1) {
    oval(g, [24.6, -20.4, 0.8, 0.7], tone(CAT.nose))

    for (const x of [16.4, 18.2, 20]) {
      line(g, { from: [x, -26.6], to: [x, -24.6], w: 0.7, tone: dark })
    }
  }

  paintCatEye(art, { x: 20.4, y: -22.4, r: 1.2 })
}

// A sitting cat's head: ears, muzzle and nose, forehead stripes, whiskers close up, then its eye
// (a washing cat's shut).
function paintCatFace(art: Art, head: readonly [number, number]): void {
  const { g, tone } = art
  const [x, y] = head
  const dark = tone(CAT.dark)

  ellipse(g, { x, y, rx: 7, ry: 6.3, rot: 0, tone: tone(CAT.fur) })
  paintEars(art, { x, y, s: 1.1 })

  if (art.detail >= 1) {
    oval(g, [x + 4.8, y + 2.5, 3.4, 2.5], tone(CAT.white))
    oval(g, [x + 7.6, y + 1.3, 0.9, 0.8], tone(CAT.nose))

    for (const k of [-1.6, 0, 1.6]) {
      line(g, { from: [x + k, y - 6], to: [x + k * 0.8, y - 3.4], w: 0.7, tone: dark })
    }
  }

  if (art.detail === 2) {
    line(g, { from: [x + 1, y + 1], to: [x + 5, y + 0.2], w: 0.5, tone: dark })
    line(g, { from: [x + 1.4, y + 3], to: [x + 5, y + 3.4], w: 0.5, tone: dark })
  }

  if (art.critter.pose === 'groom' && art.detail >= 1) {
    line(g, { from: [x + 3.6, y - 1.2], to: [x + 5.4, y - 0.4], w: 0.7, tone: tone(CAT.pupil) })
  } else {
    paintCatEye(art, { x: x + 3.6, y: y - 1.2, r: 1.3 })
  }
}

function paintEars(
  art: Art,
  at: { readonly x: number; readonly y: number; readonly s: number }
): void {
  const { g, tone } = art
  const { x, y, s } = at

  poly(g, tone(CAT.dark), [
    x - 4.6 * s,
    y - 3.4 * s,
    x - 3.2 * s,
    y - 10.4 * s,
    x + 1.2 * s,
    y - 5.2 * s,
  ])
  poly(g, tone(CAT.fur), [
    x + 1.4 * s,
    y - 5.2 * s,
    x + 4.8 * s,
    y - 9.8 * s,
    x + 5.4 * s,
    y - 2.8 * s,
  ])

  if (art.detail >= 1) {
    poly(g, tone(CAT.ear), [
      x + 2.4 * s,
      y - 5.4 * s,
      x + 4.6 * s,
      y - 8 * s,
      x + 4.8 * s,
      y - 3.6 * s,
    ])
  }
}

// An eye that shines at night, or a yellow one with a slit pupil close up by day.
function paintCatEye(
  art: Art,
  eye: { readonly x: number; readonly y: number; readonly r: number }
): void {
  const { g, tone } = art
  const { x, y, r } = eye

  if (art.dark >= EYE_SHINE_FROM) {
    ellipse(g, { x, y, rx: r * 1.1, ry: r * 1.1, rot: 0, tone: CAT.glow })
    return
  }

  if (art.detail >= 1) {
    ellipse(g, { x, y, rx: r, ry: r, rot: 0, tone: tone(CAT.eye) })
  }

  if (art.detail === 2) {
    ellipse(g, { x, y, rx: r * 0.3, ry: r * 0.9, rot: 0, tone: tone(CAT.pupil) })
  }
}

/** The walker's Shiba: tan coat, cream cheeks, chest and belly, upright ears, fox muzzle, a tail
 *  curled over its back; it trots on a diagonal gait, nose to the ground while its walker waits. */
export function paintDog(art: Art): void {
  const { g, critter, tone } = art
  const stride = DOG_STRIDE[critter.frame] ?? 0
  const coat = tone(DOG.coat)
  const cream = tone(DOG.cream)

  paintDogLeg(art, { x: 13, y: -14, reach: -stride, colour: tone(DOG.shade), isHind: false })
  paintDogLeg(art, { x: -13, y: -18, reach: stride, colour: tone(DOG.shade), isHind: true })
  curve(g, { points: [-19, -27, -30, -30, -26, -44], w: 8.4, tone: coat })
  curve(g, { points: [-26, -44, -15, -47, -11, -38], w: 8.4, tone: coat })

  if (art.detail >= 1) {
    curve(g, { points: [-23, -42, -16, -43, -13, -37], w: 3, tone: cream })
  }

  oval(g, [0, -25, 21, 10.6], coat)
  oval(g, [13, -23, 9.8, 11], coat)

  if (art.detail >= 1) {
    oval(g, [0, -17.6, 15.6, 4.2], cream)
    oval(g, [19, -20, 5.2, 9, 0.15], cream)
  }

  curve(g, { points: [17, -28, 22, -30, 25, -36], w: 12.4, tone: coat })

  if (art.detail >= 1) {
    curve(g, { points: [20, -24, 24, -27, 26, -32], w: 5.4, tone: cream })
    curve(g, { points: [19, -31.4, 22.4, -33.6, 25.2, -35.4], w: 2.6, tone: tone(DOG.collar) })
  }

  paintDogLeg(art, { x: 13, y: -14, reach: stride, colour: coat, isHind: false })
  paintDogLeg(art, { x: -13, y: -18, reach: -stride, colour: coat, isHind: true })
  paintDogHead(art)
}

// A leg from the hip (a hind leg bends at the hock) to the paw, lifted on the swing, with a cream
// sock.
function paintDogLeg(
  art: Art,
  leg: {
    readonly x: number
    readonly y: number
    readonly reach: number
    readonly colour: string
    readonly isHind: boolean
  }
): void {
  const { g } = art
  const footX = leg.x + leg.reach
  const footY = leg.reach === 0 ? -3 : 0
  const kneeX = leg.isHind ? leg.x - 3 + leg.reach * 0.4 : footX
  const kneeY = leg.isHind ? -9 : footY

  if (leg.isHind) {
    line(g, { from: [leg.x, leg.y], to: [kneeX, kneeY], w: 6.6, tone: leg.colour })
    line(g, { from: [kneeX, kneeY], to: [footX, footY], w: 4.8, tone: leg.colour })
  } else {
    line(g, { from: [leg.x, leg.y], to: [footX, footY], w: 5.6, tone: leg.colour })
  }

  if (art.detail >= 1) {
    const dx = kneeX - footX
    const dy = kneeY - footY
    const n = Math.hypot(dx, dy) || 1

    line(g, {
      from: [footX, footY - 0.3],
      to: [footX + (dx / n) * 5.4, footY - 0.3 + (dy / n) * 5.4],
      w: leg.isHind ? 5.6 : 5.4,
      tone: art.tone(DOG.cream),
    })
  }
}

function paintDogHead(art: Art): void {
  const { g, tone } = art
  const isSniff = art.critter.pose === 'sniff'
  const coat = tone(DOG.coat)
  const cream = tone(DOG.cream)

  g.save()
  g.translate(25 + (isSniff ? 3 : 0), -36 + (isSniff ? 11 : 0))
  g.rotate(isSniff ? 0.5 : 0)
  poly(g, tone(DOG.earBack), [4, -6, 8, -16, 10.6, -6])
  poly(g, coat, [-2.4, -5, -0.5, -16, 6.8, -6.8])

  if (art.detail >= 1) {
    poly(g, tone(DOG.earIn), [-0.4, -6.4, 0.4, -12.4, 4.4, -7.4])
  }

  oval(g, [4, -1, 8.5, 7, 0.1], coat)
  oval(g, [11.5, 0.8, 6.4, 3.2, 0.08], coat)
  oval(g, [10.6, 3, 6.2, 2.4], art.detail >= 1 ? cream : coat)

  if (art.detail >= 1) {
    oval(g, [6, 2.6, 5.6, 3.4, 0.2], cream)
  }

  oval(g, [17.4, -0.2, 1.9, 1.6], DOG.nose)

  if (art.detail >= 1) {
    oval(g, [8.4, -2.5, 1.15, 1.15], DOG.eye)
  }

  if (art.detail === 2) {
    oval(g, [8.4, -5.4, 1, 0.7], tone(DOG.brow))
    line(g, { from: [11, 3.4], to: [16, 3.2], w: 0.5, tone: DOG.mouth })
  }

  g.restore()
}
