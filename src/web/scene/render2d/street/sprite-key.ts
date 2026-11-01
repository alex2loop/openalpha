import { spriteKeyOf } from '@/web/scene/render2d/street/detail'

/** Sprites are painted at these px per world px by detail level: sharp at each zoom band's top. */
export const SPRITE_PX = [2, 5, 10] as const

/** The key a sprite is cached under, held per thing drawn while its look stays the same. */
interface HeldKey {
  sig: number
  key: string
  fullKey: string
  language: string
}

// Keyed by the pools' own slots, so it never holds more than they do.
const heldKeys = new WeakMap<object, HeldKey>()

/** The sprite key of `owner`'s look while its signature stays `sig` (with the detail level as its
 *  lowest digit) and its words stay in `language`, held per owner so a hot path builds no string. */
export function heldKeyOf(
  owner: object,
  at: { readonly sig: number; readonly prefix: string; readonly language?: string }
): HeldKey {
  const { sig } = at
  const language = at.language ?? ''
  const held = heldKeys.get(owner)

  if (held !== undefined && held.sig === sig && held.language === language) {
    return held
  }

  const key = language === '' ? `${at.prefix}|${sig}` : `${at.prefix}|${sig}|${language}`
  const next = { sig, key, fullKey: spriteKeyOf(key, pxOfSig(sig)), language }

  heldKeys.set(owner, next)

  return next
}

function pxOfSig(sig: number): number {
  return SPRITE_PX[sig % SPRITE_PX.length] ?? SPRITE_PX[0]
}
