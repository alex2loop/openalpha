import type { AgentLookWire } from '@/app/server/wire/agents'

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
  | `agent:${string}`
  | `kid:${string}`
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
  /** A built-in person's role; the operator's own agents and their children have none. */
  readonly role?: RoleId
  /** The look an own agent saved, part by part; the renderers resolve it with `lookOf`. */
  readonly look?: AgentLookWire
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

/** The prop an own agent's desk carries, read off its focus. */
export type DeskFocus = 'safe' | 'candles' | 'gold' | 'piggy'

/** One desk of the team floor, by its slot: the own agent working at it, if any. */
export interface DeskView {
  readonly slot: number
  readonly agentId?: string
  readonly focus?: DeskFocus
  /** Its agent is not paused: the screen casts a cool glow. */
  readonly isGlowing: boolean
  /** Someone sits at it: its agent, or a child that took the free desk. */
  readonly isTaken: boolean
  /** Someone at it works on a run now: its screen is lit. */
  readonly isLit: boolean
  /** Its agent's child agents still working, and those carrying their answer back. */
  readonly kidsOpen: number
  readonly kidsBack: number
}

/** A temporary child agent: the role its parent gave it, and the parent it works for. */
export interface KidView {
  readonly actor: ActorId
  readonly role: string
  readonly parentRunId: string
  readonly parentAgentId?: string
}

/** A dotted thread from a parent's desk to one open child, in world px. */
export interface ThreadView {
  readonly from: Point
  readonly to: Point
}

/** A scored call at an own agent's desk: a burst for a target, a cloud for a stop. `since` is a
 *  `performance.now()` instant. */
export interface BurstView {
  readonly at: Point
  readonly tone: 'target' | 'stop'
  readonly since: number
}

/** One stored call the cooler talk reads aloud; `day` (`YYYY-MM-DD`) and `reason` (the first
 *  sentence of its thesis) only on the other agent's saved call. */
export interface CoolerCall {
  readonly agent: string
  readonly ticker: string
  readonly action: 'buy' | 'reduce' | 'hold'
  readonly day?: string
  readonly reason?: string
}

/** What a person on the team floor says: always a template, never generated. */
export type TeamSay =
  | { readonly kind: 'hello'; readonly name: string }
  | { readonly kind: 'hello-reply'; readonly name: string }
  | { readonly kind: 'cooler-mine'; readonly call: CoolerCall }
  | { readonly kind: 'cooler-theirs'; readonly call: CoolerCall }
  | { readonly kind: 'kid-end'; readonly outcome: string }
  | { readonly kind: 'kids-folding'; readonly partial: number; readonly stopped: number }
  | { readonly kind: 'daemon'; readonly text: string }

/** A spoken line by its person, or by the run it is about (its person found by its goal);
 *  `atMs` and `untilMs` are `performance.now()` instants. */
export interface TeamLine {
  readonly id: string
  readonly actor?: ActorId
  readonly runId?: string
  readonly say: TeamSay
  readonly atMs: number
  readonly untilMs: number
}

/** The team floor's own state: its desks, its children, threads, scored bursts and lines. */
export interface TeamView {
  readonly desks: readonly DeskView[]
  readonly kids: readonly KidView[]
  readonly threads: readonly ThreadView[]
  readonly bursts: readonly BurstView[]
  readonly lines: readonly TeamLine[]
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
  readonly team: TeamView
}
