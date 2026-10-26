import type { AgentLookWire } from '@/app/server/wire/agents'
import type { MessageKey } from '@/i18n'
import type { SunView, WeatherFxView } from '@/web/scene/sky-types'
import type { ErrandView, StreetFrame } from '@/web/scene/street-types'

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
  | CrewRole
  | `agent:${string}`
  | `child:${string}`
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
  | CrewRole
/** The building crew: people of the office floor who are not agents. */
export type CrewRole = 'receptionist' | 'guard' | 'cleaner'
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
  | 'look-down'
  | 'sit-up'

/** What a person shows the operator for a moment: a look up at the pointer, a wave when free, a
 *  glance up from busy work. */
export type ReactionKind = 'look' | 'greet' | 'busy-glance'

/** Something a person holds besides a sheet. */
export type HeldItem =
  | 'card'
  | 'calculator'
  | 'pen'
  | 'phone'
  | 'headset'
  | 'wallet'
  | 'box'
  | 'cup'
  | 'bag'
  | 'mop'

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
  /** The dot over the head: free, waiting on you or its turn, or its last run hit an error. None
   *  while it works (the work rim says so). */
  readonly status?: ActorStatus
  readonly react?: ReactionKind
  /** Out on an errand to a shop; past the street door the street draws them, at `at`. */
  readonly errand?: ErrandView
  /** Not in the office now (past the street door, not yet back): neither floor draws them. */
  readonly isAway?: true
  /** In the lift car between the floors: neither floor draws them. */
  readonly isRiding?: true
  /** One of the building crew: no dot, no ring, no selection, left out of Tab and the text twin. */
  readonly isCrew?: true
}

export type ActorStatus = 'free' | 'waiting' | 'failed'

/** A sheet flying between two people, or to the tray: `k` is how far it has come (0 to 1) at the
 *  last sim step, `prevK` at the one before. */
export interface PaperView {
  readonly floor: FloorId
  readonly from: Point
  readonly to: Point
  readonly prevK: number
  readonly k: number
}

/** The light the office keeps: the sun and the cloud cover, or the sun held at solar noon under a
 *  clear sky when the light does not follow the hour. */
export interface LightView {
  readonly sun: SunView
  readonly cloud: number
  readonly followsHour: boolean
}

/** What the props show: the rooms whose lamp is on, how far their lamps glow (1 untouched, less
 *  over the lunch nap), and whether the home market is shut for the day. */
interface PropsView {
  readonly lit: ReadonlySet<RoomId>
  readonly lampGlow: number
  readonly isClosed: boolean
}

export type PetKind = 'cat' | 'corgi'
export type PetPose = 'sleep' | 'sit' | 'walk' | 'stand' | 'lie'

/** A pet as the renderers draw it: `prev` and `at` its feet at the last two sim steps, `lift` how
 *  far above the floor (a perch, a jump), `isFlipped` facing left. */
export interface PetView {
  readonly kind: PetKind
  readonly prev: Point
  readonly at: Point
  readonly lift: number
  readonly pose: PetPose
  readonly isFlipped: boolean
}

/** One fish in the tank: how far along its sweep (0 to 1), its height in the water (0 to 1), and
 *  which way it swims. */
export interface FishView {
  readonly k: number
  readonly depth: number
  readonly isFlipped: boolean
}

/** What a scheduled or real moment says over a person: its label, the room a round just
 *  checked, the job about to run, or a line of small talk (a catalog `key`, under its `topic`). */
export type LifeLine =
  | {
      readonly actor: ActorId
      readonly label: 'lunch' | 'coffee' | 'friday' | 'standup' | 'chat' | 'rounds'
    }
  | { readonly actor: ActorId; readonly label: 'roundCheck'; readonly room: RoomId }
  | { readonly actor: ActorId; readonly label: 'due'; readonly time: string; readonly what: string }
  | { readonly actor: ActorId; readonly label: 'earnings' | 'expiry' }
  | {
      readonly actor: ActorId
      readonly label: 'closingAuction'
      readonly from: string
      readonly to: string
    }
  | { readonly actor: ActorId; readonly label: 'drop'; readonly index: string }
  | { readonly actor: ActorId; readonly label: 'exDividend'; readonly ticker: string }
  | { readonly actor: ActorId; readonly label: 'overtime'; readonly what: string }
  | {
      readonly actor: ActorId
      readonly label: 'talk'
      readonly key: MessageKey
      readonly topic: 'chat' | 'lunch' | 'friday'
    }

