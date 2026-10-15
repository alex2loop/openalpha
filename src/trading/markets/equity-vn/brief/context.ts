import type { BookSummary, BriefServices } from '@/trading/features/brief/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { BriefPolicy } from '@/trading/kernel/config'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type {
  MacroRiskSnapshot,
  MarketBriefRequest,
  SectorStrength,
} from '@/trading/kernel/market/market-capability'
import type { MacroRiskView } from '@/trading/kernel/market/market-macro'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import type { CrossSection } from '@/trading/markets/equity-vn/factors/factors'
import type { TradingCalendar } from '@/trading/markets/types'
import { isAbortError } from '@/core/errors'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import {
  VN_MACRO_DRIVERS,
  VN_MACRO_FORMULA_VERSION,
  VN_MARKET_REF,
  VN_MARKET_REGION,
} from '@/trading/markets/equity-vn/policy'
import { deriveMacroRisk } from '@/trading/markets/macro-risk'
import { SURFACE_LIMITS } from '@/trading/surface-limits'

/** One context, loaded once. Twenty-six builders each fetching what they need would issue the same
 *  universe read a dozen times and read the clock twenty-six times, producing a brief whose
 *  sections disagree about what day it is. */
export interface BriefContext {
  readonly deps: MarketDeps
  readonly services: BriefServices
  /** The plan the book would run today, read once. Three sections quote it, and three reads would
   *  price the same book three times and could disagree about what it holds. */
  readonly rebalance: () => Promise<Awaited<ReturnType<BriefServices['rebalance']>>>
  /** The book valued once: its headline, the loss count and the plan reads all price it the same. */
  readonly bookSummary: () => Promise<BookSummary | null>
  readonly request: MarketBriefRequest
  /** The market's own calendar: every horizon in a section is trading days, not calendar days. */
  readonly calendar: TradingCalendar
  readonly policy: BriefPolicy
  /** The VN names the operator chose. Empty is a real answer. */
  readonly watchlist: readonly InstrumentRef[]
  /** The VN names the brief debates: every held one, then the watchlist. A held name is never cut,
   *  since its run is what re-prices the plan the exit alerts arm. */
  readonly suggestionNames: readonly InstrumentRef[]
  /** The same outside VN. */
  readonly crossAssetSuggestionNames: readonly InstrumentRef[]
  /** The VN names whose corporate calendar the brief reads: the ones watched plus the ones held.
   *  A calendar lookup costs no model call, so it covers the whole book where a debate cannot. */
  readonly calendarNames: BriefNames
  /** The same union outside VN, for the sections that price a cross-asset name without debating it. */
  readonly crossAssetNames: BriefNames
  readonly cross: CrossSection | null
  /** Another day's pass, on demand: the delta section needs yesterday's board without forcing the
   *  whole context to reload a second universe. The two-slot cache keeps both days resident. */
  readonly crossAt: (day: TradingDay) => Promise<CrossSection>
  readonly sectors: readonly SectorStrength[]
  readonly macro: BriefMacroRisk | null
  readonly previousMacro: BriefMacroRisk | null
}

/** Names and the caveat their capping produced travel together, so a section that reads a truncated
 *  union cannot report it as the whole book. */
interface BriefNames {
  readonly names: readonly InstrumentRef[]
  readonly caveats: readonly Caveat[]
}

/** View and stamps travel together: parallel fields would eventually cite provenance for a
 *  different day than the view being rendered. */
interface BriefMacroRisk {
  readonly view: MacroRiskView
  readonly provenance: readonly SourceProvenance[]
}

export interface LoadContextOptions {
  readonly deps: MarketDeps
  readonly services: BriefServices
  readonly request: MarketBriefRequest
  readonly calendar: TradingCalendar
  readonly cross: () => Promise<CrossSection>
  readonly crossAt: (day: TradingDay) => Promise<CrossSection>
}

/** Every independent read is tolerated separately: a context field is optional or empty, never a
 *  rejected load that takes the whole brief down. The sections that need a missing field return
 *  `unavailable` on their own. */
export async function loadBriefContext(options: LoadContextOptions): Promise<BriefContext> {
  const { deps, request, services } = options
  const [cross, macro, holdings] = await Promise.all([
    optional(options.cross),
    optional(() => loadMacro(deps, request)),
    optional(() => services.holdings({ now: request.now, signal: request.signal })),
  ])
  const watchlists = resolveWatchlists(request, cross)
  const held = holdings ?? []
  const heldInMarket = held.filter(isVnInstrument)
  const heldCrossAsset = held.filter((instrument) => !isVnInstrument(instrument))

  return {
    deps,
    services,
    rebalance: onceAsync(() => services.rebalance({ now: request.now, signal: request.signal })),
    bookSummary: onceAsync(() =>
      services.bookSummary({ now: request.now, signal: request.signal })
    ),
    request,
    calendar: options.calendar,
    policy: deps.config.briefs,
    watchlist: watchlists.market,
    suggestionNames: dedupe([...heldInMarket, ...watchlists.market]),
    crossAssetSuggestionNames: dedupe([...heldCrossAsset, ...watchlists.crossAsset]),
    calendarNames: unionNames(watchlists.covered, heldInMarket),
    crossAssetNames: unionNames(watchlists.crossAsset, heldCrossAsset),
    cross,
    crossAt: options.crossAt,
    sectors: cross?.sectors ?? [],
    macro: macro?.current ?? null,
    previousMacro: macro?.previous ?? null,
  }
}

