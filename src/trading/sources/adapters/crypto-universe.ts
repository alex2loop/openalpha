// Shared by the crypto providers: the ranked universe is the symbol table, and a symbol belongs to
// its best-ranked claimant. Each provider supplies its request and row shape; the caching, flight
// sharing and claim rules live here.
import type { TtlCache } from '@/core/utils/collections'
import type { CaveatCode } from '@/trading/kernel/caveat'
import type { RequestCoalescer } from '@/trading/sources/coalesce'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import type { SourceFetchOutcome, SourceRequest } from '@/trading/sources/types'
import { ttlCache } from '@/core/utils/collections'
import { createRequestCoalescer, providerRequestKey } from '@/trading/sources/coalesce'

const POSITIVE_RESOLUTION_TTL_MS = 3_600_000
const NEGATIVE_RESOLUTION_TTL_MS = 300_000
/** Headroom for the symbols only a lookup ever names: they arrive one at a time, so a fixed
 *  ceiling bounds them. The board's own claims are not bounded by it — see `claimCapacity`. */
const RESOLUTION_CACHE_MAXIMUM_ENTRIES = 256
/** A ranked board reorders by a few places an hour, and every quote and symbol lookup reads the
 *  same sweep. Five minutes cost one 750-row listing per screen and tripped CoinMarketCap's unstated
 *  ceiling in bursts; an hour is one read per session of work. Each row still carries the instant
 *  the provider observed it, so nothing reads as fresher than it is. */
const UNIVERSE_ROWS_TTL_MS = 3_600_000
const UNIVERSE_SNAPSHOT_KEY = 'universe'
/** Sorts behind every ranked row, so an unranked coin wins a symbol only when nothing else claims it. */
const UNRANKED = Number.MAX_SAFE_INTEGER

interface ResolvedCoin {
  readonly id: string
  readonly symbol: string
}

/** What resolution needs off a row, whatever the provider names those fields. */
interface RowIdentity {
  readonly id: string
  readonly symbol: string
  readonly rank: number | null
}

type CoinResolution =
  | { readonly kind: 'resolved'; readonly coin: ResolvedCoin }
  | { readonly kind: 'error'; readonly code: CaveatCode }

interface HeldRow<TRow> {
  readonly row: TRow
  readonly fetchedAt: number
}

interface UniverseSnapshot<TRow> {
  readonly rows: readonly TRow[]
  readonly fetchedAt: number
}

export interface UniverseResolver<TRow> {
  resolve(symbol: string, signal: AbortSignal): Promise<CoinResolution>
  universe(signal: AbortSignal): Promise<SourceFetchOutcome<UniverseSnapshot<TRow>>>
  /** The row a resolved coin holds in the ranked universe, so a per-asset read is a lookup in rows
   *  already fetched rather than a second request for one of them. Ok with no row means the coin
   *  sits outside that window, which is a different answer from a universe that would not load. */
  rowById(id: string, signal: AbortSignal): Promise<SourceFetchOutcome<HeldRow<TRow> | undefined>>
  /** One row per symbol, the same claimant resolution picks, so a fold and a lookup never disagree
   *  about which coin a ticker names. */
  uniqueRows(rows: readonly TRow[]): readonly TRow[]
}

interface UniverseSpec<TRow> {
  readonly request: (signal: AbortSignal) => SourceRequest
  readonly parse: (raw: unknown) => readonly TRow[]
  readonly identity: (row: TRow) => RowIdentity
  /** A coin ranked past this claims no symbol at all: down the tail a match is likelier to be a peg
   *  or a namesake than a market worth quoting. */
  readonly resolutionRankLimit: number
  /** Asks the provider for one named symbol, for a coin sitting past the listed window. Optional:
   *  a provider with no such endpoint answers only what its board carries. */
  readonly lookup?: (symbol: string, signal: AbortSignal) => SourceRequest
}

interface ResolutionCaches<TRow> {
  readonly positive: TtlCache<string, ResolvedCoin>
  readonly negative: TtlCache<string, CaveatCode>
  /** Rows the lookup answered, keyed by coin id so `rowById` reads them the way it reads a listed
   *  one, and held for the snapshot's life so neither reads as fresher than the other. */
  readonly lookedUp: TtlCache<string, HeldRow<TRow>>
}

interface ResolutionDeps<TRow> {
  readonly options: SourceAdapterOptions
  readonly spec: UniverseSpec<TRow>
  readonly caches: ResolutionCaches<TRow>
  readonly universe: (signal: AbortSignal) => Promise<SourceFetchOutcome<UniverseSnapshot<TRow>>>
  readonly lookups: RequestCoalescer
}

