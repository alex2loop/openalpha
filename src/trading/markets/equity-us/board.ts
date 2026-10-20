import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { BarRecord, InstrumentRecord } from '@/trading/kernel/market/market-data'
import type { MarketDeps } from '@/trading/markets/deps'
import type { UsRaws } from '@/trading/markets/equity-us/raws'
import type { MarketManifest } from '@/trading/markets/types'
import { flightCache, mapWithConcurrency } from '@/core/utils/concurrency'
import { ETF_KIND } from '@/trading/kernel/instrument'
import {
  US_BOARD_READ_CONCURRENCY,
  US_BOARD_SNAPSHOT_SESSIONS,
  US_EVIDENCE_SESSIONS,
  US_MARKET_REF,
  US_SCREEN_ETFS,
  US_SCREEN_RANK,
} from '@/trading/markets/equity-us/policy'
import { usRawsOf } from '@/trading/markets/equity-us/raws'
import { usAdjustedCloses } from '@/trading/markets/equity-us/screen'

const BOARD_CACHE_DAYS = 2

export interface UsBoardName {
  readonly record: InstrumentRecord
  readonly bars: readonly BarRecord[]
  readonly marketCap: number
  readonly raws: UsRaws
}

/** A fund on the fund board: it has a series and no capitalisation rank. */
interface UsFundName {
  readonly record: InstrumentRecord
  readonly bars: readonly BarRecord[]
}

/** The equities ranked by capitalisation, and the funds the fund board names. Built from the
 *  store alone: the refresh decides who holds a snapshot and a series. */
export interface UsBoard {
  readonly asOf: TradingDay
  /** Largest capitalisation first. */
  readonly names: readonly UsBoardName[]
  readonly byTicker: ReadonlyMap<Ticker, UsBoardName>
  readonly funds: readonly UsFundName[]
}

export interface UsBoardCache {
  get(asOf: TradingDay, signal: AbortSignal): Promise<UsBoard>
  /** Refresh calls this after writing evidence; nothing else invalidates. */
  invalidate(): void
}

/** One pass per day, shared by the screen, the factors and the overview. Two slots, so yesterday's
 *  brief pass and today's screen pass coexist. */
export function createUsBoardCache(deps: MarketDeps, manifest: MarketManifest): UsBoardCache {
  const passes = flightCache<UsBoard>(BOARD_CACHE_DAYS)

  return {
    get: (asOf, signal) =>
      passes.share(asOf, signal, () => loadUsBoard(deps, manifest, { asOf, signal })),
    invalidate: passes.clear,
  }
}

async function loadUsBoard(
  deps: MarketDeps,
  manifest: MarketManifest,
  request: { readonly asOf: TradingDay; readonly signal: AbortSignal }
): Promise<UsBoard> {
  const { asOf, signal } = request
  const { calendar } = manifest
  const [records, snapshots] = await Promise.all([
    deps.marketDataStore.listInstruments({ market: US_MARKET_REF, status: 'active', signal }),
    deps.marketDataStore.listLatestFundamentals({
      market: US_MARKET_REF,
      fromDay: calendar.addTradingDays(asOf, -US_BOARD_SNAPSHOT_SESSIONS),
      signal,
    }),
  ])
  const byRecord = new Map<Ticker, InstrumentRecord>(
    records.map((record) => [record.instrument.ticker, record])
  )
  const members = rankUsMembers(snapshots, byRecord)
  const fundRecords = US_SCREEN_ETFS.flatMap((code) => {
    const record = byRecord.get(code)

    return record?.kind === ETF_KIND ? [record] : []
  })
  const fromDay = calendar.addTradingDays(asOf, -US_EVIDENCE_SESSIONS)
  const read = (record: InstrumentRecord): Promise<readonly BarRecord[]> =>
    deps.marketDataStore.listBars({ instrument: record.instrument, fromDay, toDay: asOf, signal })
  const [memberBars, fundBars] = await Promise.all([
    mapWithConcurrency(members, US_BOARD_READ_CONCURRENCY, (member) => read(member.record)),
    mapWithConcurrency(fundRecords, US_BOARD_READ_CONCURRENCY, read),
  ])
  const names = members.map((member, index) => toName(member, memberBars[index] ?? []))

  return {
    asOf,
    names,
    byTicker: new Map(names.map((name) => [name.record.instrument.ticker, name])),
    funds: fundRecords.map((record, index) => ({ record, bars: fundBars[index] ?? [] })),
  }
}

interface UsMember {
  readonly record: InstrumentRecord
  readonly marketCap: number
}

/** The equities whose newest snapshot is still current, largest capitalisation first and cut at the
 *  board's rank. Ties break on ticker, so the same store always draws the same line. */
export function rankUsMembers(
  snapshots: readonly { instrument: { ticker: Ticker }; marketCap?: number }[],
  byRecord: ReadonlyMap<Ticker, InstrumentRecord>
): readonly UsMember[] {
  const members: UsMember[] = []

  for (const snapshot of snapshots) {
    const record = byRecord.get(snapshot.instrument.ticker)

    if (record?.kind === 'equity' && snapshot.marketCap !== undefined && snapshot.marketCap > 0) {
      members.push({ record, marketCap: snapshot.marketCap })
    }
  }

  return members
    .sort(
      (left, right) =>
        right.marketCap - left.marketCap ||
        left.record.instrument.ticker.localeCompare(right.record.instrument.ticker)
    )
    .slice(0, US_SCREEN_RANK)
}

function toName(member: UsMember, bars: readonly BarRecord[]): UsBoardName {
  return {
    record: member.record,
    bars,
    marketCap: member.marketCap,
    raws: usRawsOf(usAdjustedCloses(bars)),
  }
}