/** Steam over a pantry mug, or bubbles in a water cooler, at the top of that prop. */
export interface SteamView {
  readonly floor: FloorId
  readonly kind: 'mug' | 'cooler'
  readonly at: Point
}

/** What the office life shows besides its people's goals: the lobby pets and the fish, the
 *  dessert cart, the printer's stack (`feedAt` when its newest sheet came out, a
 *  `performance.now()` instant), steam and bubbles, a quiet office's sleeping screens, and the
 *  lines its moments say. */
export interface LifeView {
  readonly pets: readonly PetView[]
  readonly fish: readonly FishView[]
  readonly cart?: { readonly floor: FloorId; readonly at: Point }
  readonly sheets: number
  readonly feedAt?: number
  readonly steam: readonly SteamView[]
  readonly isQuiet: boolean
  readonly lines: readonly LifeLine[]
  /** The floors where steam rises or a fish swims: small motion there draws at the capped rate. */
  readonly animatedFloors: readonly FloorId[]
  readonly deskItems: DeskItemsView
  /** The rooms someone really stands in: after hours or on a rest day only these keep a lamp lit. */
  readonly occupied: ReadonlySet<RoomId>
  /** Where the cleaner's wet-floor sign stands, with the bucket beside it, while she mops. */
  readonly wetSign?: Point
}

/** A desk screen while its owner does not work: dark with the owner away or the office quiet, a
 *  screensaver at an empty desk, the home index live in session, grey at the break or the close. */
export type MonitorState = 'off' | 'saver' | 'live' | 'rest'

/** Where the home market's day stands for the desk screens. */
export type DeskSession = 'open' | 'break' | 'closed'

/** The cups and sheets a desk shows, each within its slots. */
interface DeskMess {
  readonly cups: number
  readonly sheets: number
}

/** The home index on the live monitors: its name, the levels polled since the page opened, the
 *  previous close they are drawn against and the move as the wire gave it. */
export interface DeskTrace {
  readonly label: string
  readonly line: readonly number[]
  readonly close: number
  readonly changePct: number
}

/** What the desks show of the day's work; `signature` moves only when something drawn changed. */
export interface DeskItemsView {
  readonly mess: ReadonlyMap<ActorId, DeskMess>
  /** Each desk owner's screens; absent while the owner works, where the work screen shows. */
  readonly monitors: ReadonlyMap<ActorId, MonitorState>
  readonly session: DeskSession
  /** The home index's day: absent while its move is absent or its read is stale, so the live
   *  monitors then show no line. */
  readonly trace: DeskTrace | undefined
  /** A fired price alert is unread: the alert desk's lamp glows amber. */
  readonly isAlertOn: boolean
  readonly saverStep: number
  readonly signature: number
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
  readonly childrenOpen: number
  readonly childrenBack: number
}

/** A temporary child agent: the role its parent gave it, and the parent it works for. */
export interface ChildView {
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
  | { readonly kind: 'child-end'; readonly outcome: string }
  | { readonly kind: 'children-folding'; readonly partial: number; readonly stopped: number }
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

/** The calendar on the desk at `slot`: a month page with the held name's ex-dividend `day`
 *  (`YYYY-MM-DD`) circled. */
export interface CalendarView {
  readonly slot: number
  readonly day: string
}

/** The team floor's own state: its desks, its children, threads, scored bursts and lines. */
export interface TeamView {
  readonly calendar?: CalendarView
  readonly desks: readonly DeskView[]
  readonly children: readonly ChildView[]
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
  readonly weather: WeatherFxView
  readonly life: LifeView
  readonly team: TeamView
  readonly street: StreetFrame
  readonly lift: LiftView
}

/** The one lift car: the floor it is at (the far one from halfway through a ride), how far its
 *  doors stand open there (0 shut, 1 open), and the floors whose call button is lit. */
export interface LiftView {
  readonly floor: FloorId
  readonly doors: number
  readonly called: readonly FloorId[]
}
