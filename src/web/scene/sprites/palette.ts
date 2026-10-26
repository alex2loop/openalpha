import type { Body, HairTone, PantsTone, Shirt } from '@/web/scene/sprites/parts'
import type { ActorStatus, DeskFocus, SheetView } from '@/web/scene/types'
import { colorScheme, colourPair } from '@/web/state/prefs'

/** A part's three cel bands: lit top, body, shade. */
type Ramp = readonly [lit: string, body: string, shade: string]
/** A material's light, mid and dark tone. */
export type Tones = readonly [string, string, string]

// A stamped sheet takes the action's hue: a buy in the page's up colour, a reduce in its down
// colour (both follow the theme and the red-up choice), a hold in ink.
const UP_TOKEN = '--up'
const DOWN_TOKEN = '--down'

/** The up and down hues the page's tokens set for one theme and colour pair. */
interface MoveTones {
  readonly scheme: string
  readonly pair: string
  readonly up: string
  readonly down: string
}

let moveTones: MoveTones | undefined

export const OUTLINE = '#2B2433'
/** The outline along a figure's top edge, a step lighter so the head does not look cut out. */
export const OUTLINE_TOP = '#6A5E70'
/** The outline of a person while they work. */
export const WORK_RIM = '#8FB4FF'
export const SHADOW = 'rgba(43, 36, 51, 0.18)'

/** The ramps the sprites are shaded from. */
export const RAMP = Object.freeze({
  skin: {
    light: ['#F6D3B3', '#E9B48E', '#C98C6A'],
    medium: ['#E2AE83', '#C98E62', '#A06A45'],
    deep: ['#A8714C', '#8A5839', '#66402A'],
  } satisfies Record<Body, Ramp>,
  hair: {
    dark: ['#5A4A42', '#3A2E2C', '#241C1E'],
    brown: ['#9A6844', '#764C2E', '#53331E'],
    blond: ['#EBCB86', '#CDA35C', '#A07A3E'],
    grey: ['#C9C6D0', '#9C99A8', '#6E6B7C'],
  } satisfies Record<HairTone, Ramp>,
  shirt: {
    teal: ['#9EDDD2', '#62B4A6', '#3E8A7E'],
    blue: ['#A9C2EE', '#7193D2', '#4E6CA8'],
    sky: ['#AEE0F2', '#70BEDA', '#4C93AE'],
    amber: ['#F4DA9C', '#DCB65C', '#A8873A'],
    orange: ['#F4BC98', '#DB8E5E', '#A8643C'],
    pink: ['#ECBED8', '#CB8EB3', '#9E6688'],
    slate: ['#C2C6D6', '#9296AA', '#686C80'],
    sand: ['#EAD8BC', '#CBB28E', '#9E8763'],
  } satisfies Record<Shirt, Ramp>,
  pants: {
    khaki: ['#CDB98F', '#B7A27C', '#8E7C5C'],
    charcoal: ['#6A5E70', '#4A4250', '#332D3A'],
    plum: ['#9A8498', '#6A5A6A', '#4C3F4D'],
  } satisfies Record<PantsTone, Ramp>,
  fur: ['#C08C5E', '#9A6A44', '#744E33'],
  shoe: ['#4A4250', '#3A3340', '#2B2433'],
  horn: ['#FFF8EA', '#EADBC0', '#C2AD88'],
  metal: ['#7C8494', '#5C6474', '#3E4452'],
  visor: ['#F2C46C', '#D9A23E', '#A87A2A'],
  cap: ['#7C8EB0', '#5C6E90', '#43516E'],
  apron: ['#7A8494', '#5E6878', '#454D5C'],
  scarf: ['#F2C46C', '#D9A23E', '#A87A2A'],
  board: ['#D9A86C', '#B8864E', '#8E6238'],
  book: ['#9AB5D6', '#7A95B8', '#5A7598'],
} as const satisfies Record<string, Ramp | Record<string, Ramp>>)

/** The flat details: face, accessories, paper and the held phone's glass. */
export const PALETTE = Object.freeze({
  eye: '#2B2433',
  glint: '#FFFFFF',
  mouth: '#B86A5A',
  blush: '#F1A79C',
  muzzle: '#E6C49E',
  nose: '#3A2E2C',
  lens: '#DCE8F4',
  frame: '#2B2433',
  gold: '#D9A23E',
  tie: '#3E4C78',
  paper: '#F7F5EF',
  line: '#8DB4FF',
  badge: '#F7F5EF',
  lanyard: '#4E6CA8',
  pocket: '#454D5C',
  cupRim: '#F4F2EA',
  glass: '#0B0E16',
  bezel: '#050608',
  screen: '#27356A',
  text: '#E9ECF8',
  flash: '#EEF0F4',
  vest: '#F28C28',
  vestBand: '#F5F0B0',
  epaulette: '#D9A23E',
  belt: '#2B2433',
})

