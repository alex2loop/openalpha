import type { FactorMetric, FactorMetricId } from '@/trading/kernel/factor-metric'
import type { InstrumentRecord } from '@/trading/kernel/market/market-data'
import type { CrossSection } from '@/trading/markets/equity-vn/factors/factors'
import type { NameEvidence } from '@/trading/markets/equity-vn/factors/name-evidence'
import type { NameContext } from '@/trading/markets/types'
import { latestNameSession } from '@/trading/markets/equity-vn/factors/factors'
import {
  qualityMetrics,
  valuationMetrics,
} from '@/trading/markets/equity-vn/factors/fundamental-ranks'
import { SECTOR_RANK_MINIMUM_MEMBERS } from '@/trading/markets/equity-vn/policy'
import { toBreadth } from '@/trading/markets/equity-vn/tape/breadth'
import { median } from '@/trading/markets/timeseries'

/** The readings a sector median is taken of: the multiples, the return on equity and the earnings
 *  growth printed beside the name's own. */
const SECTOR_MEDIAN_IDS = Object.freeze([
  'pe',
  'pb',
  'return-on-equity',
  'earnings-growth',
] as const satisfies readonly FactorMetricId[])

/** The medians of each sector a pass has asked for, held for as long as the pass is. */
const MEDIANS_BY_PASS = new WeakMap<CrossSection, Map<string, readonly FactorMetric[]>>()

/** The sector's medians, the room left to foreigners and the day's breadth, all off the pass the
 *  screen already made, so asking costs no provider read. */
export function nameContext(cross: CrossSection, evidence: NameEvidence): NameContext {
  const sector = sectorMedians(cross, evidence)
  const breadth = toBreadth(
    cross.names,
    latestNameSession(cross.names) ?? cross.asOf,
    cross.indexBars
  )
  const room = foreignRoomLeft(evidence.record)

  return {
    figures: room === undefined ? [] : [room],
    ...(sector === undefined ? {} : { sector }),
    ...(breadth === undefined
      ? {}
      : { breadth: { advancers: breadth.advancers, decliners: breadth.decliners } }),
  }
}

/** The plain values a board row carries beside its factors: where the name stands against its year
 *  and the index, how far it swings, the room left to foreigners and the sector's median P/E. All
 *  of it comes off the pass the screen already made. */
export function boardReadings(
  cross: CrossSection,
  evidence: NameEvidence
): readonly FactorMetric[] {
  const room = foreignRoomLeft(evidence.record)
  const sectorPe = sectorMedians(cross, evidence)?.medians.find(({ id }) => id === 'pe')

  return [
    ...(evidence.boardMetrics ?? []),
    ...(room === undefined ? [] : [room]),
    ...(sectorPe === undefined ? [] : [{ id: 'sector-pe' as const, value: sectorPe.value }]),
  ]
}

/** The sector's medians the name has a reading of itself, off the same readings the factors print
 *  for each name, so a median and the reading beside it share a definition: a loss-maker has no
 *  P/E to put in either. */
function sectorMedians(cross: CrossSection, evidence: NameEvidence): NameContext['sector'] {
  const code = evidence.record.sector

  if (code === undefined || evidence.record.kind !== 'equity') {
    return undefined
  }

  const own = readingsOf(evidence)
  const medians = mediansOf(cross, code).filter(({ id }) =>
    own.some((reading) => reading.id === id)
  )

  return medians.length === 0 ? undefined : { code, medians }
}

/** A sector's medians are the same for each of its names, so a pass takes them once per sector. */
function mediansOf(cross: CrossSection, code: string): readonly FactorMetric[] {
  const sectors = MEDIANS_BY_PASS.get(cross) ?? new Map<string, readonly FactorMetric[]>()
  const known = sectors.get(code)

  if (known !== undefined) {
    return known
  }

  const medians = takeMedians(cross, code)

  sectors.set(code, medians)
  MEDIANS_BY_PASS.set(cross, sectors)

  return medians
}

/** A sector too thin to rank within pools with the rest of the board there, so a median over its
 *  few names would be the pool's by another name. */
function takeMedians(cross: CrossSection, code: string): readonly FactorMetric[] {
  const peers = cross.names
    .filter((name) => name.record.kind === 'equity' && name.record.sector === code)
    .map(readingsOf)

  if (peers.length < SECTOR_RANK_MINIMUM_MEMBERS) {
    return []
  }

  return SECTOR_MEDIAN_IDS.flatMap((id): readonly FactorMetric[] => {
    const values = peers.flatMap((readings) =>
      readings.filter((reading) => reading.id === id).map((reading) => reading.value)
    )
    const value = values.length < SECTOR_RANK_MINIMUM_MEMBERS ? undefined : median(values)

    return value === undefined ? [] : [{ id, value }]
  })
}

function readingsOf(name: NameEvidence): readonly FactorMetric[] {
  return [
    ...valuationMetrics(name, undefined, undefined),
    ...qualityMetrics(name, undefined, undefined),
  ]
}

/** The ownership fields are fractions of shares outstanding. Stamped only where the room source
 *  answered, so a name without both has no room to state rather than none left. */
function foreignRoomLeft(record: InstrumentRecord): FactorMetric | undefined {
  const { foreignOwnershipPct: held, foreignOwnershipLimitPct: limit } = record

  return held === undefined || limit === undefined
    ? undefined
    : { id: 'foreign-room-left', value: Math.max(limit - held, 0) }
}
