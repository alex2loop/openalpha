import type { DayRange, RegionPack } from '@/web/scene/world/regions'
import {
  ALL_DAY,
  around,
  CRYPTO_TEMPLATE,
  FESTIVE_YEARS,
  hm,
  SHUT,
  sign,
  THURSDAY,
} from '@/web/scene/world/regions/pack-kit'
import { HOURS_PER_DAY } from '@/web/text/time-units'

const NOVEMBER_INDEX = 10
const DAYS_PER_WEEK = 7
// Thanksgiving is the fourth Thursday of November: three weeks after the first one.
const WEEKS_AFTER_FIRST_THURSDAY = 3
const THANKSGIVING_DAYS_BEFORE = 3
const THANKSGIVING_DAYS_AFTER = 1

/** The Thanksgiving day of `year` as `YYYY-MM-DD`. */
function thanksgivingOf(year: number): string {
  const firstWeekday = new Date(Date.UTC(year, NOVEMBER_INDEX, 1)).getUTCDay()
  const firstThursday = 1 + ((THURSDAY - firstWeekday + DAYS_PER_WEEK) % DAYS_PER_WEEK)
  const date = firstThursday + WEEKS_AFTER_FIRST_THURSDAY * DAYS_PER_WEEK

  return `${year}-${NOVEMBER_INDEX + 1}-${date}`
}

