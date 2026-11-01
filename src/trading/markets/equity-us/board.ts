import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { AnnualAccounts } from '@/trading/kernel/market/annual-accounts'
import type { BarRecord, InstrumentRecord } from '@/trading/kernel/market/market-data'
import type { MarketDeps } from '@/trading/markets/deps'
import type { UsFundamentalRanks } from '@/trading/markets/equity-us/fundamentals'
import type { UsRaws } from '@/trading/markets/equity-us/raws'
import type { MarketManifest } from '@/trading/markets/types'
import { flightCache, mapWithConcurrency } from '@/core/utils/concurrency'
import { ETF_KIND } from '@/trading/kernel/instrument'
import {
  newestReport,
  rankFundamentals,
  usFundamentalsOf,
} from '@/trading/markets/equity-us/fundamentals'
import {
  US_BOARD_READ_CONCURRENCY,
  US_BOARD_SNAPSHOT_SESSIONS,
  US_EVIDENCE_SESSIONS,
  US_MARKET_REF,
  US_SCREEN_ETFS,
  US_SCREEN_RANK,
  US_SCREEN_RANK_BUFFER,
} from '@/trading/markets/equity-us/policy'
import { usRawsOf } from '@/trading/markets/equity-us/raws'
import { usAdjustedCloses } from '@/trading/markets/equity-us/screen'
import { heldTickersIn } from '@/trading/markets/held-tickers'

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
  /** Every stored filed year per name, oldest first. */
  readonly accounts: ReadonlyMap<Ticker, readonly AnnualAccounts[]>
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
  const [records, accounts] = await Promise.all([
    deps.marketDataStore.listInstruments({ market: US_MARKET_REF, status: 'active', signal }),
    deps.marketDataStore.listAnnualAccounts({ market: US_MARKET_REF, signal }),
  ])
  const members = await loadUsMembers(deps, manifest, { records, asOf, now: Date.now(), signal })
  const fundRecords = fundsOf(records)
  const fromDay = manifest.calendar.addTradingDays(asOf, -US_EVIDENCE_SESSIONS)
  const read = (record: InstrumentRecord): Promise<readonly BarRecord[]> =>
    deps.marketDataStore.listBars({ instrument: record.instrument, fromDay, toDay: asOf, signal })
  const [memberBars, fundBars] = await Promise.all([
    mapWithConcurrency(members, US_BOARD_READ_CONCURRENCY, (member) => read(member.record)),
    mapWithConcurrency(fundRecords, US_BOARD_READ_CONCURRENCY, read),
  ])
  const ranks = rankFundamentals(
    new Map(
      members.map((member) => [
        member.record.instrument.ticker,
        usFundamentalsOf(
          newestReport(accounts.get(member.record.instrument.ticker), asOf),
          member.marketCap,
          member.record.sector
        ),
      ])
    )
  )
  const names = members.map((member, index) =>
    toName(member, memberBars[index] ?? [], ranks.get(member.record.instrument.ticker))
  )

  return {
    asOf,
    names,
    byTicker: new Map(names.map((name) => [name.record.instrument.ticker, name])),
    funds: fundRecords.map((record, index) => ({ record, bars: fundBars[index] ?? [] })),
    accounts,
  }
}

function fundsOf(records: readonly InstrumentRecord[]): readonly InstrumentRecord[] {
  const byRecord = new Map<Ticker, InstrumentRecord>(
    records.map((record) => [record.instrument.ticker, record])
  )

  return US_SCREEN_ETFS.flatMap((code) => {
    const record = byRecord.get(code)

    return record?.kind === ETF_KIND ? [record] : []
  })
}

/** The equities whose newest snapshot is still current, largest capitalisation first and cut at the
 *  board's rank. The refresh decides who holds a snapshot; this only reads them. */
export async function loadUsMembers(
  deps: MarketDeps,
  manifest: MarketManifest,
  read: {
    readonly records: readonly InstrumentRecord[]
    readonly asOf: TradingDay
    readonly now: number
    readonly signal: AbortSignal
  }
): Promise<readonly UsMember[]> {
  const [snapshots, held] = await Promise.all([
    deps.marketDataStore.listLatestFundamentals({
      market: US_MARKET_REF,
      fromDay: manifest.calendar.addTradingDays(read.asOf, -US_BOARD_SNAPSHOT_SESSIONS),
      signal: read.signal,
    }),
    heldTickersIn(deps, US_MARKET_REF, { now: read.now, signal: read.signal }),
  ])

  return rankUsMembers(
    snapshots,
    new Map(read.records.map((record) => [record.instrument.ticker, record])),
    held
  )
}

interface UsMember {
  readonly record: InstrumentRecord
  readonly marketCap: number
}

/** Largest capitalisation first, cut at the board's rank; a held name that slipped just past it
 *  stays while it is within the buffer, so its evidence keeps being refreshed and ranked. Ties
 *  break on ticker, so the same store always draws the same line. */
function rankUsMembers(
  snapshots: readonly { instrument: { ticker: Ticker }; marketCap?: number }[],
  byRecord: ReadonlyMap<Ticker, InstrumentRecord>,
  held: ReadonlySet<Ticker>
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
    .filter(
      (member, rank) =>
        rank < US_SCREEN_RANK ||
        (rank < US_SCREEN_RANK_BUFFER && held.has(member.record.instrument.ticker))
    )
}

function toName(
  member: UsMember,
  bars: readonly BarRecord[],
  ranks: UsFundamentalRanks | undefined
): UsBoardName {
  return {
    record: member.record,
    bars,
    marketCap: member.marketCap,
    raws: { ...usRawsOf(usAdjustedCloses(bars)), ...ranks },
  }
}