export function createUniverseResolver<TRow>(
  options: SourceAdapterOptions,
  spec: UniverseSpec<TRow>
): UniverseResolver<TRow> {
  const caches: ResolutionCaches<TRow> = {
    positive: ttlCache(POSITIVE_RESOLUTION_TTL_MS, claimCapacity(spec)),
    negative: ttlCache(NEGATIVE_RESOLUTION_TTL_MS, RESOLUTION_CACHE_MAXIMUM_ENTRIES),
    lookedUp: ttlCache(UNIVERSE_ROWS_TTL_MS, RESOLUTION_CACHE_MAXIMUM_ENTRIES),
  }
  const universe = createUniverseFetcher(options, spec, (rows) => rememberRows(rows, spec, caches))
  const lookups = createRequestCoalescer()

  return {
    resolve: (symbol, signal) =>
      resolveSymbol({ options, spec, caches, universe, lookups }, symbol.toUpperCase(), signal),
    universe,
    async rowById(id, signal) {
      const outcome = await universe(signal)

      if (outcome.kind === 'error') {
        return outcome
      }

      const { rows, fetchedAt } = outcome.value
      const row = rows.find((entry) => spec.identity(entry).id === id)
      const held = row === undefined ? caches.lookedUp.get(id) : { row, fetchedAt }

      return { kind: 'ok', value: held, fetchedAt }
    },
    uniqueRows: (rows) => uniqueSymbolRows(rows, spec),
  }
}

/** The claim table holds one entry per symbol the board claims, so the ranked window is what bounds
 *  it. A flat ceiling below that window evicts in insertion order, which is rank order, so the
 *  coins dropped are the largest ones: a 750-row board under a ceiling of 256 left every top-480
 *  coin unresolvable per asset while the tail resolved, and the route fell through to the one
 *  provider that looks a symbol up. */
function claimCapacity<TRow>(spec: UniverseSpec<TRow>): number {
  return spec.resolutionRankLimit + RESOLUTION_CACHE_MAXIMUM_ENTRIES
}

type UniverseFlight<TRow> = Promise<SourceFetchOutcome<UniverseSnapshot<TRow>>>

function createUniverseFetcher<TRow>(
  options: SourceAdapterOptions,
  spec: UniverseSpec<TRow>,
  onRows: (rows: readonly TRow[]) => void
): (signal: AbortSignal) => Promise<SourceFetchOutcome<UniverseSnapshot<TRow>>> {
  const snapshots = ttlCache<string, UniverseSnapshot<TRow>>(UNIVERSE_ROWS_TTL_MS, 1)
  // The flight runs under the signal that started it, so only that caller joins it: one run
  // cancelling must never fail the universe read another run is waiting on. The settled rows are
  // shared by everyone through `snapshots`.
  let pending: { readonly signal: AbortSignal; readonly pass: UniverseFlight<TRow> } | undefined

  return (signal) => {
    const cached = snapshots.get(UNIVERSE_SNAPSHOT_KEY)

    if (cached !== undefined) {
      return Promise.resolve({ kind: 'ok', value: cached, fetchedAt: cached.fetchedAt })
    }

    if (pending !== undefined && pending.signal === signal) {
      return pending.pass
    }

    const pass = options.http
      .getJson(spec.request(signal), (raw, fetchedAt) => ({ rows: spec.parse(raw), fetchedAt }))
      .then((outcome) => {
        if (outcome.kind === 'ok') {
          snapshots.set(UNIVERSE_SNAPSHOT_KEY, outcome.value)
          onRows(outcome.value.rows)
        }

        return outcome
      })
      .finally(() => {
        if (pending?.pass === pass) {
          pending = undefined
        }
      })

    pending = { signal, pass }

    return pass
  }
}

function rememberRows<TRow>(
  rows: readonly TRow[],
  spec: UniverseSpec<TRow>,
  caches: ResolutionCaches<TRow>
): void {
  const claims = claimBySymbol(
    rows.flatMap((row) => {
      const { id, symbol, rank } = spec.identity(row)

      return rank === null || rank <= 0 || rank > spec.resolutionRankLimit
        ? []
        : [{ symbol, rank, value: id }]
    })
  )

  for (const [symbol, claim] of claims) {
    if (claim.tied) {
      caches.positive.delete(symbol)
      caches.negative.set(symbol, 'source.ambiguous-symbol')
      continue
    }

    caches.negative.delete(symbol)
    caches.positive.set(symbol, { id: claim.value, symbol })
  }
}

/** The listing answers first and answers most symbols. One it claims for nobody is either past the
 *  ranked window or not a coin at all, and only the provider tells those apart, so the lookup runs
 *  once and its verdict is cached either way. An ambiguity the listing already found stands. */
