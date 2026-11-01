import { type Flyer, paintFlight } from '@/web/scene/render2d/street/critter-flight'
import { type Art, curve, line, oval, poly } from '@/web/scene/render2d/street/critter-shapes'

const PIGEON = Object.freeze({
  bl: 10,
  br: 5,
  span: 17,
  width: 6.5,
  shoulder: 1,
  hd: 3.2,
  body: '#8D94A3',
  belly: '#A6ACB8',
  wing: '#9AA1AF',
  wingFar: '#6A7181',
  bar: '#2E323C',
  tip: '#3A3E4A',
  tail: '#4A505E',
  head: '#5C6475',
  beak: '#3E414A',
  eye: '#E07A2A',
  neck: ['#5E6E9A', '#2F8F7A'],
} satisfies Flyer)
const PIGEON_STAND = Object.freeze({
  leg: '#C97C84',
  tail: '#4F5563',
  tailBand: '#2A2D36',
  folded: '#A4AAB7',
  barLight: '#C9CEDA',
  purple: '#7B5C9C',
  cere: '#E8E8EE',
  pupil: '#0F1015',
  mouth: '#1F2128',
})
const SPARROW = Object.freeze({
  bl: 5.4,
  br: 3.2,
  span: 10.5,
  width: 4.6,
  shoulder: 0.6,
  hd: 2.7,
  body: '#A7794F',
  belly: '#CDBFA9',
  wing: '#8A5733',
  wingFar: '#6E4A2C',
  bar: '#E8E0CF',
  tip: '#4A3320',
  tail: '#6E4A2C',
  head: '#E9E1D1',
  cap: '#8B4528',
  beak: '#4A433F',
  eye: '#111111',
} satisfies Flyer)
const SPARROW_STAND = Object.freeze({
  leg: '#C8998A',
  bib: '#222222',
  streak: '#3E2A1C',
  throat: '#EFE9DA',
})
const PIGEON_BOB = [-1.5, 3.2, 3.4, 0.8] as const
// A standing pigeon's head up on any frame but the first.
const PIGEON_STAND_BOB = [0.5, 3.4, 3.4, 3.4] as const
const PIGEON_STEP = [4, 1, -4, -1] as const

/** The rock pigeon: small head, bobbing neck with the green and purple sheen, pale wing with two
 *  dark bars, dark tail band; it walks, pecks, stands, or beats its wings in the air. */
export function paintPigeon(art: Art): void {
  const { g, critter, tone } = art
  const { pose, frame } = critter

  if (pose === 'fly') {
    paintFlight(art, PIGEON)
    return
  }

  paintPigeonLegs(art)
  poly(g, tone(PIGEON_STAND.tail), [-7, -12, -18.5, -8.4, -18, -5.4, -7, -9])

  if (art.detail >= 1) {
    poly(g, tone(PIGEON_STAND.tailBand), [-15, -9.4, -18.5, -8.4, -18, -5.4, -14.6, -6.6])
  }

  g.save()
  g.translate(-1, -11.5)
  g.rotate((pose === 'peck' ? 0.32 : -0.2) + 0.2)
  g.translate(1, 11.5)
  paintPigeonBody(art)
  g.restore()

  const bob = pose === 'walk' ? (PIGEON_BOB[frame] ?? 0) : (PIGEON_STAND_BOB[frame] ?? 0)
  const isPeck = pose === 'peck'

  paintPigeonHead(art, {
    head: isPeck ? [13.5, -3 - frame * 3] : [9 + bob, -23],
    neck: isPeck ? [7, -12.5] : [5.5, -16],
  })
}

function paintPigeonLegs(art: Art): void {
  const { g, critter, tone } = art
  const leg = tone(PIGEON_STAND.leg)
  const isWalk = critter.pose === 'walk'
  const step = isWalk ? (PIGEON_STEP[critter.frame] ?? 0) : 0
  const up = critter.frame % 2 === 1 ? -1.6 : 0
  const feet = isWalk
    ? [
        [step, up],
        [-step, up === 0 ? -1.6 : 0],
      ]
    : [
        [-2.5, 0],
        [1.5, 0],
      ]

  for (const [reach = 0, lift = 0] of feet) {
    line(g, { from: [-1.2, -7], to: [-1.2 + reach, lift - 1.2], w: 1.5, tone: leg })

    if (art.detail === 2) {
      for (const toe of [-1, 0, 1]) {
        line(g, {
          from: [-1.2 + reach, lift - 0.8],
          to: [0.6 + reach, lift - 0.6 + toe * 0.5],
          w: 0.7,
          tone: leg,
        })
      }
    }
  }
}

function paintPigeonBody(art: Art): void {
  const { g, tone } = art

  oval(g, [-1, -12, 10, 7.6, -0.2], tone(PIGEON.body))
  oval(g, [5.5, -12.6, 5.6, 6.2], tone(PIGEON.body))

  if (art.detail >= 1) {
    oval(g, [1.5, -9, 8, 3.6, -0.2], tone(PIGEON.belly))
  }

  oval(g, [-3.4, -13.8, 9, 5.2, -0.2], tone(PIGEON_STAND.folded))
  poly(g, tone(PIGEON_STAND.tail), [-9.5, -13.6, -17.4, -9, -16.6, -7.4, -8, -10.8])

  for (const x of [-0.4, -5]) {
    line(g, { from: [x + 1.7, -18.6], to: [x - 1.5, -9.6], w: 2, tone: tone(PIGEON.bar) })
  }

  if (art.detail === 2) {
    for (const x of [-2.2, -7]) {
      line(g, {
        from: [x + 0.8, -18.6],
        to: [x - 1.6, -11],
        w: 0.45,
        tone: tone(PIGEON_STAND.barLight),
      })
    }
  }
}

