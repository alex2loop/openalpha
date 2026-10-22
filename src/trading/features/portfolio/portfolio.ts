import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { LedgerMutateDeps } from '@/trading/features/ledger/mutate'
import type { BaseStatistics } from '@/trading/features/market-data/reads/statistics'
import type { PortfolioCandidate } from '@/trading/features/portfolio/folds/candidate'
import type { PortfolioAtOptions, RebalanceOptions } from '@/trading/features/portfolio/options'
import type { SegmentCandidateOptions } from '@/trading/features/portfolio/segment-candidates'
import type {
  AbsoluteRebalancePlan,
  PortfolioAssessment,
  PortfolioService,
  ReduceVerdicts,
  ValuedBook,
} from '@/trading/features/portfolio/types'
import type { PortfolioViewDeps, ValuedContext } from '@/trading/features/portfolio/view'
import type { ProfileService } from '@/trading/features/profile/types'
import type { Caveat, EvidenceReduceReasonCode } from '@/trading/kernel/caveat'
import type { TradingCosts } from '@/trading/kernel/config'
import type { InstrumentKind, PortfolioSegment, TradingDay } from '@/trading/kernel/instrument'
import type { MarketRequest } from '@/trading/kernel/market/market-capability'
import type { RegimeScale } from '@/trading/kernel/market/market-data'
import type { UserProfile } from '@/trading/kernel/operator/profile'
import type { VenueRegistry } from '@/trading/venues/types'
import { mutateLedger } from '@/trading/features/ledger/mutate'
import { previewRecord } from '@/trading/features/ledger/preview'
import { toEntryView } from '@/trading/features/ledger/write'
import { resolveRegimeScale } from '@/trading/features/market-data/reads/regime'
import { loadInstrumentStatistics } from '@/trading/features/market-data/reads/statistics'
import {
  type InstrumentsResolution,
  resolveInstruments,
  resolveRegionDay,
  resolveRegionSettledDay,
} from '@/trading/features/market-data/resolve'
import { candidateInstruments, loadAdviceInputs } from '@/trading/features/portfolio/candidates'
import { assessPortfolio } from '@/trading/features/portfolio/folds/health'
import { withoutResidue } from '@/trading/features/portfolio/folds/holdings'
import {
  DEFAULT_REBALANCE_POLICY,
  daysToLiquidate,
} from '@/trading/features/portfolio/folds/policy'
import { withOrderUnits } from '@/trading/features/portfolio/folds/rebalance'
import {
  buildRebalancePlan,
  resolveSizingBasis,
} from '@/trading/features/portfolio/folds/rebalance-advice'
import { withRegimeCaveats } from '@/trading/features/portfolio/folds/rebalance-caveat'
import { reconcileBook } from '@/trading/features/portfolio/reconcile'
import { withSegmentCandidateCaveats } from '@/trading/features/portfolio/segment-candidates'
import { venueChoices, venuesFor, venuesHolding } from '@/trading/features/portfolio/venues'
import {
  loadBook,
  loadValuedContext,
  segmentFor,
  toRelativeView,
} from '@/trading/features/portfolio/view'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { disabledSegments } from '@/trading/kernel/operator/profile'
import { minimumSizesByInstrument, reachableCashByMarket } from '@/trading/venues/holdings'

interface PortfolioServiceDeps extends PortfolioViewDeps {
  /** The book reads the operator's policy; it never decides or stores it. */
  readonly profile: Pick<ProfileService, 'get' | 'isSaved'>
  /** Handed to the write path: a recorded buy earns its exit plan there, not at a surface. */
  readonly exitPlans: LedgerMutateDeps['exitPlans']
  /** Why a held name may take no increase today. The book states the seam; wiring binds the store. */
  readonly reduceVerdicts: ReduceVerdicts
  readonly baseCurrency: PortfolioViewDeps['config']['baseCurrency']
  /** The region whose calendar dates every cross-market read, a write confirmation included. */
  readonly defaultRegion: PortfolioViewDeps['config']['defaultRegion']
  /** What the operator's broker charges, so a recorded trade that omits its fee gets one. */
  readonly costs: TradingCosts
  readonly venues: VenueRegistry
  /** A venue that cannot answer what it filled degrades the write; the warning names which. */
  readonly logger: Logger
  /** The locale a profile is seeded with when the caller has no admitted one of its own. */
  readonly defaultLocale: Locale
}

