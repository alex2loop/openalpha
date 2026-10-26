/** One ellipsoid of an animal, in the model's units: its centre, radii, colour, its turn about z
 *  then y (radians), and the darker bands round it (from and to along x as -1..1 shares). */
export interface Ellipsoid {
  readonly c: readonly [number, number, number]
  readonly r: readonly [number, number, number]
  readonly tone: string
  readonly turn: readonly [z: number, y: number]
  readonly bands?: readonly (readonly [number, number, string])[]
}

/** A part that turns on its own: where it hangs off its parent, its rest turn, its ellipsoids. */
export interface AnimalPart {
  readonly name: string
  readonly parent?: string
  readonly at: readonly [number, number, number]
  readonly turn: readonly [z: number, y: number]
  readonly prims: readonly Ellipsoid[]
}

/** The poses the mockup's model knows: the cat sits, sleeps or walks; the corgi stands, lies or
 *  sleeps. */
export type ModelPose = 'sit' | 'sleep' | 'walk' | 'stand' | 'lie'

/** A point or a size in the model's units. */
export type Vec = readonly [number, number, number]

/** A face's white glint, the same on every animal. */
export const GLINT = '#FFFFFF'
/** No turn. */
export const NO_TURN: readonly [number, number] = [0, 0]

export function e(
  c: Vec,
  r: Vec,
  look: {
    readonly tone: string
    readonly turn?: readonly [number, number]
    readonly bands?: Ellipsoid['bands']
  }
): Ellipsoid {
  return {
    c,
    r,
    tone: look.tone,
    turn: look.turn ?? NO_TURN,
    ...(look.bands === undefined ? {} : { bands: look.bands }),
  }
}

export function part(
  name: string,
  at: { readonly parent?: string; readonly at: Vec; readonly turn?: readonly [number, number] },
  prims: readonly Ellipsoid[]
): AnimalPart {
  return {
    name,
    ...(at.parent === undefined ? {} : { parent: at.parent }),
    at: at.at,
    turn: at.turn ?? NO_TURN,
    prims,
  }
}

// A thing standing `off` from its base and leaning back by `lean`, as the mockup's `anAt`.
export function leanedAt(base: Vec, off: number, lean: number): Vec {
  return [base[0] - off * Math.sin(lean), base[1] + off * Math.cos(lean), base[2]]
}
