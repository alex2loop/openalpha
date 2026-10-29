import type { PricedLevels } from '@/trading/features/suggestion/pipeline/levels'
import type { StageRunResult } from '@/trading/features/suggestion/pipeline/stages'
import type {
  DraftDirection,
  Prepared,
  SuggestionPortfolioContext,
  SuggestionRunOptions,
} from '@/trading/features/suggestion/pipeline/types'
import type {
  Suggestion,
  SuggestionRequest,
  SuggestionRunResult,
} from '@/trading/features/suggestion/types'
import type { FactorScore } from '@/trading/kernel/factor'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { RegimeScale } from '@/trading/kernel/market/market-data'
import type { MarketEvent } from '@/trading/kernel/market/market-event'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { StageInput } from '@/trading/markets/stage'
import type { MarketResolution } from '@/trading/markets/types'
import { resolveDay } from '@/trading/features/market-data/resolve'
import { toStoredDebate } from '@/trading/features/suggestion/debate/types'
import {
  debateInputFor,
  loadCalibration,
} from '@/trading/features/suggestion/pipeline/debate-input'
import {
  draftDirectionFor,
  levelDirectionFor,
} from '@/trading/features/suggestion/pipeline/direction'
import { buildDraft, finalize } from '@/trading/features/suggestion/pipeline/draft'
import {
  draftInputFor,
  instrumentEvents,
  upcomingEvents,
} from '@/trading/features/suggestion/pipeline/draft-input'
import { joinOrStartSuggestion } from '@/trading/features/suggestion/pipeline/flight'
import { holdFrom } from '@/trading/features/suggestion/pipeline/hold'
import {
  identityOf,
  persistSuggestion,
  reuseOrCooldown,
} from '@/trading/features/suggestion/pipeline/identity'
import { buildLevelsFor } from '@/trading/features/suggestion/pipeline/levels'
import { openRiskOf } from '@/trading/features/suggestion/pipeline/open-risk'
import { longestOutcomeWindowSessions } from '@/trading/features/suggestion/pipeline/outcome-window'
import { runStages } from '@/trading/features/suggestion/pipeline/stages'
import { outsideFocus, unsupported } from '@/trading/features/suggestion/pipeline/unsupported'
import { eventsFromDay, standingMarginEvent } from '@/trading/kernel/market/margin-status'
import { isOutsideFocus, runHorizon } from '@/trading/kernel/operator/focus'
import { isSourceFailed } from '@/trading/kernel/source/source-result'
import { regimeFor } from '@/trading/markets/macro-risk'

/** The one ordered runner: resolve, reuse and cooldown gates, prepare, deterministic gate stages,
 *  debate, judgment stages, size, persist. There is no alternate path — a market may contribute a
 *  focused stage, but it cannot replace this sequence. */
/** The phases a run reports, in the order they execute. Typed rather than a bare string so the
 *  `trading.progress.suggestion.*` key each one builds is checked against the catalogs. */
type RunPhase =
  | 'resolve'
  | 'cooldown'
  | 'portfolio'
  | 'factors'
  | 'levels'
  | 'gate'
  | 'stages'
  | 'debate'
  | 'persist'
  | 'shared'

export async function runSuggestion(options: SuggestionRunOptions): Promise<SuggestionRunResult> {
  const { deps, request } = options
  reportStage(options, 'resolve')
  const resolution = await deps.markets.resolve({
    ticker: request.ticker,
    ...(request.market === undefined ? {} : { market: request.market }),
    signal: request.signal,
  })

  if (resolution.kind !== 'resolved') {
    return unsupported(resolution)
  }

  if (isOutsideFocus(request.focus, resolution.instrument.market, resolution.sector)) {
    return outsideFocus(resolution)
  }

  return joinOrStartSuggestion(options, resolution, {
    run: (flightRequest) => runResolved({ ...options, request: flightRequest }, resolution),
    onShared: () => reportStage(options, 'shared'),
  })
}

async function runResolved(
  options: SuggestionRunOptions,
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>
): Promise<SuggestionRunResult> {
  const { deps, request } = options

  // Identity and cooldown resolve before any portfolio, source, factor, or persona work: a batch
  // over an already-suggested watchlist must not pay for reads it will discard. A forced run skips
  // the gate outright, so it never names a phase it does not run.
  if (request.force !== true) {
    reportStage(options, 'cooldown')
  }

  const gate = await reuseOrCooldown(options, resolution)

  if (gate !== undefined) {
    return gate
  }

  const prepared = await prepare(options, resolution)
  const stageInput = stageInputFor(prepared, request)
  // Before debate, so a blocked candidate persists its hold without spending a persona call. A
  // draft that already reads hold still debates: the thesis and citations it produces are the only
  // prose the operator gets for that name, and `toHold` keeps both.
  const gated = await timed(options, 'gate', () =>
    runStages(deps.stages.list(), { phases: ['gate'], input: stageInput, draft: prepared.draft })
  )

  if (gated.kind === 'block') {
    return persist(options, gated.draft)
  }

  // No debate where it could only restate the draft's reason: without levels there is nothing to
  // argue, and a market no venue trades never reaches an order.
  if (
    prepared.levels === undefined ||
    (prepared.direction.action === 'hold' && prepared.direction.reasonCode === 'reference-only')
  ) {
    return persist(options, gated.draft)
  }

  return afterDebate(options, prepared, gated)
}