export function createPortfolioService(deps: PortfolioServiceDeps): PortfolioService {
  return {
    record: (options) => mutateLedger(deps, { ...options, kind: 'record' }),
    previewRecord: (options) => previewRecord(deps, options),

    recordVenues: (market) => venuesFor(deps.venues, deps.config.defaultVenues, market),
    venuesHolding: (market) => venuesHolding(deps.venues, market),
    venueChoices: () => venueChoices(deps.venues),
    hasTradedSince: (instrument, since, signal) =>
      deps.ledger.hasTradedSince(instrument, since, signal),

    update: (options) => mutateLedger(deps, { ...options, kind: 'update' }),
    remove: (options) => mutateLedger(deps, { ...options, kind: 'delete' }),

    async historyRelative(options) {
      const page = await deps.ledger.listPage(options)

      return {
        items: page.items.map(toEntryView),
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      }
    },

    historyAbsolute: (options) => deps.ledger.listPage(options),

    async viewRelative(options) {
      const valued = await valuedBookFor(deps, options)
      const minimumSizes = await minimumSizesByInstrument(
        deps.venues,
        valued.book.positions,
        options.signal
      )

      return toRelativeView(valued, minimumSizes)
    },

    viewAbsolute: (options) => valuedBookFor(deps, options),

    async viewAbsoluteSized(options) {
      const valued = await valuedBookFor(deps, options)
      const minimumSizes = await minimumSizesByInstrument(
        deps.venues,
        valued.book.positions,
        options.signal
      )

      return { valued, minimumSizes }
    },

    viewAbsoluteWithKinds: async (options) => {
      const { valued, instruments } = await valuedFor(deps, options)

      return { valued, instrumentKinds: kindsOf(instruments) }
    },

    async positionsAt(options) {
      const book = await loadBook(deps, { ...options, asOf: resolveAsOf(deps, options.now) })

      return book.positions
    },
    reconcile: (options) => reconcileBook(deps, options),

    assess: (options) => assessHoldings(deps, options),

    rebalance: async (options) => (await rebalance(deps, options)).advice,
    rebalanceWithUnits: async (options) => withOrderUnits(await rebalance(deps, options)),
    rebalanceAbsolute: (options) => rebalance(deps, options),
  }
}

/** Statistics over what is held, not what is screened: an assessment reports the book as it stands. */
async function assessHoldings(
  deps: PortfolioServiceDeps,
  options: Parameters<PortfolioService['assess']>[0]
): Promise<PortfolioAssessment> {
  const { valued, instrumentKinds, profile } = await loadAdviceContext(deps, options)
  const statistics = await loadInstrumentStatistics(deps, {
    instruments: valued.positions.map((entry) => entry.position.instrument),
    asOf: resolveAsOf(deps, options.now),
    now: options.now,
    signal: options.signal,
  })

  return assess(deps, { profile, valued, instrumentKinds, statistics })
}

async function rebalance(
  deps: PortfolioServiceDeps,
  options: RebalanceOptions
): Promise<AbsoluteRebalancePlan> {
  const named = await namedInstruments(deps, options)

  if (named?.kind === 'unresolved') {
    return unresolvedAdvice(named.caveats)
  }

  const asOf = resolveAsOf(deps, options.now)
  const request = { asOf, now: options.now, signal: options.signal }
  // The macro read needs only the day, so it overlaps the valuation instead of waiting behind it.
  const [context, regimes] = await Promise.all([
    loadAdviceContext(deps, options),
    resolveSegmentRegimes(deps, request, options.segments),
  ])
  const { valued, profile } = context
  // Guard before side effects: a book with no NAV to size yields the same advice whatever the
  // screen returns, so screening and pricing a wider universe would be cost with no reader.
  const sizable = resolveSizingBasis(valued).kind === 'sizable'
  const instruments = sizable
    ? candidateInstruments(valued, named?.instruments ?? profile.watchlist)
    : valued.positions.map((entry) => entry.position.instrument)
  const statistics = await loadInstrumentStatistics(deps, { instruments, ...request })
  const { candidates, standingReduces } = await loadAdviceInputs(deps, {
    sizable,
    profile,
    valued,
    statistics,
    instruments,
    ...request,
  })
  const plan = buildAdvice({
    deps,
    context,
    candidates,
    statistics,
    standingReduces,
    regimes: withRegimeCaveats(regimes, disabledSegments(profile.caps)),
  })

  // A plan scoped to the caller's segments is read for its rows, never for the candidate caveats,
  // so screening a board for names would be a read nobody prints.
  if (options.segments !== undefined) {
    return plan
  }

  return withSegmentCandidates(deps, plan, {
    ...request,
    considered: instruments,
    weighed: candidates,
  })
}

