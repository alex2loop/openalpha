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

/** An area in world pixels: `x`, `y` its top-left corner. */
export interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** A width and a height, in the units of whoever holds it. */
export interface Size {
  readonly w: number
  readonly h: number
}

export type FloorId = 'office' | 'team'
export type RoomId = 'store' | 'lib' | 'meet' | 'lobby' | 'alerts' | 'assist' | 'desk' | 'team'

type ActorId = string & { readonly __brand: 'ActorId' }
type RoleId = string & { readonly __brand: 'RoleId' }
type Dir = 'up' | 'down' | 'left' | 'right'

/** One person as the renderers draw them: `prev` and `at` are the last two sim steps. */
export interface ActorView {
  readonly id: ActorId
  readonly role: RoleId
  readonly floor: FloorId
  readonly prev: Point
  readonly at: Point
  readonly facing: Dir
  readonly working: boolean
}

/** The light the office keeps: the page hour, or the day row when the light does not follow it. */
interface LightView {
  readonly hour: number
  readonly followsHour: boolean
}

/** What the props show: the rooms whose lamp is on. */
interface PropsView {
  readonly lit: ReadonlySet<RoomId>
}

/** The snapshot every renderer reads; `alpha` is how far the frame sits between two sim steps. */
export interface SimView {
  readonly floor: FloorId
  readonly alpha: number
  readonly actors: readonly ActorView[]
  readonly props: PropsView
  readonly light: LightView
}
