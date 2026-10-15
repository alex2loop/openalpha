import type { Caveat } from '@/trading/kernel/caveat'
import type { InstrumentKind, Ticker, TradingDay, VnIndexTier } from '@/trading/kernel/instrument'
import type {
  ForeignRoom,
  IndexMembership,
  InstrumentRecord,
} from '@/trading/kernel/market/market-data'
import type { RefreshKindResult } from '@/trading/kernel/market/refresh'
import type { SourceProvenance, SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import { currencyCode, VN_INDEX_TIERS } from '@/trading/kernel/instrument'
import { sourceId } from '@/trading/kernel/source/source-id'
import { reportedCaveats } from '@/trading/markets/equity-vn/caveats'
import {
  ADMITTED_EXCHANGES,
  BANK_SECTOR,
  ETF_BENCHMARK_BY_TICKER,
  MINIMUM_UNIVERSE_SIZE,
  UNIVERSE_STALE_MS,
  VN_HEADLINE_INDEX_TICKERS,
  VN_MARKET_REF,
  VN30_FRONT_MONTH_TICKER,
  VN30_INDEX_TICKER,
} from '@/trading/markets/equity-vn/policy'
import { toVnExchange } from '@/trading/markets/equity-vn/tradeability'

const VND = currencyCode('VND')
const ENTRADE_SOURCE_ID = sourceId('entrade')
const VIETCAP_CHART_SOURCE_ID = sourceId('vietcap-chart')

interface RefreshUniverseOptions {
  /** The scope the caller already loaded: it avoids a second store read and lets the outcome name
   *  the exact records evidence warming must target. */
  readonly stored: readonly InstrumentRecord[]
  readonly limit: number
  readonly now: number
  /** How far back the foreign-room sweep may look for a "latest" row, sized to span holidays. */
  readonly roomFromDay: TradingDay
  readonly roomToDay: TradingDay
  readonly signal: AbortSignal
}

export interface UniverseRefreshOutcome {
  readonly result: RefreshKindResult
  /** The admitted records after a successful replacement, the prior scope otherwise. */
  readonly universe: readonly InstrumentRecord[]
}

interface UniverseSources {
  readonly instruments: SourceResult<readonly InstrumentRecord[]>
  readonly rooms: SourceResult<readonly ForeignRoom[]>
  readonly shares: ReadonlyMap<Ticker, number>
  readonly memberships: SourceResult<readonly IndexMembership[]>
}

async function resolveUniverseSources(
  deps: MarketDeps,
  options: RefreshUniverseOptions
): Promise<UniverseSources> {
  const [instruments, rooms, shares, memberships] = await Promise.all([
    deps.sources.resolve({
      kind: 'instruments',
      context: { market: VN_MARKET_REF, limit: options.limit },
      signal: options.signal,
    }),
    deps.sources.resolve({
      kind: 'foreignRoom',
      context: {
        market: VN_MARKET_REF,
        fromDay: options.roomFromDay,
        toDay: options.roomToDay,
      },
      signal: options.signal,
    }),
    deps.marketDataStore.listSharesOutstanding({ market: VN_MARKET_REF, signal: options.signal }),
    deps.sources.resolve({
      kind: 'indexMembership',
      context: { market: VN_MARKET_REF },
      signal: options.signal,
    }),
  ])

  return { instruments, rooms, shares, memberships }
}

/** The whole scope is validated before anything is written. `replaceInstruments` is atomic scope
 *  replacement, so a partial universe would delist every name the provider happened to omit and the
 *  next screen would run against a fraction of the market without saying so. */
export async function refreshUniverse(
  deps: MarketDeps,
  options: RefreshUniverseOptions
): Promise<UniverseRefreshOutcome> {
  const {
    instruments: result,
    rooms,
    shares,
    memberships,
  } = await resolveUniverseSources(deps, options)

  if (result.kind === 'unavailable') {
    return buildFailedAttempt(options.stored, [], reportedCaveats(result.caveats, 'instruments'))
  }

  const admitted = assembleUniverse({
    instruments: result.value,
    rooms,
    shares,
    memberships,
    stored: options.stored,
    now: options.now,
  })
  const caveats = [
    ...result.caveats,
    ...foreignRoomCaveats(rooms),
    ...membershipCaveats(memberships),
  ]

  // A short or inconsistent universe is a bad fetch, not a shrunken market. It settles as an
  // attempt rather than throwing, so a provider serving the same payload cannot make every restart
  // repeat the fetch.
  if (admitted.length < MINIMUM_UNIVERSE_SIZE || !isCompleteScope(admitted)) {
    return buildFailedAttempt(options.stored, result.provenance, [
      ...caveats,
      { code: 'refresh.validation-failed', detail: { kind: 'instruments' } },
    ])
  }

  await deps.marketDataStore.replaceInstruments({
    market: VN_MARKET_REF,
    records: admitted,
    signal: options.signal,
  })

  return {
    result: {
      kind: 'instruments',
      status: 'replaced',
      targetCount: 1,
      successfulTargetCount: 1,
      missingTargets: [],
      // The screenable universe, which is what a skipped or retained run reports: the delisted rows
      // stored alongside it exist only to resolve a dead ticker, and counting them in one branch and
      // not the others makes the same column mean two things.
      recordCount: admitted.filter((record) => record.status === 'active').length,
      provenance: result.provenance,
      caveats: [...caveats, ...bankSectorCaveat(admitted)],
    },
    universe: admitted,
  }
}

type RoomByTicker = ReadonlyMap<Ticker, ForeignRoom>

/** Shares outstanding comes from the latest stored fundamental and barely moves, so the prior
 *  week's read is current. Either side missing — or a ratio outside its unit bound — leaves both
 *  fields unset: the room gate then falls back to the sector default rather than a number it
 *  cannot defend. */
function stampForeignOwnership(
  records: readonly InstrumentRecord[],
  rooms: readonly ForeignRoom[],
  shares: ReadonlyMap<Ticker, number>
): readonly InstrumentRecord[] {
  const roomByTicker: RoomByTicker = new Map(rooms.map((room) => [room.instrument.ticker, room]))

  return records.map((record) => withForeignOwnership(record, roomByTicker, shares))
}

/** On an unavailable room source the prior scope's ownership carries forward: scope replacement
 *  rewrites every row, so unstamped records would wipe a name whose room was exhausted and the
 *  room gate would stop flagging it. */
function carryForeignOwnership(
  records: readonly InstrumentRecord[],
  stored: readonly InstrumentRecord[]
): readonly InstrumentRecord[] {
  const storedByTicker = new Map(stored.map((record) => [record.instrument.ticker, record]))

  return records.map((record) => {
    const prior = storedByTicker.get(record.instrument.ticker)

    if (prior?.foreignOwnershipPct === undefined || prior.foreignOwnershipLimitPct === undefined) {
      return record
    }

    return {
      ...record,
      foreignOwnershipPct: prior.foreignOwnershipPct,
      foreignOwnershipLimitPct: prior.foreignOwnershipLimitPct,
    }
  })
}

function withForeignOwnership(
  record: InstrumentRecord,
  roomByTicker: RoomByTicker,
  shares: ReadonlyMap<Ticker, number>
): InstrumentRecord {
  const room = roomByTicker.get(record.instrument.ticker)
  const outstanding = shares.get(record.instrument.ticker)

  if (room === undefined || outstanding === undefined) {
    return record
  }

  const held = (room.totalRoomShares - room.availableRoomShares) / outstanding
  const limit = room.totalRoomShares / outstanding

  if (held < 0 || limit <= 0) {
    return record
  }

  return {
    ...record,
    foreignOwnershipPct: Math.min(held, 1),
    foreignOwnershipLimitPct: Math.min(limit, 1),
  }
}

function foreignRoomCaveats(rooms: SourceResult<readonly ForeignRoom[]>): readonly Caveat[] {
  return rooms.kind === 'unavailable'
    ? [...rooms.caveats, { code: 'source.foreign-room-unavailable' }]
    : rooms.caveats
}

interface AssembleUniverseOptions {
  readonly instruments: readonly InstrumentRecord[]
  readonly rooms: SourceResult<readonly ForeignRoom[]>
  readonly shares: ReadonlyMap<Ticker, number>
  readonly memberships: SourceResult<readonly IndexMembership[]>
  readonly stored: readonly InstrumentRecord[]
  readonly now: number
}

function assembleUniverse(options: AssembleUniverseOptions): readonly InstrumentRecord[] {
  const owned =
    options.rooms.kind === 'unavailable'
      ? carryForeignOwnership(options.instruments, options.stored)
      : stampForeignOwnership(options.instruments, options.rooms.value, options.shares)

  return [
    ...stampIndexTier(owned, options.memberships, options.stored).filter(isAdmissible),
    ...indexRecords(options.now),
  ]
}

type TierByTicker = ReadonlyMap<Ticker, VnIndexTier>

/** Narrowest wins: `VN_INDEX_TIERS` is ordered narrowest first, and VN30 ⊂ VN100. On an
 *  unavailable source the prior scope's tiers carry forward — scope replacement rewrites every
 *  row, so unstamped records would silently wipe what the last refresh stored. */
function stampIndexTier(
  records: readonly InstrumentRecord[],
  memberships: SourceResult<readonly IndexMembership[]>,
  stored: readonly InstrumentRecord[]
): readonly InstrumentRecord[] {
  const tierByTicker =
    memberships.kind === 'unavailable'
      ? tierByTickerFromStored(stored)
      : tierByTickerFromMemberships(memberships.value)

  return records.map((record) => {
    const tier = record.kind === 'equity' ? tierByTicker.get(record.instrument.ticker) : undefined

    return tier === undefined ? record : { ...record, indexTier: tier }
  })
}

function tierByTickerFromStored(stored: readonly InstrumentRecord[]): TierByTicker {
  const map = new Map<Ticker, VnIndexTier>()

  for (const record of stored) {
    if (record.indexTier !== undefined) {
      map.set(record.instrument.ticker, record.indexTier)
    }
  }

  return map
}

function tierByTickerFromMemberships(memberships: readonly IndexMembership[]): TierByTicker {
  const map = new Map<Ticker, VnIndexTier>()

  for (const tier of VN_INDEX_TIERS) {
    for (const row of memberships) {
      if (row.tier === tier && !map.has(row.instrument.ticker)) {
        map.set(row.instrument.ticker, tier)
      }
    }
  }

  return map
}

function membershipCaveats(
  memberships: SourceResult<readonly IndexMembership[]>
): readonly Caveat[] {
  return memberships.kind === 'unavailable'
    ? [...memberships.caveats, { code: 'source.index-membership-unavailable' }]
    : memberships.caveats
}

/** The foreign-room policy keys its bank default on this sector, so a mapped taxonomy with no
 *  bank in it means the provider renamed the label and the default silently stopped applying.
 *  Skipped when no record carries a sector: a failed taxonomy fetch reported its own caveat. */
function bankSectorCaveat(records: readonly InstrumentRecord[]): readonly Caveat[] {
  const mapped = new Set(
    records.flatMap((record) => (record.sector === undefined ? [] : [record.sector]))
  )

  return mapped.size > 0 && !mapped.has(BANK_SECTOR)
    ? [{ code: 'refresh.bank-sector-unmapped' }]
    : []
}

/** An attempted replacement that could not be admitted keeps the prior scope, so it is `retained`
 *  whenever there is one and `unavailable` only on a cold store. */
function buildFailedAttempt(
  stored: readonly InstrumentRecord[],
  provenance: readonly SourceProvenance[],
  caveats: readonly Caveat[]
): UniverseRefreshOutcome {
  return {
    result: {
      kind: 'instruments',
      status: stored.length > 0 ? 'retained' : 'unavailable',
      targetCount: 1,
      successfulTargetCount: 0,
      missingTargets: [],
      recordCount: stored.length,
      provenance,
      caveats,
    },
    universe: stored,
  }
}

/** No provider publishes these: VNDirect types nothing as an index. They are manifest facts, and
 *  each is stamped with the provider that charts it. The benchmark legs are read off the fund map
 *  rather than listed again, so a fund added there brings its index into the universe with it — and
 *  an index no fund tracks and the market does not publish is never fetched. */
function indexRecords(fetchedAt: number): readonly InstrumentRecord[] {
  const codes = new Set([...VN_HEADLINE_INDEX_TICKERS, ...ETF_BENCHMARK_BY_TICKER.values()])

  return [...codes].map((code) => ({
    instrument: { market: VN_MARKET_REF, ticker: code },
    name: code,
    kind: 'index' as const,
    status: 'active' as const,
    currency: VND,
    sourceId: VN_HEADLINE_INDEX_TICKERS.includes(code)
      ? ENTRADE_SOURCE_ID
      : VIETCAP_CHART_SOURCE_ID,
    fetchedAt,
  }))
}

/** A scope with no room limit anywhere was built before any fundamental existed: the universe is
 *  what the fundamentals fetch targets, so a cold store has no share count to divide by. It is the
 *  one staleness reason a replayed attempt must not answer, because that attempt is what built the
 *  unstamped scope. */
export function isForeignRoomUnstamped(universe: readonly InstrumentRecord[]): boolean {
  return !universe.some((record) => record.foreignOwnershipLimitPct !== undefined)
}

/** Gates instrument replacement only, never the evidence cadence. A fetch instant in the future is
 *  a broken clock or a bad record, which is stale rather than permanently fresh. */
export function isUniverseStale(universe: readonly InstrumentRecord[], now: number): boolean {
  if (universe.length === 0 || isForeignRoomUnstamped(universe)) {
    return true
  }

  const newest = universe.reduce((latest, row) => Math.max(latest, row.fetchedAt), 0)
  const ageMs = now - newest

  return ageMs < 0 || ageMs > UNIVERSE_STALE_MS
}

interface UniverseOptions {
  readonly kind?: InstrumentKind
  readonly signal: AbortSignal
}

/** The one record set detection, liquidity, sectors, breadth, ETFs, and the screen all read. */
export function loadUniverse(
  deps: MarketDeps,
  options: UniverseOptions
): Promise<readonly InstrumentRecord[]> {
  return deps.marketDataStore.listInstruments({
    market: VN_MARKET_REF,
    status: 'active',
    ...(options.kind === undefined ? {} : { kind: options.kind }),
    signal: options.signal,
  })
}

/** The spot leg of the VN30 basis. It is an ordinary record in the same versioned scope, so a
 *  failed refresh leaves the last valid one in place and a cold database has none — which the
 *  basis capability reports as unavailable rather than reaching around the scope. */
export function findIndexInstrument(
  universe: readonly InstrumentRecord[]
): InstrumentRecord | undefined {
  return universe.find(
    (record) => record.kind === 'index' && record.instrument.ticker === VN30_INDEX_TICKER
  )
}

/** The rolling alias *is* the front month, so finding it needs no expiry comparison. Expiry still
 *  comes from the record and stays unstated when the provider publishes none: a reader cannot tell
 *  a made-up settlement date from a real one. */
export function findFrontMonthFuture(
  universe: readonly InstrumentRecord[]
): InstrumentRecord | undefined {
  return universe.find(
    (record) => record.kind === 'future' && record.instrument.ticker === VN30_FRONT_MONTH_TICKER
  )
}

/** A name prices correctly only on a board this market holds a band and a tick table for, so an
 *  unrecognised floor is dropped rather than defaulted — defaulting would clamp its levels against
 *  another exchange's band, which is a wrong number rather than a missing one. Indices and futures
 *  carry no exchange of their own and are admitted as the reference legs they are — but an expired
 *  contract is not a leg. */
function isAdmissible(record: InstrumentRecord): boolean {
  if (record.kind === 'index' || record.kind === 'future') {
    return record.status !== 'delisted'
  }

  const exchange = toVnExchange(record.exchange)

  return exchange !== undefined && ADMITTED_EXCHANGES.includes(exchange)
}

/** A scope failing any of these would be written atomically over the last good one and then
 *  screened as if it were the market. */
function isCompleteScope(records: readonly InstrumentRecord[]): boolean {
  const seen = new Set<Ticker>()

  for (const record of records) {
    if (record.instrument.market !== VN_MARKET_REF || record.currency !== VND) {
      return false
    }

    if (seen.has(record.instrument.ticker)) {
      return false
    }

    seen.add(record.instrument.ticker)
  }

  return true
}
