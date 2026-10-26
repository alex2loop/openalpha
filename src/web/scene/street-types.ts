import type { AgentLookWire } from '@/app/server/wire/agents'
import type { WeatherFxView } from '@/web/scene/sky-types'
import type { ActorId, Point, Rect, RoleId } from '@/web/scene/types'

/** One moving thing of the street: `prev` and `at` its place at the last two sim steps. */
interface StreetEntity {
  readonly prev: Point
  readonly at: Point
}

export const BIKE_SHAPES = ['step-through', 'scooter', 'maxi', 'sport'] as const
export type BikeShape = (typeof BIKE_SHAPES)[number]

export const CAR_SIZES = ['small', 'mid', 'large'] as const
export type CarSize = (typeof CAR_SIZES)[number]

export const CHATTER_IDS = ['honk', 'eh', 'hello', 'hey'] as const
export type ChatterId = (typeof CHATTER_IDS)[number]

export const VEHICLE_KINDS = [
  'car',
  'taxi',
  'bus',
  'motorbike',
  'delivery',
  'school',
  'sweeper',
  'garbage',
] as const
export type VehicleKind = (typeof VEHICLE_KINDS)[number]

export const HEADINGS = ['east', 'west', 'north', 'south'] as const
export type Heading = (typeof HEADINGS)[number]

export type ShopKind =
  | 'cafe'
  | 'store'
  | 'pharmacy'
  | 'food'
  | 'bank'
  | 'lobby'
  | 'alley'
  | 'shutter'
  | 'fence'

/** The shops an errand goes to. */
export const ERRAND_SHOPS = ['cafe', 'store', 'pharmacy', 'food'] as const
export type ErrandShop = (typeof ERRAND_SHOPS)[number]

/** What a shop hands over: a drink, a bag of things, a takeaway box. */
export const ERRAND_ITEMS = ['cup', 'bag', 'box'] as const
export type ErrandItem = (typeof ERRAND_ITEMS)[number]

/** Where an office person's errand stands: on the way, in the queue, at the counter, back. `isOut`
 *  once past the street door, where the street draws them and the floor does not. */
export interface ErrandView {
  readonly stage: 'going' | 'queue' | 'buying' | 'back'
  readonly shop: ErrandShop
  readonly item?: ErrandItem
  readonly isOut: boolean
}

/** Who walks the street: a passer-by, a jogger, a pupil, someone waiting at a shelter, sitting at
 *  the café, taking a delivery at a shop door, or an office person on an errand. */
export const PERSON_KINDS = [
  'walker',
  'jogger',
  'pupil',
  'waiter',
  'sitter',
  'receiver',
  'staff',
] as const
export type PersonKind = (typeof PERSON_KINDS)[number]

/** How many umbrella canopies the street has to open. */
export const UMBRELLA_LOOKS = 4

/** A person on the street stands this many world px tall, feet to the top of the head. */
export const STREET_FIGURE_H = 5

/** The office person an errand takes outside, drawn in their own clothes. */
export interface StaffLook {
  readonly id: ActorId
  readonly role?: RoleId
  readonly look?: AgentLookWire
}

/** The first of a street person's two waving gait frames. */
export const WAVE_FRAME = 5

/** A person on the street: who, which way they face, the gait frame (0 standing, 1 to 4 walking,
 *  5 and 6 waving), the seed their clothes come from, what they carry, and the office person's own
 *  look when on an errand. */
export interface PersonView extends StreetEntity {
  readonly kind: PersonKind
  readonly facing: Heading
  readonly frame: number
  readonly look: number
  readonly item: ErrandItem | undefined
  readonly staff: StaffLook | undefined
  /** An open umbrella's tone, 1 up; 0 for none. */
  readonly umbrella: number
  /** 0 bare-headed, 1 a conical hat, 2 a cap. */
  readonly hat: number
}

/** A rider's clothes: plain, a sun coat with a mask, or a plain ride-hailing jacket. */
export const RIDER_GEARS = ['plain', 'sunCoat', 'rideHailing'] as const
export type RiderGear = (typeof RIDER_GEARS)[number]

/** A vehicle on the street: its kind and heading, the car's size and the motorbike's shape (each
 *  read by its own kind), the rider's gear and passenger, the seed its colours come from, the
 *  route a bus shows, and a stopped two-wheeler's foot down. */
export interface VehicleView extends StreetEntity {
  readonly kind: VehicleKind
  readonly heading: Heading
  readonly car: CarSize
  readonly bike: BikeShape
  readonly gear: RiderGear
  readonly passenger: boolean
  readonly look: number
  readonly route: string
  readonly footDown: boolean
}

