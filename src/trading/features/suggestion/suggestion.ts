import type { Logger } from '@/core/logging/logger'
import type { Budget } from '@/core/types/budget'
import type { EnsureMarketData } from '@/trading/features/market-data/ops/refresh'
import type { MarketDataRequest } from '@/trading/features/market-data/types'
import type { ProfileStore } from '@/trading/features/profile/store'
import type {
  SuggestionBatchItem,
  SuggestionBatchOptions,
  SuggestionBatchRequest,
  SuggestionBatchResult,
} from '@/trading/features/suggestion/batch-types'
import type { ScoredRow } from '@/trading/features/suggestion/pipeline/attribution'
import type { SuggestionBatchInput } from '@/trading/features/suggestion/pipeline/batch'
import type {
  RunDebate,
  SuggestionFlights,
  SuggestionPortfolioReader,
} from '@/trading/features/suggestion/pipeline/types'
import type { AgentFocusStore } from '@/trading/features/suggestion/store/agent-focus'
import type { SuggestionStore } from '@/trading/features/suggestion/store/suggestion'
import type {
  SuggestionDayOptions,
  SuggestionDayRead,
} from '@/trading/features/suggestion/store/suggestion-day'
import type { SuggestionPageOptions } from '@/trading/features/suggestion/store/suggestion-list'
import type { ActedSummary, RecordedFill } from '@/trading/features/suggestion/track-record/acted'
import type {
  AgentFocusRef,
  AgentRecordView,
  FocusRecordView,
} from '@/trading/features/suggestion/track-record/agent-record'
import type { OutcomeResolutionDeps } from '@/trading/features/suggestion/track-record/outcome'
import type { CallScoredNotices } from '@/trading/features/suggestion/track-record/scored-notice'
import type {
  ListResolvedSuggestionsOptions,
  OutcomeResolutionBatch,
  TrackRecordOptions,
  TrackRecordReport,
} from '@/trading/features/suggestion/track-record/types'
import type {
  ResolvedActionableSuggestion,
  StoredSuggestion,
  SuggestionId,
  SuggestionRequest,
  SuggestionRunResult,
} from '@/trading/features/suggestion/types'
import type { DebateMode, SuggestionPolicy, TradingConfig } from '@/trading/kernel/config'
import type { MarketRef, PortfolioSegment, TradingDay } from '@/trading/kernel/instrument'
import type { OperationTickOptions, Page } from '@/trading/kernel/store/page'
import type { StageRegistry } from '@/trading/markets/stage'
import type { Market, MarketRegistry } from '@/trading/markets/types'
import { ValidationError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { buildEnsureOptions } from '@/trading/features/market-data/market-data-run'
import { resolveInstrument } from '@/trading/features/market-data/resolve'
import { uniqueItems, watchlistItems } from '@/trading/features/suggestion/batch-items'
import { suggestionScoredRow } from '@/trading/features/suggestion/pipeline/attribution'
import { runSuggestionBatch } from '@/trading/features/suggestion/pipeline/batch'
import {
  independentCalls,
  MINIMUM_TRACK_RECORD_SAMPLE,
  summarizeTrackRecord,
} from '@/trading/features/suggestion/pipeline/reporting'
import { summarizeActed } from '@/trading/features/suggestion/track-record/acted'
import {
  buildAgentRecords,
  buildFocusRecords,
  parseListedFocus,
} from '@/trading/features/suggestion/track-record/agent-record'
import { coverageOf } from '@/trading/features/suggestion/track-record/coverage'
import {
  buildModelRecords,
  type ModelRecord,
} from '@/trading/features/suggestion/track-record/model-record'
import { resolvePendingOutcomes } from '@/trading/features/suggestion/track-record/outcome'
import { DEFAULT_FOCUS_KEY } from '@/trading/kernel/operator/focus'
import { marketRoundTripRate } from '@/trading/markets/cost'
import { SURFACE_LIMITS } from '@/trading/surface-limits'

interface SuggestionServiceDeps {
  readonly markets: MarketRegistry
  readonly stages: StageRegistry
  readonly store: SuggestionStore
  readonly agentFocuses: AgentFocusStore
  readonly profiles: ProfileStore
  readonly portfolio: SuggestionPortfolioReader
  /** The operator's own buys and sells since a day, read from the ledger. */
  fills(options: {
    readonly fromDay: TradingDay
    readonly signal: AbortSignal
  }): Promise<readonly RecordedFill[]>
  readonly config: TradingConfig
  readonly logger: Logger
  readonly runDebate: RunDebate
  /** Where a call the track record has just scored is told. */
  readonly notices: CallScoredNotices
  readonly ensure: EnsureMarketData
  /** The engine's configured run budget, minted once per logical batch. Trading never chooses a
   *  currency cap and never constructs an unlimited budget of its own. */
  createSuggestionBudget(): Budget
  readonly skillVersions?: readonly string[]
  readonly personaVersions?: readonly string[]
}

export interface SuggestionService {
  run(request: SuggestionRequest): Promise<SuggestionRunResult>
  runBatch(request: SuggestionBatchRequest): Promise<SuggestionBatchResult>
  list(options: ListSuggestionsOptions): Promise<Page<StoredSuggestion, SuggestionId>>
  get(id: SuggestionId, signal: AbortSignal): Promise<StoredSuggestion | null>
  listResolved(
    options: ListResolvedSuggestionsOptions
  ): Promise<readonly ResolvedActionableSuggestion[]>
  resolvePending(options: OperationTickOptions<SuggestionId>): Promise<OutcomeResolutionBatch>
  summarize(options: TrackRecordOptions): Promise<TrackRecordReport>
  /** The track record plus how the calls that played out were used: taken or passed on, and what
   *  getting in cost against the plan. `acted` is absent while no call has resolved. */
  reflect(options: TrackRecordOptions): Promise<TrackRecordReflection>
  /** What each agent's calls have earned, together and per focus, and how they sit beside the
   *  other agents'. */
  agentRecords(options: AgentRecordsOptions): Promise<readonly AgentRecordView[]>
  /** The same record per focus, the operator's own included, for `/reflect`. */
  focusRecords(options: { readonly signal: AbortSignal }): Promise<readonly FocusRecordView[]>
  /** What each model earned on the calls it argued alone. */
  modelRecords(signal: AbortSignal): Promise<readonly ModelRecord[]>
  /** What one operator day added: the calls made and the largest closes. */
  dayDigest(options: SuggestionDayOptions): Promise<SuggestionDayRead>
}

interface ListSuggestionsOptions extends Omit<SuggestionPageOptions, 'focusKey'> {
  /** The focus as the caller named it; refused when no agent has called under it. Absent reads the
   *  operator's own. */
  readonly focusKey?: string
}

interface AgentRecordsOptions {
  readonly agents: readonly AgentFocusRef[]
  readonly signal: AbortSignal
}

export interface TrackRecordReflection {
  readonly report: TrackRecordReport
  /** The report's rows as attribution reads them, each on the long side net of its market's fee. */
  readonly factorRows: readonly ScoredRow[]
  readonly acted?: ActedSummary
}

export function createSuggestionService(deps: SuggestionServiceDeps): SuggestionService {
  const batchDeps = toBatchDeps(deps, new Map())

  return {
    run: (request) => runOne({ deps, batchDeps }, request),
    runBatch: (request) => runMany({ deps, batchDeps }, request),

    list: (options) => listSuggestions(deps, options),
    get: (id, signal) => deps.store.findById(id, signal),
    listResolved: (options) => deps.store.listResolved(options),
    resolvePending: (options) => resolvePendingOutcomes(toOutcomeDeps(deps), options),
    summarize: (options) => summarize(deps, options),
    reflect: (options) => reflect(deps, options),
    agentRecords: (options) => buildAgentRecords(deps, { ...options, ...recordClock(deps) }),
    focusRecords: (options) => buildFocusRecords(deps, { ...options, ...recordClock(deps) }),
    modelRecords: async (signal) => buildModelRecords(await deps.store.listScoredByModel(signal)),
    dayDigest: (options) => deps.store.readDay(options),
  }
}

function recordClock(deps: SuggestionServiceDeps): { now: number; timezone: string } {
  return { now: Date.now(), timezone: deps.config.displayTimezone }
}

async function listSuggestions(
  deps: SuggestionServiceDeps,
  options: ListSuggestionsOptions
): Promise<Page<StoredSuggestion, SuggestionId>> {
  const focusKey = await parseListedFocus(deps, options.focusKey, options.signal)

  return deps.store.listPage({ ...options, focusKey })
}

interface RunScope {
  readonly deps: SuggestionServiceDeps
  readonly batchDeps: SuggestionBatchInput['deps']
}

/** A single request is a batch of one, so cooldown, identity, budget slicing, and the shared
 *  portfolio read are decided in exactly one place regardless of how the caller arrived. */
async function runOne(scope: RunScope, request: SuggestionRequest): Promise<SuggestionRunResult> {
  const { deps, batchDeps } = scope
  const item = itemOf(request)
  const policy = policyFor(deps.config.suggestions, request.debateMode)
  const markets = await resolveItemMarkets(deps, [item], request.signal)

  await ensureSuggestionMarkets(deps, markets, {
    now: request.now,
    signal: request.signal,
  })

  const { results } = await runSuggestionBatch({
    deps: batchDeps,
    options: {
      ...sharedOptions(request),
      items: [item],
      segments: segmentsOf(markets),
      budget: deps.createSuggestionBudget(),
      policy,
      ...(request.debateMode === undefined ? {} : { debateMode: request.debateMode }),
    },
  })
  const result = results[0]

  if (result === undefined) {
    throw new ValidationError(`suggestion run produced no result for ${request.ticker}`)
  }

  await recordFocusUsed(deps, request, [result])

  return result
}

async function runMany(
  scope: RunScope,
  request: SuggestionBatchRequest
): Promise<SuggestionBatchResult> {
  const { deps, batchDeps } = scope
  const items = await resolveItems(deps, request)
  const markets = await resolveItemMarkets(deps, items, request.signal)

  await ensureSuggestionMarkets(deps, markets, {
    now: request.now,
    signal: request.signal,
  })

  const batch = await runSuggestionBatch({
    deps: batchDeps,
    options: {
      ...sharedOptions(request),
      items,
      segments: segmentsOf(markets),
      budget: request.budget ?? deps.createSuggestionBudget(),
      policy: policyFor(deps.config.suggestions, request.debateMode),
      ...(request.debateMode === undefined ? {} : { debateMode: request.debateMode }),
    },
  })

  await recordFocusUsed(deps, request, batch.results)

  return batch
}

/** The one place a requested debate mode overrides the configured one, so the role count, the
 *  budget slices, and the debate itself can never disagree about how deep the run goes. */
function policyFor(configured: SuggestionPolicy, requested?: DebateMode): SuggestionPolicy {
  return requested === undefined ? configured : { ...configured, debateMode: requested }
}

/** The scorer charges each market's own default venue, so it needs the cost table and the venue map
 *  beside the registry it already reads. */
function toOutcomeDeps(deps: SuggestionServiceDeps): OutcomeResolutionDeps {
  return {
    markets: deps.markets,
    store: deps.store,
    logger: deps.logger,
    notices: deps.notices,
    costs: deps.config.costs,
    defaultVenues: deps.config.defaultVenues,
  }
}

function toBatchDeps(
  deps: SuggestionServiceDeps,
  flights: SuggestionFlights
): SuggestionBatchInput['deps'] {
  return {
    markets: deps.markets,
    stages: deps.stages,
    store: deps.store,
    portfolio: deps.portfolio,
    logger: deps.logger,
    runDebate: deps.runDebate,
    flights,
    roundTripFeeFraction: (market) => marketRoundTripRate(deps.config, market),
    ...(deps.skillVersions === undefined ? {} : { skillVersions: deps.skillVersions }),
    ...(deps.personaVersions === undefined ? {} : { personaVersions: deps.personaVersions }),
  }
}

type SharedOptions = Omit<SuggestionBatchOptions, 'items' | 'segments' | 'budget' | 'policy'>

function sharedOptions(request: SuggestionRequest | SuggestionBatchRequest): SharedOptions {
  return {
    channel: request.channel,
    billingSessionId: request.billingSessionId,
    focus: request.focus,
    now: request.now,
    signal: request.signal,
    ...(request.agentId === undefined ? {} : { agentId: request.agentId }),
    ...(request.billingAgentId === undefined ? {} : { billingAgentId: request.billingAgentId }),
    ...(request.parentRunId === undefined ? {} : { parentRunId: request.parentRunId }),
    ...(request.progress === undefined ? {} : { progress: request.progress }),
  }
}

/** Remembers which focus an agent has called under, so a record outlives an edit to its `[focus]`.
 *  A failed write never fails the run it follows. */
async function recordFocusUsed(
  deps: SuggestionServiceDeps,
  request: SuggestionRequest | SuggestionBatchRequest,
  results: readonly SuggestionRunResult[]
): Promise<void> {
  if (request.agentId === undefined || !results.some((result) => result.kind === 'completed')) {
    return
  }

  try {
    await deps.agentFocuses.record({
      agentId: request.agentId,
      focusKey: request.focus.key,
      ...(request.focus.focus === undefined ? {} : { focus: request.focus.focus }),
      at: request.now,
      signal: request.signal,
    })
  } catch (err: unknown) {
    deps.logger.warn('trading.agent_focus_unrecorded', { err: formatErrForLog(err) })
  }
}

function itemOf(request: SuggestionRequest): SuggestionBatchItem {
  return {
    locale: request.locale,
    ticker: request.ticker,
    ...(request.market === undefined ? {} : { market: request.market }),
    ...(request.force === undefined ? {} : { force: request.force }),
  }
}

/** Watchlist expansion happens here because only the service holds a profile store — a tool that
 *  wanted the same list would have to reach past this seam to get it. */
async function resolveItems(
  deps: SuggestionServiceDeps,
  request: SuggestionBatchRequest
): Promise<readonly SuggestionBatchItem[]> {
  const { scope } = request

  if (scope.kind === 'items') {
    return uniqueItems(scope.items).slice(0, SURFACE_LIMITS.maximumSuggestionBatchItems)
  }

  const profile = await deps.profiles.find(request.signal)

  return profile === null ? [] : watchlistItems(deps.markets, scope, profile)
}

/** The distinct markets the items resolve to. An item that resolves to nothing is reported by its
 *  own run, so it contributes no market here. */
async function resolveItemMarkets(
  deps: SuggestionServiceDeps,
  items: readonly SuggestionBatchItem[],
  signal: AbortSignal
): Promise<readonly Market[]> {
  const markets = new Map<MarketRef, Market>()

  for (const item of items) {
    const resolved = await resolveInstrument(deps.markets, {
      ticker: item.ticker,
      ...(item.market === undefined ? {} : { market: item.market }),
      signal,
    })

    if (resolved.kind === 'resolved') {
      markets.set(resolved.market.manifest.id, resolved.market)
    }
  }

  return [...markets.values()]
}

function segmentsOf(markets: readonly Market[]): readonly PortfolioSegment[] {
  return [...new Set(markets.map((market) => market.manifest.segment))]
}

async function ensureSuggestionMarkets(
  deps: SuggestionServiceDeps,
  markets: readonly Market[],
  request: MarketDataRequest
): Promise<void> {
  for (const market of markets) {
    await deps.ensure(buildEnsureOptions(market.manifest.id, request))
  }
}

async function summarize(
  deps: SuggestionServiceDeps,
  options: TrackRecordOptions
): Promise<TrackRecordReport> {
  // The operator's record unless a focus is named: a focus call is a second opinion the operator
  // never acted on.
  const focusKeys = [options.focusKey ?? DEFAULT_FOCUS_KEY]
  const rows = await deps.store.listResolved({
    limit: options.limit,
    focusKeys,
    ...(options.strategyVersion === undefined ? {} : { strategyVersion: options.strategyVersion }),
    signal: options.signal,
  })
  const summary = summarizeTrackRecord(rows, MINIMUM_TRACK_RECORD_SAMPLE)
  const coverage = coverageOf(
    await deps.store.coverage({
      focusKeys,
      ...(options.strategyVersion === undefined
        ? {}
        : { strategyVersion: options.strategyVersion }),
      signal: options.signal,
    }),
    deps.markets
  )

  return { summary: { ...summary, coverage }, recent: rows }
}

async function reflect(
  deps: SuggestionServiceDeps,
  options: TrackRecordOptions
): Promise<TrackRecordReflection> {
  const report = await summarize(deps, options)
  const oldest = report.recent.reduce<TradingDay | undefined>(
    (day, call) => (day === undefined || call.at < day ? call.at : day),
    undefined
  )
  const calls = independentCalls(report.recent)
  const factorRows = calls.map((row) =>
    suggestionScoredRow(row, marketRoundTripRate(deps.config, row.instrument.market))
  )

  if (oldest === undefined) {
    return { report, factorRows }
  }

  const fills = await deps.fills({ fromDay: oldest, signal: options.signal })

  return { report, factorRows, acted: summarizeActed(calls, fills) }
}
