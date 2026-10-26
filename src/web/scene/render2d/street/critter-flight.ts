import { type Art, line, oval, poly } from '@/web/scene/render2d/street/critter-shapes'

// A bird's wing in flight swings from up (frame 0) to below the body (frame 2).
const WING_ANGLES = [0.2, 0.95, 2.35, 1.55] as const

/** A bird's flight look: body length and depth, wing span and width, the wing's shoulder, head
 *  size, and its colours (`neck` and `cap` where it has them). */
export interface Flyer {
  readonly bl: number
  readonly br: number
  readonly span: number
  readonly width: number
  readonly shoulder: number
  readonly hd: number
  readonly body: string
  readonly belly: string
  readonly wing: string
  readonly wingFar: string
  readonly bar: string
  readonly tip: string
  readonly tail: string
  readonly head: string
  readonly beak: string
  readonly eye: string
  readonly neck?: readonly [string, string]
  readonly cap?: string
}

// A bird in flight seen from the side: the far wing, tail, body and belly, the neck sheen, the head
// with its cap, beak and eye, then the near wing with its bars and dark tip.
export function paintFlight(art: Art, bird: Flyer): void {
  const { g, tone } = art
  const angle = WING_ANGLES[art.critter.frame % WING_ANGLES.length] ?? 0
  const { bl, br } = bird

  paintFlightWing(art, { bird, angle, dx: -2, tone: bird.wingFar, hasBars: false })
  poly(g, tone(bird.tail), [
    -bl * 0.7,
    -br * 0.35,
    -bl * 1.9,
    -br * 0.9,
    -bl * 1.95,
    br * 0.4,
    -bl * 0.7,
    br * 0.4,
  ])
  oval(g, [0, 0, bl, br, -0.14], tone(bird.body))

  if (art.detail >= 1) {
    oval(g, [bl * 0.1, br * 0.4, bl * 0.8, br * 0.5, -0.14], tone(bird.belly))
  }

  if (bird.neck !== undefined) {
    oval(g, [bl * 0.7, -br * 0.1, br * 0.8, br * 0.8], tone(bird.neck[0]))

    if (art.detail >= 1) {
      oval(g, [bl * 0.75, -br * 0.3, br * 0.5, br * 0.5], tone(bird.neck[1]))
    }
  }

  paintFlightHead(art, bird)
  paintFlightWing(art, { bird, angle, dx: 0, tone: bird.wing, hasBars: true })
}

// The head with its cap, beak and eye.
function paintFlightHead(art: Art, bird: Flyer): void {
  const { g, tone } = art
  const { bl, br, hd } = bird

  const hx = bl + hd * 0.5
  const hy = -br * 0.6

  oval(g, [hx, hy, hd, hd], tone(bird.head))

  if (bird.cap !== undefined) {
    oval(g, [hx - 0.3, hy - hd * 0.3, hd * 0.95, hd * 0.7], tone(bird.cap))
  }

  poly(g, tone(bird.beak), [
    hx + hd * 0.9,
    hy - 0.4,
    hx + hd * 1.9,
    hy + 0.3,
    hx + hd * 0.9,
    hy + 1.1,
  ])

  if (art.detail >= 1) {
    oval(g, [hx + hd * 0.45, hy - hd * 0.2, hd * 0.2, hd * 0.2], tone(bird.eye))
  }
}

function paintFlightWing(
  art: Art,
  wing: {
    readonly bird: Flyer
    readonly angle: number
    readonly dx: number
    readonly tone: string
    readonly hasBars: boolean
  }
): void {
  const { g, tone } = art
  const { bird, angle, dx } = wing
  const x0 = bird.shoulder + dx
  const y0 = -bird.br * 0.35
  const tx = x0 - Math.sin(angle) * bird.span * 0.4
  const ty = y0 - Math.cos(angle) * bird.span
  const rot = Math.atan2(ty - y0, tx - x0)
  const at = (share: number): readonly [number, number] => [
    x0 + (tx - x0) * share,
    y0 + (ty - y0) * share,
  ]
  const across = [Math.sin(rot) * bird.width * 0.4, -Math.cos(rot) * bird.width * 0.4] as const

  oval(g, [(x0 + tx) / 2, (y0 + ty) / 2, bird.span * 0.52, bird.width / 2, rot], tone(wing.tone))

  if (wing.hasBars && art.detail >= 1) {
    for (const share of [0.38, 0.62]) {
      const [cx, cy] = at(share)

      line(g, {
        from: [cx - across[0], cy - across[1]],
        to: [cx + across[0], cy + across[1]],
        w: bird.width * 0.2,
        tone: tone(bird.bar),
      })
    }
  }

  if (art.detail === 2) {
    const [cx, cy] = at(0.9)

    oval(g, [cx, cy, bird.span * 0.14, bird.width * 0.4, rot], tone(bird.tip))
  }
}
