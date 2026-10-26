import type { MessageKey } from '@/i18n'
import type { ActorId, Point } from '@/web/scene/types'
import { VN_PACK } from '@/web/scene/world/regions/vn'

type RegionPackId = 'vn'

/** From one minute of the page day to another, the end excluded. */
export type MinuteRange = readonly [number, number]

/** Windows of the page day, for a time that comes twice a day or wraps midnight. */
export type MinuteRanges = readonly MinuteRange[]

/** From one calendar day to another, both included, as `YYYY-MM-DD`. */
export type DayRange = readonly [string, string]

/** Days of one month, both ends included, that come back every year. */
export interface MonthDayRange {
  readonly month: number
  readonly from: number
  readonly to: number
}

/** The office's own day, in minutes of the page day: the lunch nap, the afternoon coffee, the
 *  mid-afternoon stretch, the dessert cart (`dow` 0 for Sunday, staying `stayMin`), when people
 *  `arrive` and `leave` (each person draws its own minute), the first `noTripsAfterOpenMin`
 *  after the market opens, and when the after-close mood ends (`relaxedUntil`). */
export interface OfficeLife {
  readonly nap: MinuteRange
  readonly coffee: MinuteRange
  readonly yawn: MinuteRange
  readonly dessert: { readonly dow: number; readonly at: number; readonly stayMin: number }
  readonly arrive: MinuteRange
  readonly leave: MinuteRange
  readonly noTripsAfterOpenMin: number
  readonly relaxedUntil: number
}

/** `oneWay`: every lane runs the same way; `lanes` counts both directions. */
export interface SideStreet {
  readonly lanes: number
  readonly oneWay: boolean
}

/** The main road along the office, and the side streets that meet it. `turnSign`: the blue plate
 *  that lets two-wheelers turn right on red. */
export interface RoadLayout {
  readonly north: {
    readonly carriageways: 1 | 2
    readonly lanesEach: number
    readonly oneWay: boolean
    readonly median: boolean
  }
  readonly west: SideStreet
  readonly east: SideStreet
  readonly turnSign: boolean
}

/** A street name plate: colours, the inset frame, the street word over the name (`caps`: sign
 *  letters in capitals) and the plate's width to height. */
export interface PlateStyle {
  readonly background: string
  readonly ink: string
  readonly frame: boolean
  readonly streetWord: boolean
  readonly caps: boolean
  readonly ratio: readonly [number, number]
}

/** A bus stop, named as the city names it, with the two routes it shows. */
export interface BusStop {
  readonly name: string
  readonly routes: readonly [string, string]
  readonly side: 'far' | 'near'
}

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

/** One front of the block face, in street order, left to right. Open `hours` (a closed `shutter`
 *  is `[0, 0]`, a day and night one runs the whole day); `item`, when set, is what an errand
 *  there brings back. */
export interface ShopRow {
  readonly kind: ShopKind
  readonly frontageM: number
  readonly hours: MinuteRange
  readonly item?: 'cup' | 'bag' | 'box'
}

export type BikeShape = 'step-through' | 'scooter' | 'maxi' | 'sport'

export type CarSize = 'small' | 'mid' | 'large'

/** The traffic, as shares (each group sums to one): vehicles by kind, motorbikes by shape, cars
 *  by size, and the share of cars that are taxis; plain body colours, no brand. */
export interface VehicleMix {
  readonly kinds: { readonly motorbike: number; readonly car: number; readonly bus: number }
  readonly bikeShapes: Readonly<Record<BikeShape, number>>
  readonly carSizes: Readonly<Record<CarSize, number>>
  readonly taxiShare: number
  readonly colours: {
    readonly car: readonly string[]
    readonly taxi: string
    readonly bus: readonly string[]
    readonly truck: string
  }
}

export type VendorId = 'pho' | 'tea' | 'banh-mi' | 'flower-bike' | 'evening-stools'

export type HolidayId = 'tet' | 'trung-thu' | 'quoc-khanh' | 'noel'

export type ChatterId = 'honk' | 'eh' | 'hello' | 'hey'

/** The catalog keys of the words the delivery box, the taxi roof and the sanitation truck show. */
export interface StreetWords {
  readonly delivery: MessageKey
  readonly taxi: MessageKey
  readonly truck: MessageKey
}

/** Every window of the page day the street and the building crew keep to. `night` and
 *  `dayEdges` are the traffic's low and half-busy stretches; `quiet` is its lull in the day. */
export interface StreetHours {
  readonly rush: MinuteRanges
  readonly quiet: MinuteRanges
  readonly night: MinuteRanges
  readonly dayEdges: MinuteRanges
  readonly school: MinuteRanges
  readonly deliveries: MinuteRanges
  readonly sweeper: MinuteRanges
  readonly garbage: MinuteRanges
  readonly cafe: MinuteRanges
  readonly doorWalks: MinuteRanges
  readonly parks: {
    readonly open: MinuteRanges
    readonly joggers: MinuteRanges
    readonly gymPeak: MinuteRanges
    readonly taiChi: MinuteRanges
    readonly playground: MinuteRanges
    readonly playgroundPeak: MinuteRanges
  }
  readonly vendors: Readonly<Record<VendorId, MinuteRanges>>
  readonly crew: {
    readonly receptionist: MinuteRanges
    readonly cleaner: MinuteRanges
    readonly nightRounds: MinuteRanges
  }
}

/** Where a region's tower foot stands in the street canvas, its scale about the foot and how
 *  hazed it is. */
export interface Landmark {
  readonly shape: 'bitexco'
  readonly foot: Point
  readonly scale: number
  readonly haze: number
}

/** What the office knows of the city around it, keyed by the home region. Proper names (the
 *  street, stops, routes, park) are written here, untranslated; every generic word is a catalog
 *  key. `street` is the one named main street; `park` is the proper name only. */
export interface RegionPack {
  readonly id: RegionPackId
  readonly city: string
  readonly geo: { readonly lat: number; readonly lon: number }
  readonly road: RoadLayout
  readonly street: string
  readonly park: string
  readonly plate: PlateStyle
  readonly speed: { readonly north: number; readonly side: number }
  readonly stops: readonly BusStop[]
  readonly shops: readonly ShopRow[]
  readonly vehicles: VehicleMix
  /** The hours (page clock) the office's people walk errands for you, and the office is open. */
  readonly officeHours: MinuteRange
  readonly officeLife: OfficeLife
  readonly hours: StreetHours
  readonly holidayDates: Readonly<Record<HolidayId, readonly DayRange[]>>
  readonly vendors: readonly VendorId[]
  readonly chatter: readonly ChatterId[]
  readonly words: StreetWords
  readonly landmark: Landmark
  readonly earningsSeasons: readonly MonthDayRange[]
  readonly expiryRule: 'third-thursday'
  /** The people who are in on a day the market is shut (alerts and chat run every day). */
  readonly restDayStaff: readonly ActorId[]
}

const DEFAULT_PACK: RegionPackId = 'vn'
const REGION_PACKS: Readonly<Record<RegionPackId, RegionPack>> = Object.freeze({
  vn: VN_PACK,
} satisfies Record<RegionPackId, RegionPack>)

/** The pack keyed by `homeRegion`, else the default one. */
export function packOf(homeRegion: string | undefined): RegionPack {
  return REGION_PACKS[homeRegion !== undefined && isPackId(homeRegion) ? homeRegion : DEFAULT_PACK]
}

export function isInRange(minute: number, range: MinuteRange): boolean {
  return minute >= range[0] && minute < range[1]
}

function isPackId(region: string): region is RegionPackId {
  return Object.hasOwn(REGION_PACKS, region)
}
