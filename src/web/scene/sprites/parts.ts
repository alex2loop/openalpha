import type { AgentLookWire } from '@/app/server/wire/agents'
import type { RoleId } from '@/web/scene/types'
import { createRng, seedOf } from '@/web/scene/world/rng'

const LOOK_POOL = 'look'

/** What the agent form offers, part by part; the daemon keeps only the shape of a look. Shirts
 *  never take a market hue or purple. */
export const LOOK_PARTS = Object.freeze({
  body: ['light', 'medium', 'deep'],
  hair: ['short', 'long', 'bob', 'bun', 'cap'],
  shirt: ['teal', 'blue', 'sky', 'amber', 'orange', 'pink', 'slate', 'sand'],
  prop: ['none', 'book', 'clipboard', 'tie', 'glasses', 'scarf'],
} as const)

const HAIR_TONES = ['dark', 'brown', 'blond', 'grey'] as const

export type LookPart = keyof typeof LOOK_PARTS
export type Body = (typeof LOOK_PARTS.body)[number]
export type Shirt = (typeof LOOK_PARTS.shirt)[number]
export type HairTone = (typeof HAIR_TONES)[number]
/** The built-in crew may also go bald. */
export type Hair = (typeof LOOK_PARTS.hair)[number] | 'bald'
/** Props only the built-in crew wears; `bear` turns the whole figure into one. */
type RoleProp =
  | 'headset'
  | 'visor'
  | 'apron'
  | 'lanyard'
  | 'monocle'
  | 'mug'
  | 'scroll'
  | 'horns'
  | 'bear'
export type Prop = (typeof LOOK_PARTS.prop)[number] | RoleProp
export type PantsTone = 'khaki' | 'charcoal' | 'plum'

/** How one person is drawn, in both renderers. The mascot ignores the rest. */
export interface Look {
  readonly body: Body
  readonly hair: Hair
  readonly hairTone: HairTone
  readonly shirt: Shirt
  readonly prop: Prop
  readonly isMascot: boolean
}

/** Trousers go with the shirt, so no figure wears one colour head to foot. */
export const PANTS_OF: Readonly<Record<Shirt, PantsTone>> = Object.freeze({
  teal: 'khaki',
  blue: 'khaki',
  sky: 'khaki',
  amber: 'charcoal',
  orange: 'charcoal',
  pink: 'charcoal',
  slate: 'plum',
  sand: 'plum',
})

const MASCOT: Look = Object.freeze({
  body: 'light',
  hair: 'short',
  hairTone: 'dark',
  shirt: 'slate',
  prop: 'none',
  isMascot: true,
})

/** The built-in crew. Roles differ by shape first; the looks that read as a famous game hero were
 *  recoloured (the bull's hair, the second scout's shirt, the clerk's shirt). */
const ROLE_LOOKS: Readonly<Record<RoleId, Look>> = Object.freeze({
  'bull-researcher': person({ hair: 'short', hairTone: 'blond', shirt: 'teal', prop: 'horns' }),
  'portfolio-manager': person({ hair: 'bob', hairTone: 'dark', shirt: 'blue', prop: 'glasses' }),
  'bear-researcher': person({ hair: 'short', hairTone: 'brown', shirt: 'sand', prop: 'bear' }),
  'market-analyst': person({ hair: 'short', hairTone: 'dark', shirt: 'sky', prop: 'tie' }),
  'claim-verifier': person({ hair: 'bald', hairTone: 'grey', shirt: 'slate', prop: 'monocle' }),
  trader: person({ hair: 'short', hairTone: 'dark', shirt: 'amber', prop: 'headset' }),
  'risk-analyst': person({ hair: 'short', hairTone: 'brown', shirt: 'orange', prop: 'visor' }),
  planner: person({ hair: 'bun', hairTone: 'blond', shirt: 'slate', prop: 'clipboard' }),
  crawler: person({ hair: 'cap', hairTone: 'dark', shirt: 'sky', prop: 'none' }),
  reviewer: person({ hair: 'bob', hairTone: 'grey', shirt: 'teal', prop: 'book' }),
  synth: person({ hair: 'long', hairTone: 'brown', shirt: 'pink', prop: 'scroll' }),
  theme: person({ hair: 'long', hairTone: 'dark', shirt: 'blue', prop: 'scarf' }),
  keeper: person({ hair: 'short', hairTone: 'dark', shirt: 'slate', prop: 'apron' }),
  assistant: MASCOT,
  clerk: person({ hair: 'short', hairTone: 'brown', shirt: 'orange', prop: 'lanyard' }),
})

// A second person in one role: the library's two scouts.
const ACTOR_LOOKS: Readonly<Partial<Record<string, Look>>> = Object.freeze({
  'crawler-2': person({ hair: 'cap', hairTone: 'brown', shirt: 'sand', prop: 'none' }),
})

/** A person's look: a built-in role's own, else each part from `wire` when the form offers it,
 *  otherwise the one the id's seed derives. The derived parts never shift when one is picked. */
export function lookOf(id: string, role: RoleId | undefined, wire?: AgentLookWire): Look {
  if (role !== undefined) {
    return ACTOR_LOOKS[id] ?? ROLE_LOOKS[role]
  }

  const rng = createRng(seedOf(LOOK_POOL, id))

  return {
    body: resolvePart(LOOK_PARTS.body, wire?.body, rng.pick(LOOK_PARTS.body)),
    hair: resolvePart(LOOK_PARTS.hair, wire?.hair, rng.pick(LOOK_PARTS.hair)),
    hairTone: rng.pick(HAIR_TONES),
    shirt: resolvePart(LOOK_PARTS.shirt, wire?.shirt, rng.pick(LOOK_PARTS.shirt)),
    prop: resolvePart(LOOK_PARTS.prop, wire?.prop, rng.pick(LOOK_PARTS.prop)),
    isMascot: false,
  }
}

function person(parts: Pick<Look, 'hair' | 'hairTone' | 'shirt' | 'prop'>): Look {
  return Object.freeze({ ...parts, body: 'light', isMascot: false })
}

function resolvePart<T extends string>(
  list: readonly T[],
  value: string | undefined,
  derived: T
): T {
  return list.find((part) => part === value) ?? derived
}