interface MacroPair {
  readonly current: BriefMacroRisk
  readonly previous: BriefMacroRisk | null
}

/** Two consecutive snapshots under the same formula version. Comparing across versions would
 *  report a regime shift that was a formula edit, not a market move. */
async function loadMacro(deps: MarketDeps, request: MarketBriefRequest): Promise<MacroPair | null> {
  const snapshots = await deps.marketDataStore.listRecentMacroRisk({
    region: VN_MARKET_REGION,
    formulaVersion: VN_MACRO_FORMULA_VERSION,
    limit: 2,
    signal: request.signal,
  })
  const [current, previous] = snapshots

  if (current === undefined) {
    return null
  }

  return {
    current: toBriefMacroRisk(current),
    previous: previous === undefined ? null : toBriefMacroRisk(previous),
  }
}

/** The stored regime, formula version, and caveats are the market's own derived answer and are read
 *  back rather than recomputed; only the driver breakdown is re-derived, and it is a pure function
 *  of the persisted values. */
function toBriefMacroRisk(snapshot: MacroRiskSnapshot): BriefMacroRisk {
  const base = deriveMacroRisk(
    {
      values: snapshot.values,
      observationDates: snapshot.observationDates,
      region: snapshot.region,
      asOf: snapshot.asOf,
      provenance: snapshot.provenance,
    },
    VN_MACRO_DRIVERS
  )

  return {
    provenance: snapshot.provenance,
    view: {
      ...base,
      regime: snapshot.regime,
      scoreRegime: snapshot.scoreRegime ?? base.scoreRegime,
      formulaVersion: snapshot.formulaVersion,
      caveats: snapshot.caveats,
    },
  }
}

/** Two questions the brief used to answer with one list: which names the operator chose, and which
 *  the calendar and event sections cover. They diverge when the watchlist is empty, where the
 *  market's most-traded names are worth covering but are not the operator's picks. */
interface BriefWatchlists {
  readonly market: readonly InstrumentRef[]
  readonly covered: readonly InstrumentRef[]
  readonly crossAsset: readonly InstrumentRef[]
}

function resolveWatchlists(
  request: MarketBriefRequest,
  cross: CrossSection | null
): BriefWatchlists {
  const limit = Math.max(request.limit, 1)
  const market = request.watchlist.filter(isVnInstrument).slice(0, limit)
  const crossAsset = request.watchlist
    .filter((instrument) => !isVnInstrument(instrument))
    .slice(0, limit)

  if (market.length > 0) {
    return { market, covered: market, crossAsset }
  }

  // A sort key, not a reading: an unmeasured name is not the most traded one.
  const mostTraded = [...(cross?.names ?? [])]
    .sort((a, b) => (b.turnover ?? 0) - (a.turnover ?? 0))
    .slice(0, limit)
    .map((name) => name.record.instrument)

  return { market, covered: mostTraded, crossAsset }
}

/** The watchlist half comes first and is never dropped: a name the operator chose to watch outranks
 *  one they merely hold when the cap bites. */
function unionNames(chosen: readonly InstrumentRef[], held: readonly InstrumentRef[]): BriefNames {
  const deduped = dedupe([...chosen, ...held])

  return {
    names: deduped.slice(0, SURFACE_LIMITS.maximumCalendarNames),
    caveats:
      deduped.length > SURFACE_LIMITS.maximumCalendarNames
        ? [{ code: 'brief.names-capped', detail: { limit: SURFACE_LIMITS.maximumCalendarNames } }]
        : [],
  }
}

function dedupe(instruments: readonly InstrumentRef[]): readonly InstrumentRef[] {
  const seen = new Set<string>()

  return instruments.filter((instrument) => {
    const key = buildInstrumentKey(instrument)

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function isVnInstrument(instrument: InstrumentRef): boolean {
  return instrument.market === VN_MARKET_REF
}

/** One read per context. A rejection is cached with the result: three sections degrading the same
 *  way is the honest answer, and retrying a failed book read twice more is not. */
function onceAsync<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined

  return () => {
    pending ??= load()

    return pending
  }
}

async function optional<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load()
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    // A failed context read degrades the sections that needed it, not the brief.
    return null
  }
}