/** Read after the plan, not before: only the segments it could not fill need names, and screening a
 *  market whose segment came out at target would be a board nobody reads. */
async function withSegmentCandidates(
  deps: PortfolioServiceDeps,
  plan: AbsoluteRebalancePlan,
  clock: Omit<SegmentCandidateOptions, 'caveats'>
): Promise<AbsoluteRebalancePlan> {
  const caveats = await withSegmentCandidateCaveats(deps, {
    ...clock,
    caveats: plan.advice.caveats,
  })

  return caveats === plan.advice.caveats ? plan : { ...plan, advice: { ...plan.advice, caveats } }
}

/** This arm returns before the macro read, so it states the defensive regime rather than a scale
 *  nothing measured — the same reading `deriveMacroRisk` gives an absent macro. */
function unresolvedAdvice(caveats: readonly Caveat[]): AbsoluteRebalancePlan {
  return {
    advice: { kind: 'unavailable', reason: 'unresolved-names', findings: [], caveats },
    sizing: null,
    regimes: new Map(),
  }
}

/** `null` when the caller named nobody, which is the saved-watchlist case the profile answers.
 *  Resolution is separated from that fallback so it can run before the book is loaded. */
async function namedInstruments(
  deps: PortfolioServiceDeps,
  options: RebalanceOptions
): Promise<InstrumentsResolution | null> {
  if (options.tickers === undefined) {
    return null
  }

  return resolveInstruments(deps.markets, { tickers: options.tickers, signal: options.signal })
}

/** All the unsizable path needs: every finding rule reads only what the operator holds, so pricing
 *  a watchlist name there would change no finding it could report. */

/** One read per segment, from the market that owns it: a segment is capped by its own market's macro,
 *  never by the calendar owner's. `segments` names the segments the caller reads; every other takes
 *  the absent reading. Undefined is the whole book, as the operator's own plan is. */
async function resolveSegmentRegimes(
  deps: PortfolioServiceDeps,
  options: MarketRequest,
  segments: readonly PortfolioSegment[] | undefined
): Promise<ReadonlyMap<PortfolioSegment, RegimeScale>> {
  const entries = await Promise.all(
    deps.markets
      .list()
      .filter((market) => segments === undefined || segments.includes(market.manifest.segment))
      .map(
        async (market): Promise<readonly [PortfolioSegment, RegimeScale]> => [
          market.manifest.segment,
          await resolveRegimeScale(market, options),
        ]
      )
  )

  return new Map(entries)
}

interface PortfolioContext {
  readonly valued: ValuedBook
  readonly instrumentKinds: ReadonlyMap<string, InstrumentKind>
  readonly profile: UserProfile
  readonly profileSaved: boolean
}

/** Assessment and advice read the same book and profile, so a refresh cannot land between them. */
async function loadContext(
  deps: PortfolioServiceDeps,
  options: PortfolioAtOptions
): Promise<PortfolioContext> {
  const { valued, instruments } = await valuedFor(deps, options)
  const request = { defaultLocale: deps.defaultLocale, signal: options.signal }
  const [profile, profileSaved] = await Promise.all([
    deps.profile.get(request),
    deps.profile.isSaved(request),
  ])

  return { valued, instrumentKinds: kindsOf(instruments), profile, profileSaved }
}

async function loadAdviceContext(
  deps: PortfolioServiceDeps,
  options: PortfolioAtOptions
): Promise<PortfolioContext> {
  const context = await loadContext(deps, options)
  const positions = context.valued.book.positions
  const minimumSizes = await minimumSizesByInstrument(deps.venues, positions, options.signal)

  return { ...context, valued: withoutResidue(context.valued, minimumSizes) }
}

