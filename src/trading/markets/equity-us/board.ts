import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { AnnualAccounts } from '@/trading/kernel/market/annual-accounts'
import type { BarRecord, InstrumentRecord } from '@/trading/kernel/market/market-data'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import type { UsFundamentalRanks, UsFundamentals } from '@/trading/markets/equity-us/fundamentals'
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
import { usAccountsProvenance, usRawsOf } from '@/trading/markets/equity-us/raws'
import { usAdjustedCloses } from '@/trading/markets/equity-us/screen'
import { followedTickersIn } from '@/trading/markets/held-tickers'

const BOARD_CACHE_DAYS = 2

export interface UsBoardName {
  readonly record: InstrumentRecord
  readonly bars: readonly BarRecord[]
  readonly marketCap: number
  readonly raws: UsRaws
  readonly accountsProvenance: readonly SourceProvenance[]
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
  /** Value and quality of the held or watched names off the board, ranked against the board. */
  readonly followedRanks: ReadonlyMap<Ticker, UsFundamentalRanks>
}

interface UsMember {
  readonly record: InstrumentRecord
  readonly marketCap: number
}

/** A held or watched name off the board, with its capitalisation where a snapshot holds one. */
interface UsFollowed {
  readonly record: InstrumentRecord
  readonly marketCap?: number
}

/** The board, and the names the operator follows off it: a refresh keeps evidence for both. */
interface UsCoverage {
  readonly members: readonly UsMember[]
  readonly followed: readonly UsFollowed[]
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
  const coverage = await loadUsCoverage(deps, manifest, { records, asOf, now: Date.now(), signal })
  const { members } = coverage
  const fundRecords = fundsOf(records)
  const fromDay = manifest.calendar.addTradingDays(asOf, -US_EVIDENCE_SESSIONS)
  const read = (record: InstrumentRecord): Promise<readonly BarRecord[]> =>
    deps.marketDataStore.listBars({ instrument: record.instrument, fromDay, toDay: asOf, signal })
  const [memberBars, fundBars] = await Promise.all([
    mapWithConcurrency(members, US_BOARD_READ_CONCURRENCY, (member) => read(member.record)),
    mapWithConcurrency(fundRecords, US_BOARD_READ_CONCURRENCY, read),
  ])
  const ranks = rankFundamentals(
    fundamentalsOf(members, { accounts, asOf }),
    fundamentalsOf(coverage.followed, { accounts, asOf })
  )
  const names = members.map((member, index) => {
    const { ticker } = member.record.instrument

    return toName(member, memberBars[index] ?? [], {
      ranks: ranks.get(ticker),
      report: newestReport(accounts.get(ticker), asOf),
    })
  })

  return {
    asOf,
    names,
    byTicker: new Map(names.map((name) => [name.record.instrument.ticker, name])),
    funds: fundRecords.map((record, index) => ({ record, bars: fundBars[index] ?? [] })),
    accounts,
    followedRanks: new Map(
      coverage.followed.flatMap(({ record }) => {
        const rank = ranks.get(record.instrument.ticker)

        return rank === undefined ? [] : [[record.instrument.ticker, rank]]
      })
    ),
  }
}

/** An equity's newest filed year by the day asked, against what the market pays for it; a fund, or
 *  a name with no capitalisation to measure against, has none. */
function fundamentalsOf(
  entries: readonly UsFollowed[],
  read: {
    readonly accounts: ReadonlyMap<Ticker, readonly AnnualAccounts[]>
    readonly asOf: TradingDay
  }
): ReadonlyMap<Ticker, UsFundamentals> {
  return new Map(
    entries.flatMap(({ record, marketCap }) => {
      const { ticker } = record.instrument

      return record.kind !== 'equity' || marketCap === undefined
        ? []
        : [
            [
              ticker,
              usFundamentalsOf(
                newestReport(read.accounts.get(ticker), read.asOf),
                marketCap,
                record.sector
              ),
            ],
          ]
    })
  )
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
 *  board's rank, and the active names the operator holds or watches off it. The refresh decides who
 *  holds a snapshot; this only reads them. */
export async function loadUsCoverage(
  deps: MarketDeps,
  manifest: MarketManifest,
  read: {
    readonly records: readonly InstrumentRecord[]
    readonly asOf: TradingDay
    readonly now: number
    readonly signal: AbortSignal
  }
): Promise<UsCoverage> {
  const [snapshots, tickers] = await Promise.all([
    deps.marketDataStore.listLatestFundamentals({
      market: US_MARKET_REF,
      fromDay: manifest.calendar.addTradingDays(read.asOf, -US_BOARD_SNAPSHOT_SESSIONS),
      signal: read.signal,
    }),
    followedTickersIn(deps, US_MARKET_REF, { now: read.now, signal: read.signal }),
  ])
  const byRecord = new Map(read.records.map((record) => [record.instrument.ticker, record]))
  const members = rankUsMembers(snapshots, byRecord, tickers.held)
  const onBoard = new Set(members.map((member) => member.record.instrument.ticker))
  const followed = [...tickers.followed].flatMap((ticker) => {
    const record = byRecord.get(ticker)

    return record?.status === 'active' && !onBoard.has(ticker) ? [record] : []
  })

  return { members, followed: withMarketCaps(followed, snapshots) }
}

function withMarketCaps(
  records: readonly InstrumentRecord[],
  snapshots: readonly { instrument: { ticker: Ticker }; marketCap?: number }[]
): readonly UsFollowed[] {
  const caps = new Map(
    snapshots.map((snapshot) => [snapshot.instrument.ticker, snapshot.marketCap])
  )

  return records.map((record) => {
    const marketCap = caps.get(record.instrument.ticker)

    return marketCap === undefined || marketCap <= 0 ? { record } : { record, marketCap }
  })
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
  read: {
    readonly ranks: UsFundamentalRanks | undefined
    readonly report: AnnualAccounts | undefined
  }
): UsBoardName {
  return {
    record: member.record,
    bars,
    marketCap: member.marketCap,
    raws: { ...usRawsOf(usAdjustedCloses(bars)), ...read.ranks },
    accountsProvenance: usAccountsProvenance(read.report),
  }
}
