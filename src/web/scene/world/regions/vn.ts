import type { DayRange, MinuteRange, RegionPack } from '@/web/scene/world/regions'
import { HOURS_PER_DAY, MINUTES_PER_HOUR, shiftDay } from '@/web/text/time-units'

const FESTIVE_FIRST_YEAR = 2026
const FESTIVE_LAST_YEAR = 2035
// The day of the lunar new year and of the 15th of the eighth lunar month, one per year.
const TET_DAYS = [
  '2026-02-17',
  '2027-02-06',
  '2028-01-26',
  '2029-02-13',
  '2030-02-03',
  '2031-01-23',
  '2032-02-11',
  '2033-01-31',
  '2034-02-19',
  '2035-02-08',
]
const MID_AUTUMN_DAYS = [
  '2026-09-25',
  '2027-09-15',
  '2028-10-03',
  '2029-09-22',
  '2030-09-12',
  '2031-10-01',
  '2032-09-19',
  '2033-09-08',
  '2034-09-27',
  '2035-09-16',
]
const FESTIVE_YEARS = Array.from(
  { length: FESTIVE_LAST_YEAR - FESTIVE_FIRST_YEAR + 1 },
  (_, index) => FESTIVE_FIRST_YEAR + index
)
const TET_DAYS_BEFORE = 14
const TET_DAYS_AFTER = 7
const MID_AUTUMN_DAYS_BEFORE = 12
const MID_AUTUMN_DAYS_AFTER = 1

const hm = (hours: number, minutes = 0): number => hours * MINUTES_PER_HOUR + minutes
const around = (day: string, daysBefore: number, daysAfter: number): DayRange => [
  shiftDay(day, -daysBefore),
  shiftDay(day, daysAfter),
]

const ALL_DAY: MinuteRange = [0, hm(HOURS_PER_DAY)]
const SHUT: MinuteRange = [0, 0]

