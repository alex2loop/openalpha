import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { SectorStrength } from '@/trading/kernel/market/market-capability'
import type { Candle } from '@/trading/kernel/market/market-data'
import {
  MINIMUM_SECTOR_MEMBERS,
  SECTOR_LONG_SESSIONS,
  SECTOR_SHORT_SESSIONS,
  SECTOR_VOLATILITY_PENALTY,
} from '@/trading/markets/equity-vn/policy'
import { nSessionReturn, realizedVolatility, sessionChange } from '@/trading/markets/timeseries'

export interface SectorMember {
  readonly ticker: Ticker
  readonly sector?: string
  readonly closes: readonly number[]
  readonly foreignNetBase: number
  /** Weights the session return. Absent until fundamentals are fetched, which leaves the name out
   *  of that one number rather than out of the sector. */
  readonly marketCap?: number
  /** The session this member's newest usable bar belongs to. Absent when it has none, which keeps
   *  a name that did not trade out of the session return without disturbing the window returns. */
  readonly at?: TradingDay
}

interface SectorInput {
  readonly members: readonly SectorMember[]
  readonly benchmark: readonly Candle[]
  readonly session: TradingDay
}

/** One aggregation, read by the market's sector board, the `sector-rotation` brief section and
 *  `foreign-flow-sectors`. Computing it per reader is how a brief ends up disagreeing with the board
 *  it is printed beside. */
export function sectorStrength(input: SectorInput): readonly SectorStrength[] {
  const benchmarkCloses = input.benchmark.map((candle) => candle.close)
  const short = nSessionReturn(benchmarkCloses, SECTOR_SHORT_SESSIONS)
  const long = nSessionReturn(benchmarkCloses, SECTOR_LONG_SESSIONS)

  return [...groupBySector(input.members)]
    .filter(([, members]) => members.length >= MINIMUM_SECTOR_MEMBERS)
    .map(([sector, members]) =>
      strengthOf(sector, members, {
        ...(short === undefined ? {} : { benchmarkShort: short }),
        ...(long === undefined ? {} : { benchmarkLong: long }),
        session: input.session,
      })
    )
    .sort(byStrength)
}

/** The share of the population carrying a sector at all. Below the policy minimum the caller
 *  emits a coverage caveat instead of presenting a confident ranking over part of the market. */
export function sectorCoveragePct(members: readonly SectorMember[]): number {
  if (members.length === 0) {
    return 0
  }

  return members.filter((member) => hasSector(member)).length / members.length
}

/** Names without a sector are excluded, never bucketed as "other": one synthetic bucket holding
 *  every unclassified name would outrank real sectors on member count alone. */
function groupBySector(members: readonly SectorMember[]): ReadonlyMap<string, SectorMember[]> {
  const bySector = new Map<string, SectorMember[]>()

  for (const member of members) {
    if (!hasSector(member)) {
      continue
    }

    const bucket = bySector.get(member.sector)

    if (bucket === undefined) {
      bySector.set(member.sector, [member])
      continue
    }

    bucket.push(member)
  }

  return bySector
}

/** What every sector in one run is measured against: the benchmark's two window returns, and the
 *  session a daily move has to belong to. A window the index series could not answer is absent, and
 *  so is the excess built on it: a zero there reads each sector's own return as its lead. */
interface SectorContext {
  readonly benchmarkShort?: number
  readonly benchmarkLong?: number
  readonly session: TradingDay
}

/** The two windows are the factor's own, from `policy.ts`, so the section and the factor cannot
 *  drift to different lookbacks. Volatility is penalized exactly once, here — the per-name
 *  rotation score does not apply it again. */
