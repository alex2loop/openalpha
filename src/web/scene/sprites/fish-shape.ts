import {
  type AnimalPart,
  type Band,
  type Ellipsoid,
  e,
  INK,
  NO_TURN,
  part,
  type Vec3,
} from '@/web/scene/sprites/animal-parts'

/** Each fish's length in cm, and its colours. */
export const FISH_LOOKS = Object.freeze({
  gold: { L: 30, body: '#FF8B2E', head: '#F0601E', belly: '#FFD9A8', fin: '#FF9F45' },
  pale: { L: 26, body: '#F7D25B', head: '#F2C23E', belly: '#FFF3CF', fin: '#F9DF86' },
  koi: { L: 38, body: '#F8F4EA', head: '#F8F4EA', belly: '#FFFFFF', fin: '#E9E4D6' },
})

const KOI_SPOT = '#E0452C'

export function fishShape(kind: 'gold' | 'pale' | 'koi', lv: number): AnimalPart[] {
  const look = FISH_LOOKS[kind]
  const { L } = look
  const koi = kind === 'koi'
  const spots: readonly Band[] = [
    [-0.45, -0.05, KOI_SPOT],
    [0.35, 0.7, KOI_SPOT],
  ]
  const fr = [
    e([[0, 0, 0], [0.33 * L, 0.2 * L, 0.115 * L], look.body, undefined, koi ? spots : undefined]),
    e([[0.02 * L, -0.07 * L, 0], [0.27 * L, 0.11 * L, 0.1 * L], look.belly]),
    e([[0.2 * L, 0.01 * L, 0], [0.15 * L, 0.15 * L, 0.1 * L], koi ? KOI_SPOT : look.head]),
  ]

  fr.push(...fishSides(look, lv))

  fr.push(e([[-0.04 * L, 0.25 * L, 0], [0.17 * L, 0.1 * L, 0.016 * L], look.fin, [0.5, 0]]))

  if (koi) {
    fr.push(
      e([[0.1 * L, 0.11 * L, 0], [0.03 * L, 0.012 * L, 0.1 * L], INK]),
      e([[-0.15 * L, 0.09 * L, 0.08 * L], [0.035 * L, 0.03 * L, 0.04 * L], INK])
    )
  }

  const rear = [e([[-0.09 * L, 0, 0], [0.14 * L, 0.115 * L, 0.07 * L], look.body])]
  const fin = [-1, 1].map((s) =>
    e([[-0.12 * L, s * 0.11 * L, 0], [0.23 * L, 0.13 * L, 0.014 * L], look.fin, [s * 0.5, 0]])
  )

  return [
    part('front', { T: [0, 0, 0], A: NO_TURN, prims: fr }),
    part('rear', { parent: 'front', T: [-0.27 * L, 0, 0], A: NO_TURN, prims: rear }),
    part('fin', { parent: 'rear', T: [-0.17 * L, 0, 0], A: NO_TURN, prims: fin }),
  ]
}

// Each side's eye and pectoral fin, and the belly fins when the fish is seen close.
function fishSides(look: (typeof FISH_LOOKS)[keyof typeof FISH_LOOKS], lv: number): Ellipsoid[] {
  const { L } = look
  const out: Ellipsoid[] = []

  for (const s of [-1, 1]) {
    const eye: Vec3 = lv > 0 ? [0.032 * L, 0.034 * L, 0.02 * L] : [0.05 * L, 0.05 * L, 0.03 * L]

    out.push(
      e([[0.26 * L, 0.05 * L, 0.075 * L * s], eye, '#1B1517']),
      e([
        [0.12 * L, -0.07 * L, 0.12 * L * s],
        [0.09 * L, 0.03 * L, 0.012 * L],
        look.fin,
        [0.5, -0.5 * s],
      ])
    )

    if (lv >= 1) {
      out.push(
        e([[0, -0.12 * L, 0.06 * L * s], [0.06 * L, 0.025 * L, 0.01 * L], look.fin, [0.4, 0]])
      )
    }
  }

  return out
}
