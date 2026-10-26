import type { MessageKey } from '@/i18n'
import type { BikeShape, CarSize, ChatterId, ErrandItem, ShopKind } from '@/web/scene/street-types'
import { type ActorId, type Point, WORLD } from '@/web/scene/types'
import { VN_PACK } from '@/web/scene/world/regions/vn'
import { METRES_PER_PX, NORTH } from '@/web/scene/world/street-layout'
import { MINUTES_PER_DAY } from '@/web/text/time-units'

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

/** The main road along the office, and the side streets that meet it. `north.oneWay`: the whole
 *  road runs one way (false: it carries both ways, one `carriageways` each, split by the median);
 *  `turnSign`: the blue plate that lets two-wheelers turn right on red; `habits`: motorbikes slip
 *  between the cars, bunch ahead of them at a red light and leave first, the rush hours jam, and
 *  an attendant parks motorbikes in rows in front of the frontage building. */
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
  readonly habits: boolean
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

/** One front of the block face, in street order, left to right. Open `hours`: a closed `shutter`
 *  is `[0, 0]`; a day and night shop is `[0, 1440]`, so it never closes when `hours[0] === 0 &&
 *  hours[1] >= 1440` (`hours[1] >= 1440` alone would also match a shop that closes at midnight).
 *  `item`, when set, is what an errand there brings back. */
export interface ShopRow {
  readonly kind: ShopKind
  readonly frontageM: number
  readonly hours: MinuteRange
  readonly item?: ErrandItem
}

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

/** `pho`, `tea` and `banhMi` name their sign word: `ui.office.street.vendor.<id>`. */
export type VendorId = 'pho' | 'tea' | 'banhMi' | 'flowerBike' | 'eveningStools'

export type HolidayId = 'tet' | 'trung-thu' | 'quoc-khanh' | 'noel'

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
  /** After the last shop closes until before dawn: the late stall stands and the guard walks the
   *  frontage. */
  readonly late: MinuteRanges
  /** The tower's and the frontage's night lights are out. */
  readonly lightsOut: MinuteRanges
  /** Someone may step out onto a lit balcony. */
  readonly balconies: MinuteRanges
  /** The frontage's lobby glass may be lit after dusk. */
  readonly shopsLit: MinuteRanges
  /** The share of a building's windows lit through the day: minute of the day and share, linear
   *  between two points, first at 0 and last at the day's end. */
  readonly windowsLit: readonly (readonly [number, number])[]
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
  readonly shape: 'tower'
  readonly foot: Point
  readonly scale: number
  readonly haze: number
}

/** What the office knows of the city around it, keyed by the home region. Proper names (the
 *  street, stops, routes, park) are written here, untranslated; every generic word is a catalog
 *  key. `street` is the main street; `sideStreets` name the two that run down the building's sides;
 *  `park` is the proper name only. */
export interface RegionPack {
  readonly id: RegionPackId
  readonly city: string
  readonly geo: { readonly lat: number; readonly lon: number }
  readonly road: RoadLayout
  readonly street: string
  readonly sideStreets: { readonly west: string; readonly east: string }
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

/** What sets a day apart: a report season, the derivatives' expiry, a festive stretch. */
export type SpecialDay = 'earnings' | 'expiry' | 'festive'

const DEFAULT_PACK: RegionPackId = 'vn'
const THURSDAY = 4
// The third Thursday of a month is always one of these dates.
const THIRD_WEEK = Object.freeze({ from: 15, to: 21 })
const HOLIDAYS: readonly HolidayId[] = ['tet', 'trung-thu', 'quoc-khanh', 'noel']
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

/** The minute of the day falls in one of `ranges`. */
export function isWithin(ranges: MinuteRanges, minute: number): boolean {
  const at = minute % MINUTES_PER_DAY

  for (const range of ranges) {
    if (isInRange(at, range)) {
      return true
    }
  }

  return false
}

/** The door of `shops[index]` on the far pavement: the row runs left to right with its lobby
 *  centred on the office (the whole row centred when it has none). */
export function shopDoorOf(shops: readonly ShopRow[], index: number): Point {
  const lobby = shops.findIndex((row) => row.kind === 'lobby')
  const metresTo = (end: number): number =>
    shops.slice(0, end).reduce((sum, row) => sum + row.frontageM, 0)
  const centreM =
    lobby < 0 ? metresTo(shops.length) / 2 : metresTo(lobby) + (shops[lobby]?.frontageM ?? 0) / 2
  const doorM = metresTo(index) + (shops[index]?.frontageM ?? 0) / 2

  return { x: WORLD.w / 2 + (doorM - centreM) / METRES_PER_PX, y: NORTH.farTop }
}

/** The shop serves at `minute` of the page day: a day and night shop always, a shutter never. */
export function isShopOpen(row: ShopRow, minute: number): boolean {
  return isAllDay(row) || isInRange(minute, row.hours)
}

/** The shop never closes: it opens at midnight and runs to the next midnight. */
export function isAllDay(row: ShopRow): boolean {
  return row.hours[0] === 0 && row.hours[1] >= MINUTES_PER_DAY
}

/** The holiday `day` (`YYYY-MM-DD`) falls in, by the pack's dates; the first match wins. */
export function holidayOf(pack: RegionPack, day: string): HolidayId | undefined {
  return HOLIDAYS.find((id) => pack.holidayDates[id].some(([from, to]) => day >= from && day <= to))
}

/** What sets `day` (`YYYY-MM-DD`) apart by the pack: a report season and the expiry only on a day
 *  the market trades (`tradesToday`), a festive stretch whatever the market does. */
export function specialDaysOf(
  day: string,
  pack: RegionPack,
  tradesToday: boolean
): readonly SpecialDay[] {
  const [, month, date] = day.split('-').map(Number)
  const isSeason = pack.earningsSeasons.some(
    (season) => season.month === month && (date ?? 0) >= season.from && (date ?? 0) <= season.to
  )
  const isExpiry =
    pack.expiryRule === 'third-thursday' &&
    new Date(`${day}T00:00:00Z`).getUTCDay() === THURSDAY &&
    (date ?? 0) >= THIRD_WEEK.from &&
    (date ?? 0) <= THIRD_WEEK.to

  return [
    ...(tradesToday && isSeason ? (['earnings'] as const) : []),
    ...(tradesToday && isExpiry ? (['expiry'] as const) : []),
    ...(holidayOf(pack, day) === undefined ? [] : (['festive'] as const)),
  ]
}

function isPackId(region: string): region is RegionPackId {
  return Object.hasOwn(REGION_PACKS, region)
}