function buildAdvice(input: {
  readonly deps: PortfolioServiceDeps
  readonly context: PortfolioContext
  readonly candidates: readonly PortfolioCandidate[]
  readonly statistics: ReadonlyMap<string, BaseStatistics>
  readonly standingReduces: ReadonlyMap<string, EvidenceReduceReasonCode>
  readonly regimes: ReadonlyMap<PortfolioSegment, RegimeScale>
}): AbsoluteRebalancePlan {
  const { deps } = input
  const { profile, valued, instrumentKinds } = input.context

  // Attached here rather than in each of `buildRebalancePlan`'s arms: every arm was measured
  // against this book, and one of them forgetting to say so is the drift this field exists to stop.
  return {
    ...buildRebalancePlan({
      profile,
      profileSaved: input.context.profileSaved,
      valued,
      assessment: assess(deps, { profile, valued, instrumentKinds, statistics: input.statistics }),
      candidates: input.candidates,
      rebalancePolicy: DEFAULT_REBALANCE_POLICY,
      standingReduces: input.standingReduces,
      regimes: input.regimes,
      reachableCashBase: reachableCashByMarket(deps.venues, valued.book),
    }),
    book: valued,
  }
}

/** One assessment shape, so a finding the operator reads in a review is the same finding the
 *  allocation formula saw. */
function assess(deps: PortfolioServiceDeps, input: AssessmentInput): PortfolioAssessment {
  return assessPortfolio({
    profile: input.profile,
    valued: input.valued,
    evidence: [],
    segmentFor: (instrument) => segmentFor(deps.markets, instrument),
    instrumentKinds: input.instrumentKinds,
    daysToLiquidate: exitSessions(input.valued, input.statistics),
  })
}

interface AssessmentInput {
  readonly profile: UserProfile
  readonly valued: ValuedBook
  readonly instrumentKinds: ReadonlyMap<string, InstrumentKind>
  readonly statistics: ReadonlyMap<string, BaseStatistics>
}

/** Sessions to exit each holding at the participation ceiling. Absent when turnover is unmeasured,
 *  so an unmeasurable name is not reported as unable to be sold. */
function exitSessions(
  valued: ValuedBook,
  statistics: ReadonlyMap<string, BaseStatistics>
): ReadonlyMap<string, number> {
  const sessions = new Map<string, number>()

  for (const entry of valued.positions) {
    if (entry.kind !== 'priced') {
      continue
    }

    const key = buildInstrumentKey(entry.position.instrument)
    const days = daysToLiquidate(entry.valueBase, statistics.get(key)?.averageDailyTurnoverBase)

    if (days !== undefined) {
      sessions.set(key, days)
    }
  }

  return sessions
}

async function valuedFor(
  deps: PortfolioServiceDeps,
  options: PortfolioAtOptions
): Promise<ValuedContext> {
  return loadValuedContext(deps, {
    ...options,
    asOf: resolveAsOf(deps, options.now),
    settledDay: resolveSettled(deps, options.now),
  })
}

/** The public views consume the valued book only; the sector map is internal to assessment. */
async function valuedBookFor(
  deps: PortfolioServiceDeps,
  options: PortfolioAtOptions
): Promise<ValuedBook> {
  return (await valuedFor(deps, options)).valued
}

/** Display only: a row whose kind never resolved prints bare, so absent kinds stay absent here. */
function kindsOf(
  instruments: ReadonlyMap<string, { readonly instrumentKind?: InstrumentKind }>
): ReadonlyMap<string, InstrumentKind> {
  const kinds = new Map<string, InstrumentKind>()

  for (const [key, facts] of instruments) {
    if (facts.instrumentKind !== undefined) {
      kinds.set(key, facts.instrumentKind)
    }
  }

  return kinds
}

function resolveAsOf(deps: PortfolioServiceDeps, now: number): TradingDay {
  return resolveRegionDay(deps.markets, deps.defaultRegion, now)
}

/** What a mark is judged old against, which is the last session the region closed rather than the
 *  calendar day `resolveAsOf` names. The two differ every weekend and holiday. */
function resolveSettled(deps: PortfolioServiceDeps, now: number): TradingDay {
  return resolveRegionSettledDay(deps.markets, deps.defaultRegion, now)
}