/** What a held cup, bag or box is made of: its body and its band. */
export const HELD_TONES = Object.freeze({
  cup: ['#D9A23E', '#A8873A'],
  bag: ['#CBB28E', '#9E8763'],
  box: ['#B8864E', '#8E6238'],
  item: ['#6B7280', '#4A5266'],
  mop: ['#8E6238', '#C9CED8'],
} as const)

/** The four phone finishes (body, bright edge, back plate), one per owner by seed. */
export const PHONE_FINISHES: readonly [Ramp, ...Ramp[]] = Object.freeze([
  ['#C9CCD3', '#E6E8EC', '#B1B5BD'],
  ['#2B2D33', '#4A4D55', '#202228'],
  ['#A9C0D4', '#CBDAE7', '#8FA8BF'],
  ['#6E2638', '#8F3A4F', '#561C2B'],
])

/** Bé Alpha's own colours: the logo blue fading to violet, the curl and the face. */
export const MASCOT_TONES = Object.freeze({
  top: [84, 130, 246],
  bottom: [154, 90, 244],
  shine: '#A9C1FF',
  limb: '#6C6CF2',
  palm: '#FFFFFF',
  feet: '#3A2E6E',
  ink: '#1E1E2E',
  cheek: '#F49AC1',
  talk: '#5A1E3A',
  curl: '#5A48E0',
  spark: '#FFD166',
  screen: '#2F3F78',
  phoneGlass: '#0B0E16',
} as const)

/** The LED board's title: the app mark's blue and violet, lightened to read on a dark screen. */
export const LED_TITLE_TONES = Object.freeze(['#8FC0FF', '#A99BFF', '#D69BFF'] as const)

/** The furniture's materials, the same in both renderers. */
export const WOOD: Tones = ['#E2B47A', '#C99A5C', '#9E7444']
export const METAL: Tones = ['#DDE1E8', '#B4BAC5', '#8A919E']
export const CARD: Tones = ['#E8C38A', '#CDA064', '#A27A44']
export const FABRIC: Tones = ['#A9B6CC', '#8794AE', '#66718A']
export const DARKWOOD: Tones = ['#B07F4E', '#8E6238', '#6B4626']

/** Each room surface's base, line and seam tones. */
export const FLOOR_TONES = Object.freeze({
  wood: ['#E9DCC6', '#DFD0B6', '#D2C1A3'],
  carpet: ['#C2CEDB', '#B8C5D3'],
  lilac: ['#D2CCDD', '#C9C3D5'],
  tile: ['#E9E4DB', '#DCD5C9'],
  concrete: ['#D2D6DB', '#C8CCD2'],
} as const)

/** The dot over a head: green free, amber waiting, red after an error. */
export const STATUS_TONES = Object.freeze({
  free: '#32D74B',
  waiting: '#F2B33D',
  failed: '#FF6259',
} satisfies Record<ActorStatus, string>)

/** The building: wall bodies and caps, the wall face's bands, the corridor, glass and mullions. */
export const WALL_TONES = Object.freeze({
  dark: '#3E4356',
  edge: '#6B7186',
  face: '#EEF0F4',
  low: '#E1E4EB',
  skirt: '#B4B9C6',
  corridor: '#E4E6EB',
  corridorLine: '#D8DBE2',
  glass: '#A9CBE6',
  mullion: '#363D4D',
  frame: '#4A5265',
})

/** Furniture and office-life details both renderers paint alike. */
export const PROP_TONES = Object.freeze({
  leaf: ['#8CCB98', '#5FA872', '#3E7E52'],
  pot: '#C9845A',
  books: ['#8C9EC2', '#C9A86A', '#9AB5A8', '#B98AA8', '#D2B48C', '#7F8FA6', '#A88C6A'],
  copier: ['#F7F4EC', '#E9E6DF', '#CFCBC2'],
  ledOn: '#7FD49A',
  screenOff: '#3E4452',
  screenStandby: '#46557A',
  screenLit: '#9FC2FF',
  lampOff: '#E9DFC6',
  lampLit: '#FFF3C4',
  vending: '#D8D0E8',
  catBed: ['#E6B7A8', '#F9E3DA'],
  cups: ['#F6C6D6', '#FFFFFF', '#BFD3EE'],
  liftFrame: '#C9C2B8',
  liftLeaf: '#C9D0DB',
  liftCabin: '#4A5265',
  liftPanel: '#262A3A',
  liftLamp: ['#4B5370', '#FFB340'],
  callLamp: '#7FD49A',
  wetSign: '#F2C94C',
  bucket: '#3F7FC5',
  bin: '#5C6474',
  gate: ['#C9CED8', '#7C8494'],
  bell: '#D9A23E',
  threadOn: '#4E6CA8',
  burst: '#32D74B',
  cloud: ['#B6B7C9', '#C9CAD8'],
  umbrellaStand: '#5C6474',
} as const)