async function afterDebate(
  options: SuggestionRunOptions,
  prepared: Prepared,
  gated: StageRunResult
): Promise<SuggestionRunResult> {
  const { deps, request } = options
  const calibration = await loadCalibration(options, prepared, gated)
  const debate = await timed(options, 'debate', () =>
    deps.runDebate(
      debateInputFor({ options, prepared, gated, calibration }),
      options.roleBudgets,
      request.signal
    )
  )

  if (debate.kind === 'hold') {
    return persist(options, holdFrom(gated.draft, debate))
  }

  const debateView = toStoredDebate(debate.result)
  const staged = await timed(options, 'stages', () =>
    runStages(deps.stages.list(), {
      phases: ['tradeability', 'risk'],
      draft: gated.draft,
      input: stageInputFor(prepared, request),
    })
  )

  return persist(options, {
    ...finalize({
      deps,
      debate,
      draft: staged.draft,
      context: prepared.context,
      manifest: prepared.market.manifest,
      trailsStop: prepared.market.trail !== undefined,
      regimeScale: itemRegime(prepared).scale,
      calibration,
      ...(prepared.sector === undefined ? {} : { sector: prepared.sector }),
      ...(prepared.instrumentKind === undefined ? {} : { instrumentKind: prepared.instrumentKind }),
      ...(prepared.medianTurnover === undefined ? {} : { medianTurnover: prepared.medianTurnover }),
      ...(prepared.levels === undefined ? {} : { levels: prepared.levels }),
      ...(prepared.dailyBand === undefined ? {} : { dailyBand: prepared.dailyBand }),
      ...(prepared.openRisk === undefined ? {} : { openRisk: prepared.openRisk }),
      direction: prepared.direction,
      now: request.now,
    }),
    debate: debateView,
  })
}

/** The segment this item sits in, which is the only macro read that may cap it. */
function itemRegime(prepared: Prepared): RegimeScale {
  return regimeFor(prepared.context.regimes, prepared.market.manifest.segment)
}

/** What both stage passes measure a draft against, read off the one `prepare` result so a stage
 *  that ran before the debate judges the same world as the same stage after it. */
function stageInputFor(
  prepared: Prepared,
  request: SuggestionRequest
): Omit<StageInput, 'suggestion'> {
  return {
    market: prepared.market,
    profile: prepared.context.profile,
    valued: prepared.context.book,
    closedRoundTrips: prepared.context.closedRoundTrips,
    regime: itemRegime(prepared),
    factors: prepared.factors.results,
    ...(prepared.factors.failedGates === undefined
      ? {}
      : { failedGates: prepared.factors.failedGates }),
    ...(prepared.factors.signals === undefined ? {} : { signals: prepared.factors.signals }),
    ...(prepared.instrumentKind === undefined ? {} : { instrumentKind: prepared.instrumentKind }),
    ...(prepared.levels === undefined ? {} : { levels: prepared.levels }),
    events: prepared.instrumentEvents,
    ...(prepared.calendarFailed === true ? { calendarFailed: true } : {}),
    now: request.now,
    signal: request.signal,
  }
}

async function prepare(
  options: SuggestionRunOptions,
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>
): Promise<Prepared> {
  const { request } = options
  const market = resolution.market
  const asOf = resolveDay(market, request.now)
  const [context, factors, events] = await readRunInputs(options, resolution, asOf)
  const openRisk = await openRiskOf({ store: options.deps.store, signal: request.signal }, context)
  const calendar = toDraftCalendar(events, resolution.instrument, asOf)
  const horizon = runHorizon(request.focus, context.profile, market.manifest.segment)
  const direction = directionOf(resolution, {
    context,
    factors,
    horizon,
    asOf,
    upcomingEvents: calendar.events,
  })
  const levelsAt = { asOf, direction: levelDirectionFor(direction), horizon, context }
  const priced = await timed(options, 'levels', () =>
    buildLevelsFor(options, resolution, { ...levelsAt, events: calendar.instrumentEvents })
  )
  return {
    market,
    factors,
    context,
    instrument: resolution.instrument,
    horizon,
    identity: identityOf(resolution, asOf, request.focus.key),
    ...calendarFieldsOf(calendar),
    direction,
    ...(openRisk === undefined ? {} : { openRisk }),
    ...optionalFields(resolution, priced),
    draft: buildDraft(
      draftInputFor({
        request,
        resolution,
        asOf,
        direction,
        factors,
        context,
        horizon,
        priced,
        ...calendar,
      })
    ),
  }
}