/** The Vietnam pack: Ho Chi Minh City's financial district, and the office's own day. */
export const VN_PACK = Object.freeze({
  id: 'vn',
  city: 'TP. Hồ Chí Minh',
  geo: { lat: 10.7716, lon: 106.7044 },
  road: {
    north: { carriageways: 2, lanesEach: 2, oneWay: false, median: true },
    west: { lanes: 2, oneWay: false },
    east: { lanes: 2, oneWay: false },
    turnSign: true,
    habits: true,
  },
  street: 'Hàm Nghi',
  park: 'Bến Bạch Đằng',
  plate: {
    background: '#1B3F8F',
    ink: '#FFFFFF',
    frame: true,
    streetWord: true,
    caps: true,
    ratio: [75, 40],
  },
  speed: { north: 60, side: 50 },
  stops: [
    { name: 'Tháp Tài chính', routes: ['03', '19'], side: 'far' },
    { name: 'Hồ Tùng Mậu', routes: ['45', '56'], side: 'far' },
    { name: 'Giao lộ Hàm Nghi - Tôn Thất Đạm', routes: ['01', '52'], side: 'far' },
    { name: 'Bến Bạch Đằng', routes: ['88', '93'], side: 'near' },
    { name: 'Chợ Cũ', routes: ['36', '152'], side: 'near' },
  ],
  shops: [
    { kind: 'bank', frontageM: 6, hours: [hm(7, 30), hm(17)] },
    { kind: 'cafe', frontageM: 5, hours: [hm(6), hm(21)], item: 'cup' },
    { kind: 'food', frontageM: 5, hours: [hm(6, 30), hm(22)], item: 'box' },
    { kind: 'food', frontageM: 5, hours: [hm(6), hm(22)], item: 'box' },
    { kind: 'cafe', frontageM: 7, hours: [hm(7), hm(22)], item: 'cup' },
    { kind: 'store', frontageM: 5, hours: ALL_DAY, item: 'bag' },
    { kind: 'pharmacy', frontageM: 5, hours: [hm(7), hm(21, 30)], item: 'bag' },
    { kind: 'food', frontageM: 4.5, hours: [hm(6), hm(22)], item: 'box' },
    { kind: 'food', frontageM: 4.5, hours: [hm(5, 30), hm(21, 30)], item: 'bag' },
    { kind: 'cafe', frontageM: 4.5, hours: [hm(10), hm(22)], item: 'cup' },
    { kind: 'shutter', frontageM: 4, hours: SHUT },
    { kind: 'lobby', frontageM: 61, hours: ALL_DAY },
    { kind: 'bank', frontageM: 6, hours: [hm(7, 30), hm(17)] },
    { kind: 'shutter', frontageM: 5, hours: SHUT },
    { kind: 'shutter', frontageM: 6, hours: SHUT },
    { kind: 'alley', frontageM: 3, hours: ALL_DAY },
    { kind: 'cafe', frontageM: 7, hours: [hm(7), hm(22)], item: 'cup' },
    { kind: 'cafe', frontageM: 7, hours: [hm(7), hm(22)], item: 'cup' },
    { kind: 'food', frontageM: 6, hours: [hm(9), hm(22)], item: 'bag' },
    { kind: 'food', frontageM: 5, hours: [hm(6, 30), hm(21, 30)], item: 'box' },
    { kind: 'store', frontageM: 4, hours: [hm(6), hm(21, 30)], item: 'bag' },
    { kind: 'food', frontageM: 4.5, hours: [hm(7), hm(21)], item: 'box' },
  ],
  vehicles: {
    kinds: { motorbike: 0.6, car: 0.3, bus: 0.1 },
    bikeShapes: { 'step-through': 0.3, scooter: 0.34, maxi: 0.16, sport: 0.2 },
    carSizes: { small: 0.2, mid: 0.6, large: 0.2 },
    taxiShare: 0.2,
    colours: {
      car: ['#8FA3B8', '#B8A58F', '#9DB59A', '#B59AA6', '#A7A7B5', '#C9C4B8', '#7E8FA6'],
      taxi: '#EDEEE8',
      bus: ['#6D9BB5', '#E3C14A'],
      truck: '#3F8A5C',
    },
  },
  officeHours: [hm(7), hm(21)],
  officeLife: {
    nap: [hm(12), hm(13)],
    coffee: [hm(13), hm(13, 30)],
    yawn: [hm(15), hm(15, 15)],
    dessert: { dow: 5, at: hm(16), stayMin: 10 },
    arrive: [hm(7), hm(8, 15)],
    leave: [hm(17), hm(19)],
    noTripsAfterOpenMin: 15,
    relaxedUntil: hm(18),
  },
  hours: {
    rush: [
      [hm(7), hm(9)],
      [hm(17), hm(19)],
    ],
    quiet: [[hm(12, 30), hm(13, 30)]],
    night: [
      [hm(21), hm(HOURS_PER_DAY)],
      [0, hm(5, 30)],
    ],
    dayEdges: [
      [hm(5, 30), hm(7)],
      [hm(19), hm(21)],
    ],
    school: [
      [hm(10, 55), hm(11, 20)],
      [hm(16, 25), hm(16, 55)],
    ],
    deliveries: [
      [hm(10, 30), hm(13, 30)],
      [hm(17, 30), hm(20, 30)],
    ],
    sweeper: [[hm(5), hm(8)]],
    garbage: [
      [hm(5), hm(6)],
      [hm(22, 30), hm(HOURS_PER_DAY)],
      [0, hm(1)],
    ],
    cafe: [
      [hm(6, 30), hm(10, 30)],
      [hm(14), hm(17, 30)],
    ],
    doorWalks: [[hm(6), hm(22)]],
    late: [
      [hm(22), hm(HOURS_PER_DAY)],
      [0, hm(5)],
    ],
    lightsOut: [
      [hm(23, 30), hm(HOURS_PER_DAY)],
      [0, hm(5)],
    ],
    balconies: [[hm(18), hm(23)]],
    shopsLit: [[0, hm(21, 30)]],
    windowsLit: [
      [0, 0.12],
      [hm(2), 0.08],
      [hm(5, 30), 0],
      [hm(17), 0],
      [hm(18, 30), 0.6],
      [hm(19, 30), 0.6],
      [hm(21, 30), 0.3],
      [hm(23), 0.18],
      [hm(HOURS_PER_DAY), 0.12],
    ],
    parks: {
      open: [[hm(5, 30), hm(21, 30)]],
      joggers: [
        [hm(6), hm(7, 30)],
        [hm(17), hm(18, 30)],
      ],
      gymPeak: [
        [hm(5, 30), hm(7, 30)],
        [hm(17), hm(19)],
      ],
      taiChi: [[hm(5, 30), hm(7)]],
      playground: [[hm(11), hm(19)]],
      playgroundPeak: [[hm(16, 40), hm(19)]],
    },
    vendors: {
      pho: [[hm(6), hm(8, 30)]],
      tea: [[hm(7), hm(22)]],
      banhMi: [
        [hm(6), hm(8)],
        [hm(11, 30), hm(13)],
        [hm(17), hm(19)],
      ],
      flowerBike: [[hm(6), hm(9, 30)]],
      eveningStools: [[hm(17, 30), hm(23)]],
    },
    crew: {
      receptionist: [[hm(8), hm(18)]],
      cleaner: [[hm(16, 30), hm(18)]],
      nightRounds: [
        [hm(19), hm(HOURS_PER_DAY)],
        [0, hm(6)],
      ],
    },
  },
  holidayDates: {
    tet: TET_DAYS.map((day) => around(day, TET_DAYS_BEFORE, TET_DAYS_AFTER)),
    'trung-thu': MID_AUTUMN_DAYS.map((day) =>
      around(day, MID_AUTUMN_DAYS_BEFORE, MID_AUTUMN_DAYS_AFTER)
    ),
    'quoc-khanh': FESTIVE_YEARS.map((year): DayRange => [`${year}-08-28`, `${year}-09-03`]),
    noel: FESTIVE_YEARS.map((year): DayRange => [`${year}-12-10`, `${year}-12-26`]),
  },
  vendors: ['pho', 'tea', 'banhMi', 'flowerBike', 'eveningStools'],
  chatter: ['honk', 'eh', 'hello', 'hey'],
  words: {
    delivery: 'ui.office.street.delivery',
    taxi: 'ui.office.street.taxi',
    truck: 'ui.office.street.truck',
  },
  landmark: { shape: 'tower', foot: { x: 84, y: -72 }, scale: 0.5, haze: 0.3 },
  earningsSeasons: [
    { month: 1, from: 10, to: 30 },
    { month: 4, from: 10, to: 30 },
    { month: 7, from: 10, to: 30 },
    { month: 10, from: 10, to: 30 },
  ],
  expiryRule: 'third-thursday',
  restDayStaff: ['clerk', 'assistant'],
} as const satisfies RegionPack)
