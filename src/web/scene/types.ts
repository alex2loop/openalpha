/** World pixels of one floor. */
export const WORLD = Object.freeze({ w: 640, h: 384 })

/** A place in world pixels. */
export interface Point {
  readonly x: number
  readonly y: number
}

/** A place in CSS pixels of the scene host. */
export interface ScreenPoint {
  readonly x: number
  readonly y: number
}

export type FloorId = 'office' | 'team'
export type RoomId = string & { readonly __brand: 'RoomId' }

type ActorId = string & { readonly __brand: 'ActorId' }
type RoleId = string & { readonly __brand: 'RoleId' }
type Dir = 'up' | 'down' | 'left' | 'right'

/** One person as the renderers draw them: `prev` and `at` are the last two sim steps. */
interface ActorView {
  readonly id: ActorId
  readonly role: RoleId
  readonly floor: FloorId
  readonly prev: Point
  readonly at: Point
  readonly facing: Dir
  readonly working: boolean
}

/** The snapshot every renderer reads; `alpha` is how far the frame sits between two sim steps. */
export interface SimView {
  readonly floor: FloorId
  readonly alpha: number
  readonly actors: readonly ActorView[]
}