function directionOf(
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>,
  read: Pick<
    Parameters<typeof draftDirectionFor>[0],
    'context' | 'factors' | 'horizon' | 'asOf' | 'upcomingEvents'
  >
): DraftDirection {
  return draftDirectionFor({
    ...read,
    instrument: resolution.instrument,
    market: resolution.market,
    instrumentKind: resolution.instrumentKind,
  })
}

/** The facts a run only sometimes has, kept out of the shape when it has none: absent and explicitly
 *  undefined are the same fact, and only one of them survives `exactOptionalPropertyTypes`. */
function optionalFields(
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>,
  priced: PricedLevels
): Partial<Prepared> {
  const available = priced.result.kind === 'available' ? priced.result : undefined

  return {
    ...(resolution.name === undefined ? {} : { name: resolution.name }),
    ...(resolution.sector === undefined ? {} : { sector: resolution.sector }),
    ...(resolution.instrumentKind === undefined
      ? {}
      : { instrumentKind: resolution.instrumentKind }),
    ...(priced.medianTurnover === undefined ? {} : { medianTurnover: priced.medianTurnover }),
    ...(available?.levels === undefined ? {} : { levels: available.levels }),
    ...(available?.dailyBand === undefined ? {} : { dailyBand: available.dailyBand }),
  }
}

/** The book, the factors and the corporate calendar share nothing until the direction reads them,
 *  so none waits behind another; the book read alone reaches every provider the segment's macro
 *  sits on. The calendar is read back far enough that the margin row in force is inside it. */
function readRunInputs(
  options: SuggestionRunOptions,
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>,
  asOf: TradingDay
): Promise<
  readonly [
    SuggestionPortfolioContext,
    FactorScore,
    SourceResult<readonly MarketEvent[]> | undefined,
  ]
> {
  const { deps, request } = options
  const { instrument } = resolution
  const market = resolution.market

  return Promise.all([
    timed(options, 'portfolio', () =>
      deps.portfolio.read({
        now: request.now,
        signal: request.signal,
        segments: [market.manifest.segment],
      })
    ),
    timed(options, 'factors', () =>
      market.factors({ instrument, asOf, now: request.now, signal: request.signal })
    ),
    market.capabilities.events?.run({
      instrument,
      // The range end, not the run day: `runEvents` asks the capability as of it, so a forward
      // reader sees nothing unless this reaches past today.
      asOf: market.manifest.calendar.addTradingDays(
        asOf,
        longestOutcomeWindowSessions(market.manifest.defaultCalendar)
      ),
      now: request.now,
      fromDay: eventsFromDay(market.manifest.calendar, asOf),
      signal: request.signal,
    }),
  ])
}

/** One read of this name's events answers both halves a draft needs. */
interface DraftCalendar {
  readonly events: readonly MarketEvent[]
  /** Past rows too: an ex-date the stored series has not caught up to moves today's levels. */
  readonly instrumentEvents: readonly MarketEvent[]
  readonly standingMargin?: MarketEvent
  readonly calendarFailed?: true
}

function toDraftCalendar(
  events: SourceResult<readonly MarketEvent[]> | undefined,
  instrument: InstrumentRef,
  asOf: TradingDay
): DraftCalendar {
  const own = instrumentEvents(events, instrument)
  const standing = standingMarginEvent(own, asOf)

  return {
    events: upcomingEvents(own, asOf),
    instrumentEvents: own,
    ...(standing === undefined ? {} : { standingMargin: standing }),
    ...(isSourceFailed(events) ? { calendarFailed: true } : {}),
  }
}

function calendarFieldsOf(
  calendar: DraftCalendar
): Pick<Prepared, 'upcomingEvents' | 'instrumentEvents' | 'calendarFailed'> {
  return {
    upcomingEvents: calendar.events,
    instrumentEvents: calendar.instrumentEvents,
    ...(calendar.calendarFailed === true ? { calendarFailed: true } : {}),
  }
}

function persist(
  options: SuggestionRunOptions,
  suggestion: Suggestion
): Promise<SuggestionRunResult> {
  reportStage(options, 'persist')

  return persistSuggestion(options, suggestion)
}

/** Tells the requesting surface which phase is running; a request without a reporter is a no-op. */
function reportStage(options: SuggestionRunOptions, phase: RunPhase): void {
  options.request.progress?.(`trading.progress.suggestion.${phase}`, {
    ticker: options.request.ticker,
  })
}

/** One debug line per phase, with its elapsed time and the identity it belongs to. Nine lines
 *  answer "which phase is slow" — no metrics framework, no engine event, no config. */
async function timed<T>(
  options: SuggestionRunOptions,
  phase: RunPhase,
  work: () => Promise<T>
): Promise<T> {
  reportStage(options, phase)
  const startedAt = performance.now()
  const result = await work()

  options.deps.logger.debug('trading.suggestion_phase', {
    phase,
    elapsedMs: Math.round(performance.now() - startedAt),
    ticker: options.request.ticker,
  })

  return result
}