// The neck curves from the shoulders up to the head, its sheen and the purple throat; the head
// with its beak, cere and orange eye.
function paintPigeonHead(
  art: Art,
  at: { readonly head: readonly [number, number]; readonly neck: readonly [number, number] }
): void {
  const { g, tone } = art
  const [hx, hy] = at.head
  const [sx, sy] = at.neck
  const [blue, green] = PIGEON.neck

  curve(g, {
    points: [sx - 1, sy + 1.5, sx + (hx - sx) * 0.2, sy - 1, hx - 1, hy + 3],
    w: 9,
    tone: tone(blue),
  })
  oval(g, [sx + 0.6, sy + 0.6, 5.4, 5.6, 0.4], tone(blue))

  if (art.detail >= 1) {
    oval(g, [sx + 1.5, sy - 0.6, 3.6, 3.6, 0.4], tone(green))
    curve(g, {
      points: [sx + 1, sy - 2.5, (sx + hx) / 2 + 1, (sy + hy) / 2 - 1, hx - 1.4, hy + 2.5],
      w: 4.2,
      tone: tone(green),
    })
  }

  oval(g, [sx + 2.4, sy + 2.8, 3.4, 2.6, 0.3], tone(PIGEON_STAND.purple))
  oval(g, [hx, hy, 3.9, 3.6], tone(PIGEON.head))
  poly(g, tone(PIGEON.beak), [hx + 3.1, hy - 0.5, hx + 7, hy + 0.8, hx + 3.1, hy + 1.7])

  if (art.detail >= 1) {
    oval(g, [hx + 3.6, hy - 0.5, 1.3, 0.95], tone(PIGEON_STAND.cere))
    oval(g, [hx + 1.2, hy - 1, 1.05, 1.05], tone(PIGEON.eye))
  }

  if (art.detail === 2) {
    oval(g, [hx + 1.2, hy - 1, 0.5, 0.5], tone(PIGEON_STAND.pupil))
    line(g, {
      from: [hx + 3.3, hy + 0.4],
      to: [hx + 6.2, hy + 0.9],
      w: 0.35,
      tone: tone(PIGEON_STAND.mouth),
    })
  }
}

/** The tree sparrow: chestnut cap, white cheek with a black spot, black bib, streaked brown back
 *  and two pale wing bars; it flicks its tail as it stands. */
export function paintSparrow(art: Art): void {
  const { g, critter, tone } = art

  if (critter.pose === 'fly') {
    paintFlight(art, SPARROW)
    return
  }

  const isPeck = critter.pose === 'peck'
  const flick = critter.frame === 1 && !isPeck ? 2.6 : 0
  const leg = tone(SPARROW_STAND.leg)

  line(g, { from: [-0.2, -3.4], to: [-0.8, 0], w: 1.1, tone: leg })
  line(g, { from: [2, -3.4], to: [2.2, 0], w: 1.1, tone: leg })

  if (art.detail === 2) {
    line(g, { from: [-0.8, 0], to: [0.8, 0], w: 0.6, tone: leg })
    line(g, { from: [2.2, 0], to: [3.8, 0], w: 0.6, tone: leg })
  }

  g.save()
  g.translate(1, -3.5)
  g.rotate(isPeck ? 0.55 : 0)
  g.translate(-1, 3.5)
  poly(g, tone(SPARROW.tail), [-6, -6.4, -14.6, -3.2 - flick, -14.2, -1.4 - flick, -5.4, -3.8])
  oval(g, [0.3, -5.6, 5.6, 3.3, -0.5], tone(SPARROW.belly))
  oval(g, [-1.4, -7.2, 5.6, 2.8, -0.45], tone(SPARROW.body))
  oval(g, [-2.2, -7.6, 4.2, 2.1, -0.45], tone(SPARROW.wing))
  paintSparrowMarks(art)
  g.restore()
}

function paintSparrowMarks(art: Art): void {
  const { g, tone } = art

  if (art.detail >= 1) {
    for (const k of [0, 1]) {
      line(g, {
        from: [-3.4 + k * 2.6, -9.8 + k * 1.1],
        to: [-1.8 + k * 2.6, -7.2 + k * 1.1],
        w: 0.55,
        tone: tone(SPARROW.bar),
      })
    }
  }

  if (art.detail === 2) {
    for (const k of [0, 1, 2, 3]) {
      line(g, {
        from: [-7 + k * 1.6, -8.4 + k * 0.7],
        to: [-6.2 + k * 1.6, -6.4 + k * 0.7],
        w: 0.4,
        tone: tone(SPARROW_STAND.streak),
      })
    }
  }

  oval(g, [5, -10.3, 3.7, 3.5], tone(SPARROW.head))
  g.fillStyle = tone(SPARROW.cap)
  g.beginPath()
  g.arc(5, -10.3, 3.75, Math.PI * 0.92, Math.PI * 2.1)
  g.fill()
  oval(g, [7, -7.3, 1.25, 1.8, 0.25], tone(SPARROW_STAND.bib))
  oval(g, [4.2, -9, 0.75, 0.75], tone(SPARROW_STAND.bib))
  poly(g, tone(SPARROW.beak), [8, -10.9, 10.8, -9.9, 8, -8.9])

  if (art.detail >= 1) {
    oval(g, [6.3, -11.1, 0.7, 0.7], tone(SPARROW.eye))
  }

  if (art.detail === 2) {
    oval(g, [3.2, -8.2, 1.1, 0.5, 0.4], tone(SPARROW_STAND.throat))
  }
}