/** The north street's heads, the side streets' heads at both junctions, and the crossing's. */
export type SignalHeadId = 'north' | 'side' | 'walk'

export type SignalLamp = 'green' | 'amber' | 'red' | 'walk' | 'flash'

/** A signal head standing on the street: which phase it follows, a car head or a walk head, and
 *  its foot. */
export interface SignalHeadView {
  readonly head: SignalHeadId
  readonly kind: 'car' | 'walk'
  readonly at: Point
}

/** What a head shows: its lamp and the whole seconds left on it. */
export interface SignalState {
  readonly lamp: SignalLamp
  readonly seconds: number
}

/** A word said on the street, over whoever says it. */
export interface StreetSayView {
  readonly at: Point
  readonly chatter: ChatterId
}

/** The motorbike lot in front of the frontage building: its slots, how many of the first ones
 *  hold a bike, and the attendant while on duty, `handing` a ticket. */
interface LotView {
  readonly slots: readonly Point[]
  readonly parked: number
  readonly attendant: (StreetEntity & { readonly handing: boolean }) | undefined
}

/** A shop whose roller shutter is moving: its place in the pack's row, and how far down the
 *  shutter is (0 up, 1 down). */
export interface ShutterView {
  readonly shop: number
  readonly drop: number
}

/** The LED board's clock: which panel shows, how far the ticker band has scrolled (px) and the
 *  hourly light pulse (0 none, 1 full). */
export interface BoardView {
  readonly panel: number
  readonly scrollPx: number
  readonly pulse: number
}

/** The street's animals: kerb pigeons, sparrows from the far trees, the stray cat on the park wall
 *  and the dog on its walk. */
export const CRITTER_KINDS = ['pigeon', 'sparrow', 'cat', 'dog'] as const
export type CritterKind = (typeof CRITTER_KINDS)[number]

export const CRITTER_POSES = ['stand', 'walk', 'peck', 'fly', 'sit', 'groom', 'sniff'] as const
export type CritterPose = (typeof CRITTER_POSES)[number]

/** An animal on the street: `at` on the ground (a bird in a tree or the air is drawn `lift` px
 *  above it), its pose and frame, which way it faces, and the walker's hand a dog's lead runs to. */
export interface CritterView extends StreetEntity {
  readonly kind: CritterKind
  readonly pose: CritterPose
  readonly frame: number
  readonly facing: -1 | 1
  readonly lift: number
  readonly lead: Point | undefined
}

/** The pavement's vendors as they move: the flower bicycle while it rides (`frame` turns the
 *  pedal), and the pot whose steam rises at `steam` (0 to 1 of a puff's climb) while it cooks. */
export interface VendorView {
  readonly bike: (StreetEntity & { readonly facing: -1 | 1; readonly frame: number }) | undefined
  readonly pot: Point | undefined
  readonly steam: number
}

/** The shop row and the frontage building: shutters on the move, the guard walking the frontage
 *  after the shops close, the board's clock, and the rects the shop row and the board with its band
 *  cover (absent without a frontage). */
export interface FrontView {
  readonly shutters: readonly ShutterView[]
  readonly guard: (StreetEntity & { readonly heading: -1 | 1 }) | undefined
  readonly board: BoardView
  readonly row: Rect | undefined
  readonly face: Rect | undefined
}

/** The street sim's snapshot the painter reads: `step` moves whenever its pools did, so the
 *  moving layer is redrawn only then. Vehicles come north to south, in draw order. */
export interface StreetView {
  readonly step: number
  readonly pools: {
    readonly vehicles: readonly VehicleView[]
    readonly people: readonly PersonView[]
    readonly critters: readonly CritterView[]
  }
  readonly signals: Readonly<Record<SignalHeadId, SignalState>>
  readonly heads: readonly SignalHeadView[]
  readonly says: readonly StreetSayView[]
  readonly lot: LotView
  readonly front: FrontView
  readonly vendors: VendorView
  readonly weather: WeatherFxView
}

/** The street as painted for both renderers: the static canvas over `STREET_RECT` and the moving
 *  canvas over `movingRect` (zero-sized while nothing moves); a version moves with each repaint of
 *  its canvas, so a renderer uploads or blits only a changed one. */
export interface StreetFrame {
  readonly staticCanvas: HTMLCanvasElement
  readonly movingCanvas: HTMLCanvasElement
  readonly movingRect: Rect
  readonly staticVersion: number
  readonly movingVersion: number
}