/** The United States pack: Lower Manhattan on Broadway, and the office's own day. */
export const US_PACK = Object.freeze({
  id: 'us',
  city: 'ui.office.street.cityUs',
  geo: { lat: 40.7069, lon: -74.0113 },
  road: {
    north: { carriageways: 1, lanesEach: 2, oneWay: true, median: false },
    west: { lanes: 1, oneWay: true },
    east: { lanes: 1, oneWay: true },
    turnSign: false,
    habits: false,
    bikeLane: true,
  },
  street: 'Broadway',
  sideStreets: { west: 'Rector Street', east: 'Exchange Place' },
  park: 'Bowling Green',
  plate: {
    background: '#16181B',
    ink: '#FFFFFF',
    frame: true,
    streetWord: false,
    caps: true,
    ratio: [60, 11],
  },
  speed: { north: 25, side: 25, unit: 'mph' },
  stops: [
    { name: 'Broadway & Rector St', routes: ['X27', 'BM4'], side: 'near' },
    { name: 'Broadway & Pine St', routes: ['M55', 'BM4'], side: 'near' },
  ],
  shops: [
    { kind: 'shutter', frontageM: 17, hours: SHUT, sign: sign('#8A8780', '#E8E2D0') },
    {
      kind: 'pharmacy',
      frontageM: 9.6,
      hours: [hm(7), hm(22)],
      item: 'bag',
      sign: sign('#1B5FA8', '#FFFFFF'),
    },
    {
      kind: 'store',
      frontageM: 9.9,
      hours: [hm(10), hm(20)],
      item: 'bag',
      name: 'Lantern Gifts',
      sign: sign('#C23B3B', '#FFF6DC'),
    },
    {
      kind: 'cafe',
      frontageM: 10.5,
      hours: [hm(6), hm(20)],
      item: 'cup',
      sign: sign('#3B3A36', '#F4EBD2'),
      tables: true,
    },
    { kind: 'shutter', frontageM: 24.4, hours: SHUT, sign: sign('#9A968C', '#E8E2D0') },
    { kind: 'bank', frontageM: 34, hours: [hm(9), hm(17)], sign: sign('#1F4E79', '#FFFFFF') },
    { kind: 'lobby', frontageM: 61, hours: ALL_DAY },
    {
      kind: 'food',
      frontageM: 8.4,
      hours: [hm(6), hm(21)],
      item: 'bag',
      name: 'Corner Deli',
      sign: sign('#2F6B3E', '#FFFFFF'),
    },
    {
      kind: 'store',
      frontageM: 8.4,
      hours: ALL_DAY,
      item: 'bag',
      name: 'Night Owl Market',
      sign: sign('#B5651D', '#FFF3D6'),
    },
    {
      kind: 'food',
      frontageM: 8.5,
      hours: [hm(6), hm(20)],
      item: 'box',
      name: 'Rye & Rise',
      sign: sign('#C9A46A', '#4A2E12'),
    },
    { kind: 'bank', frontageM: 25.1, hours: [hm(9), hm(17)], sign: sign('#2B2F36', '#FFFFFF') },
    { kind: 'fence', frontageM: 45, hours: ALL_DAY },
  ],
  vehicles: {
    kinds: { motorbike: 0.06, car: 0.84, bus: 0.1 },
    bikeShapes: { 'step-through': 0.3, scooter: 0.6, maxi: 0.05, sport: 0.05 },
    carSizes: { small: 0.15, mid: 0.6, large: 0.25 },
    taxiShare: 0.3,
    colours: {
      car: {
        small: ['#E9EAEC', '#9EA3AB', '#6B7078', '#8A2B2B'],
        mid: ['#1D1F24', '#E9EAEC', '#9EA3AB', '#3A3F4A', '#6B7078', '#8A2B2B'],
        large: ['#1D1F24', '#3A3F4A', '#E9EAEC', '#9EA3AB'],
      },
      taxi: '#F4C61C',
      bus: ['#E4E8EC', '#D5DAE0'],
      truck: '#5E8C6A',
    },
  },
  crowd: {
    vehicles: { day: 12, quiet: 6, rush: 18, dayEdges: 8, night: 4 },
    walkers: { day: 16, quiet: 12, lunch: 26, rush: 24, dayEdges: 10, night: 4 },
    lunchQueue: 6,
  },
  officeHours: [hm(8), hm(20)],
  officeLife: {
    nap: SHUT,
    coffee: [hm(14, 30), hm(15)],
    yawn: [hm(15, 30), hm(15, 45)],
    dessert: { dow: 5, at: hm(16, 30), stayMin: 10 },
    arrive: [hm(8), hm(9)],
    leave: [hm(17), hm(19)],
    noTripsAfterOpenMin: 15,
    relaxedUntil: hm(19),
  },
  hours: {
    rush: [
      [hm(7), hm(9, 30)],
      [hm(16, 30), hm(19)],
    ],
    quiet: [[hm(13, 30), hm(15)]],
    lunch: [[hm(12), hm(13, 30)]],
    night: [
      [hm(22), hm(HOURS_PER_DAY)],
      [0, hm(5)],
    ],
    dayEdges: [
      [hm(5), hm(7)],
      [hm(19), hm(22)],
    ],
    school: [
      [hm(7, 50), hm(8, 20)],
      [hm(14, 50), hm(15, 20)],
    ],
    deliveries: [
      [hm(11), hm(14)],
      [hm(17, 30), hm(21, 30)],
    ],
    sweeper: [[hm(6), hm(8)]],
    garbage: [
      [hm(4, 30), hm(6)],
      [hm(22, 30), hm(HOURS_PER_DAY)],
      [0, hm(1)],
    ],
    cafe: [
      [hm(6, 30), hm(10)],
      [hm(14), hm(16, 30)],
    ],
    doorWalks: [[hm(6), hm(22)]],
    late: [
      [hm(23), hm(HOURS_PER_DAY)],
      [0, hm(5)],
    ],
    lightsOut: [
      [hm(23, 30), hm(HOURS_PER_DAY)],
      [0, hm(5)],
    ],
    balconies: [[hm(18), hm(22)]],
    shopsLit: [[0, hm(22)]],
    windowsLit: [
      [0, 0.2],
      [hm(2), 0.15],
      [hm(5), 0.15],
      [hm(6, 30), 0],
      [hm(17), 0],
      [hm(17, 30), 0.6],
      [hm(20), 0.55],
      [hm(22), 0.35],
      [hm(23), 0.25],
      [hm(HOURS_PER_DAY), 0.2],
    ],
    parks: {
      open: [[hm(6), hm(23)]],
      joggers: [
        [hm(6), hm(8)],
        [hm(17), hm(19)],
      ],
      gymPeak: [
        [hm(6), hm(8)],
        [hm(17), hm(19)],
      ],
      taiChi: [],
      playground: [[hm(9), hm(19)]],
      playgroundPeak: [[hm(15), hm(18)]],
    },
    vendors: {
      pho: [],
      tea: [],
      banhMi: [],
      flowerBike: [],
      eveningStools: [],
      foodCart: [[hm(11), hm(22)]],
    },
    crew: {
      receptionist: [[hm(7, 30), hm(18, 30)]],
      cleaner: [[hm(17, 30), hm(19)]],
      nightRounds: [
        [hm(19), hm(HOURS_PER_DAY)],
        [0, hm(6)],
      ],
    },
  },
  holidayDates: {
    tet: [],
    'trung-thu': [],
    'quoc-khanh': [],
    noel: FESTIVE_YEARS.map((year): DayRange => [`${year}-12-01`, `${year}-12-26`]),
    jul4: FESTIVE_YEARS.map((year): DayRange => [`${year}-07-01`, `${year}-07-05`]),
    thanksgiving: FESTIVE_YEARS.map((year) =>
      around(thanksgivingOf(year), THANKSGIVING_DAYS_BEFORE, THANKSGIVING_DAYS_AFTER)
    ),
  },
  vendors: ['foodCart'],
  chatter: ['honk', 'hello', 'hey'],
  words: {
    delivery: 'ui.office.street.delivery',
    taxi: 'ui.office.street.taxi',
    truck: 'ui.office.street.truck',
  },
  landmark: { shape: 'generic' },
  earningsSeasons: [
    { month: 1, from: 15, to: 31 },
    { month: 2, from: 1, to: 14 },
    { month: 4, from: 15, to: 30 },
    { month: 5, from: 1, to: 15 },
    { month: 7, from: 15, to: 31 },
    { month: 8, from: 1, to: 14 },
    { month: 10, from: 15, to: 31 },
    { month: 11, from: 1, to: 14 },
  ],
  expiryRule: 'third-friday',
  restDayStaff: ['clerk', 'assistant'],
  wallClocks: [
    { label: 'NYSE', zone: 'America/New_York' },
    { label: 'LSE', zone: 'Europe/London' },
    { label: 'UTC', zone: 'UTC' },
  ],
  exampleTicker: 'AAPL',
  agentTemplates: [
    {
      name: 'ui.office.team.tplUsDividend',
      prompt: 'ui.office.team.tplUsDividendPrompt',
      hint: 'ui.office.team.tplUsDividendHint',
      focus: { markets: ['equity-us'], horizon: 'long' },
    },
    {
      name: 'ui.office.team.tplTech',
      prompt: 'ui.office.team.tplTechPrompt',
      hint: 'ui.office.team.tplTechHint',
      focus: { markets: ['equity-us'], sectors: ['technology'] },
    },
    CRYPTO_TEMPLATE,
  ],
} as const satisfies RegionPack)
