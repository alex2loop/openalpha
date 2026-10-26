import { VN_PACK } from '@/web/scene/world/regions/vn'

type RegionPackId = 'vn'

/** From one minute of the page day to another, the end excluded. */
export type MinuteRange = readonly [number, number]

/** The office's own day, in minutes of the page day: the lunch nap, the afternoon coffee, the
 *  mid-afternoon stretch, and the dessert cart (`dow` 0 for Sunday, staying `stayMin`). */
export interface OfficeLife {
  readonly nap: MinuteRange
  readonly coffee: MinuteRange
  readonly yawn: MinuteRange
  readonly dessert: { readonly dow: number; readonly at: number; readonly stayMin: number }
}

/** What the office knows of the city around it, keyed by the home region. */
export interface RegionPack {
  readonly id: RegionPackId
  readonly city: string
  /** The hours (page clock, from `open` to `close`) the office's people walk errands for you. */
  readonly officeHours: { readonly open: number; readonly close: number }
  readonly officeLife: OfficeLife
}

const DEFAULT_PACK: RegionPackId = 'vn'
const REGION_PACKS: Readonly<Record<RegionPackId, RegionPack>> = Object.freeze({
  vn: VN_PACK,
} satisfies Record<RegionPackId, RegionPack>)

/** The pack keyed by `homeRegion`, else the default one. */
export function packOf(homeRegion: string | undefined): RegionPack {
  return REGION_PACKS[homeRegion !== undefined && isPackId(homeRegion) ? homeRegion : DEFAULT_PACK]
}

function isPackId(region: string): region is RegionPackId {
  return Object.hasOwn(REGION_PACKS, region)
}
