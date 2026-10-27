/** The mockup's animal model: ellipsoids in centimetres (1 world px is 5 cm), grouped into parts
 *  hung from one another. The 2D animal painter rasterises it into a side-lit sprite. */

export type Vec3 = readonly [number, number, number]
export type Turn = readonly [number, number]
/** A painted ring round an ellipsoid: from and to along its x axis (-1 to 1), and its colour. */
export type Band = readonly [number, number, string]

export interface Ellipsoid {
  readonly c: Vec3
  readonly r: Vec3
  readonly k: string
  readonly a: Turn
  readonly band?: readonly Band[]
}

export interface AnimalPart {
  readonly name: string
  readonly parent?: string
  readonly T: Vec3
  readonly A: Turn
  readonly prims: readonly Ellipsoid[]
}

export type AnimalKind = 'cat' | 'corgi' | 'gold' | 'pale' | 'koi'

export const NO_TURN: Turn = [0, 0]
export const WHITE = '#FFFFFF'
export const INK = '#2B2433'

// One ellipsoid as the mockup writes it: centre, radii, colour, then its turn and tabby rings.
export function e(
  spec: readonly [Vec3, Vec3, string, (Turn | undefined)?, (readonly Band[] | undefined)?]
): Ellipsoid {
  const [c, r, k, a, band] = spec

  return band === undefined ? { c, r, k, a: a ?? NO_TURN } : { c, r, k, a: a ?? NO_TURN, band }
}

export function part(name: string, spec: Omit<AnimalPart, 'name'>): AnimalPart {
  return { name, ...spec }
}

// The centre of a thing that stands `off` cm from its base and leans back by `az`.
export function lean(base: Vec3, off: number, az: number): Vec3 {
  return [base[0] - off * Math.sin(az), base[1] + off * Math.cos(az), base[2]]
}