function strengthOf(
  sector: string,
  members: readonly SectorMember[],
  context: SectorContext
): SectorStrength {
  const short = measuredMembers(members, (m) => nSessionReturn(m.closes, SECTOR_SHORT_SESSIONS))
  const long = measuredMembers(members, (m) => nSessionReturn(m.closes, SECTOR_LONG_SESSIONS))
  const volatilities = measuredMembers(members, (m) =>
    realizedVolatility(m.closes, SECTOR_SHORT_SESSIONS)
  )
  const excessReturnShort = excessOf(short, context.benchmarkShort)
  const excessReturnLong = excessOf(long, context.benchmarkLong)
  const dailyVolatility = mean(volatilities.values)
  const sessionReturn = weightedSessionReturn(members, context.session)
  const score =
    excessReturnShort === undefined ||
    excessReturnLong === undefined ||
    dailyVolatility === undefined
      ? undefined
      : (excessReturnShort + excessReturnLong) / 2 -
        windowVolatilityOf(dailyVolatility) * SECTOR_VOLATILITY_PENALTY

  return {
    sector,
    memberCount: members.length,
    ...(sessionReturn === undefined ? {} : { sessionReturn }),
    ...(excessReturnShort === undefined ? {} : { excessReturnShort }),
    ...(excessReturnLong === undefined ? {} : { excessReturnLong }),
    foreignNetBase: members.reduce((sum, member) => sum + member.foreignNetBase, 0),
    ...(score === undefined ? {} : { score }),
  }
}

/** Scored sectors strongest first; one too thin to score sorts after them all rather than as a zero. */
function byStrength(left: SectorStrength, right: SectorStrength): number {
  const byScore =
    left.score === undefined || right.score === undefined
      ? Number(left.score === undefined) - Number(right.score === undefined)
      : right.score - left.score

  return byScore || left.sector.localeCompare(right.sector)
}

function excessOf(measured: MeasuredMembers, benchmark: number | undefined): number | undefined {
  const sectorReturn = capWeightedMean(measured.values, measured.caps)

  return benchmark === undefined || sectorReturn === undefined
    ? undefined
    : sectorReturn - benchmark
}

/** A daily stdev subtracted from window returns is an order of magnitude too small to discount
 *  anything; sqrt(sessions) puts the penalty in the same units as the returns. */
function windowVolatilityOf(dailyVolatility: number): number {
  return dailyVolatility * Math.sqrt(SECTOR_SHORT_SESSIONS)
}

interface MeasuredMembers {
  readonly values: readonly number[]
  readonly caps: readonly number[]
}

/** The members that produced a reading, with their capitalisations beside them. A name too young
 *  for the window abstains rather than scoring a flat zero, which would keep its whole
 *  capitalisation in the weighting and drag the sector toward nothing - a fresh listing was a third
 *  of retail's cap on 2026-09-22. */
function measuredMembers(
  members: readonly SectorMember[],
  select: (member: SectorMember) => number | undefined
): MeasuredMembers {
  const values: number[] = []
  const caps: number[] = []

  for (const member of members) {
    const value = select(member)

    if (value !== undefined) {
      values.push(value)
      caps.push(member.marketCap ?? 0)
    }
  }

  return { values, caps }
}

/** Capitalisation-weighted, because that is the sector move every outlet publishes: equal-weighted,
 *  nine oil names outrank seventy-seven real-estate ones. Equal weight only where no member carries
 *  a capitalisation. Absent when nobody traded, never zero. */
function weightedSessionReturn(
  members: readonly SectorMember[],
  session: TradingDay
): number | undefined {
  const traded = measuredMembers(members, (member) =>
    member.at === session ? sessionChange(member.closes) : undefined
  )

  return capWeightedMean(traded.values, traded.caps)
}

/** Capitalisation-weighted, equal only where no member carries a capitalisation, and absent where
 *  no member was measured. Both excess returns read this because the benchmark they subtract is a
 *  cap-weighted index, and an equal-weighted leg against a cap-weighted one leaves a weighting
 *  artifact where the sector signal should be: equal-weighted put 92% of readings below zero and
 *  the 99th percentile at +0,10, which is a statement about mega-caps rather than about sectors. */
function capWeightedMean(
  values: readonly number[],
  weights: readonly number[]
): number | undefined {
  const total = weights.reduce((sum, weight) => sum + weight, 0)

  if (total <= 0) {
    return mean(values)
  }

  return values.reduce((sum, value, index) => sum + value * (weights[index] ?? 0), 0) / total
}

function hasSector(member: SectorMember): member is SectorMember & { readonly sector: string } {
  return member.sector !== undefined && member.sector.length > 0
}

function mean(values: readonly number[]): number | undefined {
  return values.length === 0
    ? undefined
    : values.reduce((sum, value) => sum + value, 0) / values.length
}
