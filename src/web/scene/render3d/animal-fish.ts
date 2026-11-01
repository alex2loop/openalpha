import type { DetailLevel } from '@/web/scene/sim/life/animal-model'
import { type AnimalPart, type Ellipsoid, e, part } from '@/web/scene/render3d/animal-parts'
import { FISH_LOOKS } from '@/web/scene/sprites/fish-shape'

/** The tank's fish, in the order the sim lists them. */
export const FISH_KINDS = ['gold', 'pale', 'koi'] as const

type FishKind = (typeof FISH_KINDS)[number]

type Look = (typeof FISH_LOOKS)[FishKind]

const EYE = '#1B1517'
const KOI_SPOT = '#E0452C'
const KOI_INK = '#2B2433'
const KOI_BANDS = [
  [-0.45, -0.05, KOI_SPOT],
  [0.35, 0.7, KOI_SPOT],
] as const

/** The mockup's fish: the front (body, belly, head, eyes, side fins), the rear hung from it and
 *  the tail fin hung from the rear, so a beat swings the rear a little and the fin more. All
 *  sizes follow the fish's length. */
export function fishShape(kind: FishKind, level: DetailLevel): AnimalPart[] {
  const look = FISH_LOOKS[kind]
  const { L } = look
  const sides = [-1, 1].flatMap((side) => sideOf(look, { side, level }))
  const rear = e([-0.09 * L, 0, 0], [0.14 * L, 0.115 * L, 0.07 * L], { tone: look.body })
  const fins = [-1, 1].map((side) =>
    e([-0.12 * L, side * 0.11 * L, 0], [0.23 * L, 0.13 * L, 0.014 * L], {
      tone: look.fin,
      turn: [side * 0.5, 0],
    })
  )

  return [
    part('front', { at: [0, 0, 0] }, [...bodyOf(kind, look), ...sides, ...backOf(kind, look)]),
    part('rear', { parent: 'front', at: [-0.27 * L, 0, 0] }, [rear]),
    part('fin', { parent: 'rear', at: [-0.17 * L, 0, 0] }, fins),
  ]
}

// The body over its pale belly, and the head; a koi is spotted and has a red head.
function bodyOf(kind: FishKind, look: Look): Ellipsoid[] {
  const { L } = look
  const isKoi = kind === 'koi'

  return [
    e([0, 0, 0], [0.33 * L, 0.2 * L, 0.115 * L], {
      tone: look.body,
      ...(isKoi ? { bands: KOI_BANDS } : {}),
    }),
    e([0.02 * L, -0.07 * L, 0], [0.27 * L, 0.11 * L, 0.1 * L], { tone: look.belly }),
    e([0.2 * L, 0.01 * L, 0], [0.15 * L, 0.15 * L, 0.1 * L], {
      tone: isKoi ? KOI_SPOT : look.head,
    }),
  ]
}

// The back fin, and a koi's dark patches.
function backOf(kind: FishKind, look: Look): Ellipsoid[] {
  const { L } = look
  const back = e([-0.04 * L, 0.25 * L, 0], [0.17 * L, 0.1 * L, 0.016 * L], {
    tone: look.fin,
    turn: [0.5, 0],
  })

  if (kind !== 'koi') {
    return [back]
  }

  return [
    back,
    e([0.1 * L, 0.11 * L, 0], [0.03 * L, 0.012 * L, 0.1 * L], { tone: KOI_INK }),
    e([-0.15 * L, 0.09 * L, 0.08 * L], [0.035 * L, 0.03 * L, 0.04 * L], { tone: KOI_INK }),
  ]
}

// One side's eye and side fin, and the belly fin when the fish is seen from a room's distance.
function sideOf(
  look: Look,
  at: { readonly side: number; readonly level: DetailLevel }
): Ellipsoid[] {
  const { L } = look
  const { side, level } = at
  const eye: readonly [number, number, number] =
    level > 0 ? [0.032 * L, 0.034 * L, 0.02 * L] : [0.05 * L, 0.05 * L, 0.03 * L]
  const out = [
    e([0.26 * L, 0.05 * L, 0.075 * L * side], eye, { tone: EYE }),
    e([0.12 * L, -0.07 * L, 0.12 * L * side], [0.09 * L, 0.03 * L, 0.012 * L], {
      tone: look.fin,
      turn: [0.5, -0.5 * side],
    }),
  ]

  if (level >= 1) {
    out.push(
      e([0, -0.12 * L, 0.06 * L * side], [0.06 * L, 0.025 * L, 0.01 * L], {
        tone: look.fin,
        turn: [0.4, 0],
      })
    )
  }

  return out
}
