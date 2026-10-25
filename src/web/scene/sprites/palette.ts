import type { Body, HairTone, PantsTone, Shirt } from '@/web/scene/sprites/parts'

/** A part's three cel bands: lit top, body, shade. */
type Ramp = readonly [lit: string, body: string, shade: string]

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
})

/** What a held cup, bag or box is made of: its body and its band. */
export const HELD_TONES = Object.freeze({
  cup: ['#D9A23E', '#A8873A'],
  bag: ['#CBB28E', '#9E8763'],
  box: ['#B8864E', '#8E6238'],
  item: ['#6B7280', '#4A5266'],
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
} as const)