/** The desk devices': monitors, the desktop box, phones, StandBy stands, calendars and bins. */
export const DEVICE_TONES = Object.freeze({
  stand: '#5C6474',
  screenDark: '#0B0E1B',
  screenIdle: '#141A36',
  screenBar: '#2B3566',
  screenDim: 'rgba(8,11,24,.4)',
  bezel2: '#3E4452',
  track: '#232C52',
  trackFill: '#7FB6E8',
  trackTitle: '#8DB4FF',
  screenText: '#D7E0F5',
  keys: '#ECEEF2',
  keysEdge: '#B9BDC8',
  studio: ['#E4E7EC', '#F4F6F9', '#B7BDC9', '#3B404B'],
  studioMark: '#5A5F6B',
  port: '#1F222A',
  portWide: '#2B2F38',
  statusOff: '#4A4E5A',
  phoneFrames: [
    ['#C9CCD3', '#E6E8EC'],
    ['#2B2D33', '#4A4D55'],
    ['#A9C0D4', '#CBDAE7'],
    ['#6E2638', '#8F3A4F'],
  ],
  contact: '#6E5030',
  bezel: '#050608',
  phoneOff: '#26335E',
  glint: '#4D60A0',
  coffee: '#4A2C17',
  bin: ['#AEB9CC', '#C5CEDD'],
  page: '#FBF9F3',
  calendarHead: '#D8514B',
  titanium: '#F2F4F7',
  titaniumEdge: '#AEB4C0',
  standbyGlass: '#1B2552',
  quietVeil: 'rgba(0,0,0,.55)',
  flat: '#E9ECF8',
  operator: {
    tray: '#C9D0DC',
    cueRgb: '255,176,32',
    mug: '#C9505A',
    mugShade: '#A8404A',
    snack: '#FFD65A',
    snackTip: '#F29B4B',
    notes: [
      [62, 5, '#FFF4A8'],
      [64, 6, '#FFC9DE'],
      [61, 7, '#BFE3FF'],
    ],
  },
  meeting: {
    pad: '#3E4452',
    glass: '#BFE0F2',
    placards: [
      [36, 12],
      [68, 12],
      [100, 12],
      [20, 1],
      [52, 1],
      [84, 1],
      [116, 1],
    ],
  },
  standbyDay: {
    screen: '#2A4180',
    flowGround: '#1B1E4B',
    flow: ['rgba(120,170,255,.6)', 'rgba(255,140,200,.55)', 'rgba(120,240,210,.5)'],
    well: '#161A2E',
    ink: '#FFFFFF',
    colon: '#9FB0DC',
    hole: '#07080F',
  },
  standbyNight: {
    screen: '#140303',
    flowGround: '#2A0606',
    flow: ['rgba(255,70,50,.4)', 'rgba(255,90,60,.35)', 'rgba(200,50,40,.3)'],
    well: '#2A0808',
    ink: '#FF6A5A',
    colon: '#B04040',
    hole: '#140303',
  },
} as const)

/** Umbrella canopies, in the office's stand and over walkers in the rain: one per
 *  `UMBRELLA_LOOKS`. */
export const UMBRELLA_TONES = ['#3F7FC5', '#C9544A', '#2E3440', '#E0A13A'] as const

/** The body of the prop an own agent's desk carries, by its focus. */
export const FOCUS_TONES = Object.freeze({
  safe: '#9296AA',
  candles: '#1E2230',
  gold: '#D9A23E',
  piggy: '#ECBED8',
} satisfies Record<DeskFocus, string>)

/** A stamped sheet's hue in both renderers, read from the page's tokens once per theme and colour
 *  pair, never per sprite or per frame. */
export function stampToneOf(action: NonNullable<SheetView['action']>): string {
  return action === 'hold' ? OUTLINE : moveToneOf(action === 'buy' ? 'up' : 'down')
}

/** The page's up or down colour, as its tokens set it for the theme and the red-up choice. */
export function moveToneOf(direction: 'up' | 'down'): string {
  const scheme = colorScheme.value
  const pair = colourPair.value

  if (moveTones?.scheme !== scheme || moveTones.pair !== pair) {
    const style = getComputedStyle(document.documentElement)

    moveTones = {
      scheme,
      pair,
      up: style.getPropertyValue(UP_TOKEN).trim(),
      down: style.getPropertyValue(DOWN_TOKEN).trim(),
    }
  }

  return moveTones[direction]
}
