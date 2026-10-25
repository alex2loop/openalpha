/** World pixels of one floor. */
export const WORLD = Object.freeze({ w: 640, h: 384 })
/** A person's box in world px, feet at its bottom centre. */
export const FIGURE = Object.freeze({ w: 24, h: 32 })

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

/** Every built-in person in the office, one per role (the library has two scouts). */
export type ActorId =
  | 'bull'
  | 'pm'
  | 'bear'
  | 'analyst'
  | 'verifier'
  | 'trader'
  | 'risk'
  | 'planner'
  | 'crawler-1'
  | 'crawler-2'
  | 'reviewer'
  | 'synth'
  | 'theme'
  | 'keeper'
  | 'assistant'
  | 'clerk'
/** What a person does; debate roles carry the daemon's own role names (`trading.debate.role.*`). */
export type RoleId =
  | 'bull-researcher'
  | 'bear-researcher'
  | 'portfolio-manager'
  | 'trader'
  | 'risk-analyst'
  | 'claim-verifier'
  | 'market-analyst'
  | 'planner'
  | 'crawler'
  | 'reviewer'
  | 'synth'
  | 'theme'
  | 'keeper'
  | 'assistant'
  | 'clerk'
export type Dir = 'up' | 'down' | 'left' | 'right'
/** Every pose a person can take; the vocabulary names them, the renderers draw them. */
export type PoseId =
  | 'idle'
  | 'walk'
  | 'sit'
  | 'type'
  | 'hand'
  | 'carry'
  | 'scratch'
  | 'phone-call'
  | 'phone-read'
  | 'reach'
  | 'stamp'
  | 'nod'
  | 'shrug'
  | 'cheer'
  | 'lean-back'
  | 'glance'
  | 'sip'
  | 'foot-tap'
  | 'nap'
  | 'yawn'
  | 'hands-up'
  | 'point'
  | 'watch'
  | 'chat'
  | 'wave'
  | 'look'
  | 'busy-glance'

/** Something a person holds besides a sheet. */
export type HeldItem = 'card' | 'calculator' | 'pen' | 'phone' | 'headset' | 'wallet' | 'box'

/** A sheet in hand; once stamped it carries the call's action, its stamp in the action's hue. */
export interface SheetView {
  readonly action?: 'buy' | 'reduce' | 'hold'
}

/** One person as the renderers draw them: `prev` and `at` are the last two sim steps. */
export interface ActorView {
  readonly id: ActorId
  readonly role: RoleId
  readonly floor: FloorId
  readonly prev: Point
  readonly at: Point
  readonly facing: Dir
  readonly working: boolean
  readonly pose: PoseId
  /** When the pose began, a `performance.now()` instant: its frames play from there. */
  readonly poseSince: number
  readonly item?: HeldItem
  readonly sheet?: SheetView
}

/** A sheet flying between two people, or to the tray: `k` is how far it has come (0 to 1) at the
 *  last sim step, `prevK` at the one before. */
export interface PaperView {
  readonly floor: FloorId
  readonly from: Point
  readonly to: Point
  readonly prevK: number
  readonly k: number
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
  readonly papers: readonly PaperView[]
  /** Sheets on the operator's tray. */
  readonly tray: number
  readonly props: PropsView
  readonly light: LightView
}