async function resolveSymbol<TRow>(
  deps: ResolutionDeps<TRow>,
  symbol: string,
  signal: AbortSignal
): Promise<CoinResolution> {
  const { caches } = deps
  const claim = claimedCoin(caches, symbol)

  if (claim !== undefined) {
    return claim
  }

  const outcome = await deps.universe(signal)

  if (outcome.kind === 'error') {
    return outcome
  }

  return claimedCoin(caches, symbol) ?? (await lookupSymbol(deps, symbol, signal))
}

function claimedCoin<TRow>(
  caches: ResolutionCaches<TRow>,
  symbol: string
): CoinResolution | undefined {
  const resolved = caches.positive.get(symbol)

  if (resolved) {
    return { kind: 'resolved', coin: resolved }
  }

  const code = caches.negative.get(symbol)

  return code === undefined ? undefined : { kind: 'error', code }
}

/** One named coin, straight from the provider. Several rows under one symbol is the collision the
 *  listing refuses, and a provider with no lookup answers only what its board carried. */
async function lookupSymbol<TRow>(
  deps: ResolutionDeps<TRow>,
  symbol: string,
  signal: AbortSignal
): Promise<CoinResolution> {
  const { spec, caches } = deps
  const request = spec.lookup?.(symbol, signal)

  if (request === undefined) {
    return rejectSymbol(caches, symbol, 'source.symbol-not-found')
  }

  const outcome = await deps.lookups.share(providerRequestKey(request), signal, () =>
    deps.options.http.getJson(request, (raw, fetchedAt) => ({
      rows: spec.parse(raw),
      fetchedAt,
    }))
  )

  if (outcome.kind === 'error') {
    return outcome
  }

  const claim = claimBySymbol(rankedClaims(spec, outcome.value.rows, symbol)).get(symbol)

  if (claim === undefined) {
    return rejectSymbol(caches, symbol, 'source.symbol-not-found')
  }

  if (claim.tied) {
    return rejectSymbol(caches, symbol, 'source.ambiguous-symbol')
  }

  const { id } = spec.identity(claim.value)

  caches.lookedUp.set(id, { row: claim.value, fetchedAt: outcome.value.fetchedAt })
  caches.positive.set(symbol, { id, symbol })

  return { kind: 'resolved', coin: { id, symbol } }
}

/** The rows a lookup answered that carry the symbol asked for, ranked. Unranked rows are dropped
 *  the way the listing drops them - a record fold refuses a row with no rank anyway. */
function rankedClaims<TRow>(
  spec: UniverseSpec<TRow>,
  rows: readonly TRow[],
  symbol: string
): readonly { readonly symbol: string; readonly rank: number; readonly value: TRow }[] {
  return rows.flatMap((row) => {
    const { symbol: candidate, rank } = spec.identity(row)

    return candidate.toUpperCase() === symbol && rank !== null && rank > 0
      ? [{ symbol, rank, value: row }]
      : []
  })
}

function rejectSymbol<TRow>(
  caches: ResolutionCaches<TRow>,
  symbol: string,
  code: CaveatCode
): CoinResolution {
  caches.negative.set(symbol, code)

  return { kind: 'error', code }
}

interface SymbolClaim<TValue> {
  readonly value: TValue
  readonly rank: number
  readonly tied: boolean
}

/** Rank is market-cap order, so the best-ranked claimant is the largest coin trading under the
 *  ticker — the one a person naming it means. Only an exact tie leaves a symbol unclaimed. */
function claimBySymbol<TValue>(
  claims: Iterable<{ readonly symbol: string; readonly rank: number; readonly value: TValue }>
): Map<string, SymbolClaim<TValue>> {
  const best = new Map<string, SymbolClaim<TValue>>()

  for (const claim of claims) {
    const symbol = claim.symbol.toUpperCase()
    const held = best.get(symbol)

    if (held === undefined || claim.rank < held.rank) {
      best.set(symbol, { value: claim.value, rank: claim.rank, tied: false })
    } else if (claim.rank === held.rank) {
      best.set(symbol, { ...held, tied: true })
    }
  }

  return best
}

function uniqueSymbolRows<TRow>(rows: readonly TRow[], spec: UniverseSpec<TRow>): readonly TRow[] {
  const claims = claimBySymbol(
    rows.map((row) => {
      const { symbol, rank } = spec.identity(row)

      return { symbol, rank: rank ?? UNRANKED, value: row }
    })
  )

  return [...claims.values()].filter((claim) => !claim.tied).map((claim) => claim.value)
}
