import type { ProviderChain } from '@/core/llm'
import type { Budget } from '@/core/types/budget'
import type { AttemptRecorder } from '@/engine/api'
import type { EnsureMarketData } from '@/trading/features/market-data/ops/ensure'
import type {
  AnalysisFailure,
  AnalysisId,
  AnalysisRecord,
  AnalysisRequest,
  AnalysisResult,
} from '@/trading/features/suggestion/analysis/types'
import type { SuggestionCitation } from '@/trading/features/suggestion/citation'
import type { RoleCallContext, RoleCallDeps } from '@/trading/features/suggestion/debate/call'
import type { CaseEvidence, CaseSubject } from '@/trading/features/suggestion/pipeline/evidence'
import type { DraftCalendar } from '@/trading/features/suggestion/pipeline/market-reads'
import type {
  AnalysisPageOptions,
  AnalysisStore,
} from '@/trading/features/suggestion/store/analysis'
import type { SuggestionRequest } from '@/trading/features/suggestion/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { FactorScore } from '@/trading/kernel/factor'
import type { FactorMetric } from '@/trading/kernel/factor-metric'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { Candle, FundingSnapshot, NewsItem } from '@/trading/kernel/market/market-data'
import type { MarketEvent } from '@/trading/kernel/market/market-event'
import type { MacroRiskView } from '@/trading/kernel/market/market-macro'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { Page } from '@/trading/kernel/store/page'
import type { Market, MarketRegistry, NameContext } from '@/trading/markets/types'
import { abortError } from '@/core/errors'
import { createBudgetSlicesWithin } from '@/engine/api'
import { buildEnsureOptions } from '@/trading/features/market-data/market-data-run'
import { resolveDay } from '@/trading/features/market-data/resolve'
import {
  ANALYSIS_FACTORS_HEADING,
  analysisCasePrompt,
} from '@/trading/features/suggestion/analysis/prompts'
import {
  type ResolvedSubject,
  refusalOf,
  resolveSubject,
} from '@/trading/features/suggestion/analysis/subject'
import { AnalysisError, buildAnalysisId } from '@/trading/features/suggestion/analysis/types'
import { runCasePair } from '@/trading/features/suggestion/debate/call'
import { claimsOf } from '@/trading/features/suggestion/debate/claims'
import {
  AGENT_BUDGET_FRACTION,
  runClaimVerifier,
} from '@/trading/features/suggestion/debate/debate'
import { citationsFrom } from '@/trading/features/suggestion/debate/outcome'
import { playbookOf } from '@/trading/features/suggestion/debate/playbook'
import { buildCaseEvidence, caseText } from '@/trading/features/suggestion/pipeline/evidence'
import {
  readInstrumentEvents,
  toDraftCalendar,
} from '@/trading/features/suggestion/pipeline/market-reads'
import {
  BEAR_ANALYSIS_SCHEMA,
  BULL_ANALYSIS_SCHEMA,
  MAXIMUM_REVIEWED_CLAIMS,
  toAnalysisCase,
} from '@/trading/features/suggestion/pipeline/schemas'
import { ANALYSIS_ROLES, ANALYSIS_WAVES } from '@/trading/kernel/config'
import { DEFAULT_RUN_FOCUS } from '@/trading/kernel/operator/focus'
import { LEVEL_BARS_SESSIONS } from '@/trading/markets/levels'
import {
  backdropReadings,
  barReadings,
  benchmarkOf,
  fundingReadings,
  nearestEvents,
  optionally,
} from '@/trading/markets/name-readings'

/** How many of the name's dated events the analysis lists: the nearest, since a longer list buries
 *  the one that moves the tape. */
const UPCOMING_EVENTS_SHOWN = 3

/** What the persona calls and the headline read need beyond the role runner. */
interface AnalysisDebateDeps extends RoleCallDeps {
  readonly decisionsChain: ProviderChain | undefined
  readonly recordAttempt: AttemptRecorder
}

interface AnalysisServiceDeps {
  readonly markets: MarketRegistry
  readonly store: AnalysisStore
  readonly ensure: EnsureMarketData
  readonly debate: AnalysisDebateDeps
  /** The engine's configured run budget; trading never chooses a currency cap of its own. */
  createAnalysisBudget(): Budget
}

export interface AnalysisService {
  /** Both sides argued and every claim checked, stored only once every call has answered. A
   *  cancelled run throws the abort; a run a role could not finish throws `AnalysisError` and
   *  leaves nothing behind. */
  run(request: AnalysisRequest, signal: AbortSignal): Promise<AnalysisRecord>
  /** Why the name cannot be analyzed at all, read before any key is needed; absent when it can. */
  refusalOf(request: AnalysisRequest, signal: AbortSignal): Promise<AnalysisFailure | undefined>
  list(options: AnalysisPageOptions): Promise<Page<AnalysisRecord, AnalysisId>>
}

export function createAnalysisService(deps: AnalysisServiceDeps): AnalysisService {
  return {
    run: (request, signal) => runAnalysis(deps, toRunRequest(request, signal)),
    refusalOf: (request, signal) => refusalOf(deps.markets, toRunRequest(request, signal)),
    list: (options) => deps.store.listPage(options),
  }
}

function toRunRequest(request: AnalysisRequest, signal: AbortSignal): SuggestionRequest {
  return { ...request, focus: DEFAULT_RUN_FOCUS, signal }
}

/** The same resolve, ensure, factors and events the suggestion pipeline reads, then only the two
 *  waves it shares with the debate: the cases and the verification. Nothing after them runs, so
 *  nothing after them is produced. */
async function runAnalysis(
  deps: AnalysisServiceDeps,
  request: SuggestionRequest
): Promise<AnalysisRecord> {
  const subject = await resolveSubject(deps.markets, request)
  const { market } = subject
  const budget = deps.createAnalysisBudget()
  const budgets = createBudgetSlicesWithin(
    budget,
    budget.remainingUsd() * AGENT_BUDGET_FRACTION,
    ANALYSIS_ROLES.length
  )

  await deps.ensure(buildEnsureOptions(market.manifest.id, request))

  const read = await readEvidence(deps, request, subject)

  budget.charge(read.evidence.headlinesRead.costUsd)

  const context: RoleCallContext = {
    deps: { ...deps.debate, statesRefusals: true },
    request,
    market,
    instrument: subject.instrument,
    instrumentKind: subject.instrumentKind,
    waves: ANALYSIS_WAVES,
    budgets,
    signal: request.signal,
    models: new Set<string>(),
  }
  const result = await argue(context, caseText(read.evidence))
  const record = toRecord({ request, subject, read, result })

  await deps.store.create(record, request.signal)

  return record
}

interface RecordParts {
  readonly request: SuggestionRequest
  readonly subject: ResolvedSubject
  readonly read: EvidenceRead
  readonly result: AnalysisResult
}

function toRecord(parts: RecordParts): AnalysisRecord {
  const { request, subject, read, result } = parts
  const citations = citationsFrom(
    read.evidence.sources,
    [result.bull, result.bear],
    result.verification
  )

  return {
    id: buildAnalysisId(request.now),
    instrument: subject.instrument,
    at: read.asOf,
    authoredLocale: request.locale,
    createdAt: request.now,
    result,
    citations,
    headlines: uncitedHeadlines(read.evidence.sources, citations),
    figures: read.figures,
    currency: subject.market.manifest.currency,
    quoteUnit: subject.market.manifest.quoteUnit,
    ...read.context,
    ...boardScaleOf(subject.market.manifest),
    caveats: read.evidence.caveats,
    ...(read.evidenceThrough === undefined ? {} : { evidenceThrough: read.evidenceThrough }),
    // A reference series is another instrument in another unit: its close is no price of this name
    // to set the live quote against.
    ...(read.evidenceClose === undefined || subject.market.manifest.referenceBarsOnly === true
      ? {}
      : { evidenceClose: read.evidenceClose }),
  }
}

/** The scale the figures' prices are read in, where the market's board prints one. */
function boardScaleOf(
  manifest: ResolvedSubject['market']['manifest']
): Pick<AnalysisRecord, 'boardScale'> {
  const { currency, priceDisplay } = manifest

  return priceDisplay === undefined ? {} : { boardScale: { currency, display: priceDisplay } }
}

/** What the roles were handed and no claim cited, own coverage first as the bundle orders it. */
function uncitedHeadlines(
  sources: ReadonlyMap<string, NewsItem>,
  citations: readonly SuggestionCitation[]
): readonly SuggestionCitation[] {
  const cited = new Set(citations.map((citation) => citation.url))

  return [...sources.values()]
    .filter((item) => !cited.has(item.url))
    .map(({ url, title, publishedAt }) => ({ url, title, publishedAt }))
}

interface EvidenceRead {
  readonly asOf: TradingDay
  readonly figures: readonly FactorMetric[]
  /** What the run read beside the factors: the sector, the dated events and the market's backdrop. */
  readonly context: Pick<AnalysisRecord, 'sector' | 'upcoming' | 'backdrop'>
  readonly evidenceThrough?: TradingDay
  readonly evidenceClose?: number
  readonly evidence: CaseEvidence
}

async function readEvidence(
  deps: AnalysisServiceDeps,
  request: SuggestionRequest,
  subject: ResolvedSubject
): Promise<EvidenceRead> {
  const { market, instrument } = subject
  const { now, signal } = request
  const asOf = resolveDay(market, now)

  const [factors, events, bars, beside] = await Promise.all([
    market.factors({ instrument, asOf, now, signal }),
    readInstrumentEvents({ market, instrument, asOf, now, signal }),
    market.capabilities.bars?.run({ instrument, asOf, now, sessions: LEVEL_BARS_SESSIONS, signal }),
    readBeside(deps, subject, { asOf, now, signal }),
  ])

  const newest = bars?.kind === 'available' ? bars.value[bars.value.length - 1] : undefined
  const evidenceThrough = newest?.at
  const calendar = toDraftCalendar(events, instrument, asOf)

  const evidence = await buildCaseEvidence({
    market,
    subject: subjectOf({
      request,
      subject,
      factors,
      asOf,
      calendar,
      ...(evidenceThrough === undefined ? {} : { evidenceThrough }),
    }),
    ...(deps.debate.decisionsChain === undefined
      ? {}
      : { decisionsChain: deps.debate.decisionsChain }),
    recordAttempt: deps.debate.recordAttempt,
    logger: deps.debate.logger,
  })
  const nameContext = beside.context?.kind === 'available' ? beside.context.value : undefined

  return {
    asOf,
    evidence,
    figures: figuresOf(subject.market, { bars, beside, factors }),
    context: {
      ...(nameContext?.sector === undefined ? {} : { sector: nameContext.sector }),
      ...upcomingOf(calendar.events, asOf),
      ...backdropOf(beside.macro, nameContext?.breadth),
    },
    ...(newest === undefined ? {} : { evidenceThrough: newest.at, evidenceClose: newest.close }),
  }
}

interface FigureReads {
  readonly bars: SourceResult<readonly Candle[]> | undefined
  readonly beside: BesideReads
  readonly factors: FactorScore
}

/** Every reading in one list. The factors' own come last, so one of them replaces a reading of the
 *  same name and window that the bars gave. */
function figuresOf(market: Market, reads: FigureReads): readonly FactorMetric[] {
  const { bars, beside, factors } = reads
  const context = beside.context?.kind === 'available' ? beside.context.value : undefined

  return [
    ...(bars?.kind === 'available'
      ? barReadings({
          manifest: market.manifest,
          candles: bars.value,
          ...(beside.indexBars?.kind === 'available' ? { benchmark: beside.indexBars.value } : {}),
        })
      : []),
    ...(context?.figures ?? []),
    ...(beside.funding?.kind === 'available' ? fundingReadings(beside.funding.value) : []),
    ...factors.results.flatMap((factor) => factor.metrics ?? []),
  ]
}

interface BesideReads {
  readonly indexBars: SourceResult<readonly Candle[]> | undefined
  readonly context: SourceResult<NameContext> | undefined
  readonly macro: SourceResult<MacroRiskView> | undefined
  readonly funding: SourceResult<FundingSnapshot> | undefined
}

/** What the run reads beside the factors, each of which the analysis can do without: the market's
 *  index, what the market holds about the name, its macro series and, where it has one, its
 *  perpetual's positioning. */
async function readBeside(
  deps: AnalysisServiceDeps,
  subject: ResolvedSubject,
  when: { readonly asOf: TradingDay; readonly now: number; readonly signal: AbortSignal }
): Promise<BesideReads> {
  const { market, instrument } = subject
  const { capabilities, manifest } = market
  const benchmark = benchmarkOf(manifest, instrument)
  const read = <T>(name: string, run: Promise<T> | undefined) =>
    optionally(deps.debate.logger, name, run)
  const [indexBars, context, macro, funding] = await Promise.all([
    read(
      'benchmark',
      benchmark === undefined
        ? undefined
        : capabilities.bars?.run({ ...when, instrument: benchmark, sessions: LEVEL_BARS_SESSIONS })
    ),
    read('context', capabilities.context?.run({ ...when, instrument })),
    read('macro', capabilities.macroRisk?.run({ ...when, region: manifest.region })),
    read('funding', capabilities.funding?.run({ ...when, instrument })),
  ])

  return { indexBars, context, macro, funding }
}

function upcomingOf(
  events: readonly MarketEvent[],
  asOf: TradingDay
): Pick<AnalysisRecord, 'upcoming'> {
  const upcoming = nearestEvents(events, asOf, UPCOMING_EVENTS_SHOWN)

  return upcoming.length === 0 ? {} : { upcoming }
}

function backdropOf(
  macro: SourceResult<MacroRiskView> | undefined,
  breadth: NonNullable<AnalysisRecord['backdrop']>['breadth']
): Pick<AnalysisRecord, 'backdrop'> {
  const readings = macro?.kind === 'available' ? backdropReadings(macro.value) : []

  return readings.length === 0 && breadth === undefined
    ? {}
    : { backdrop: { macro: readings, ...(breadth === undefined ? {} : { breadth }) } }
}

interface SubjectParts {
  readonly request: SuggestionRequest
  readonly subject: ResolvedSubject
  readonly factors: FactorScore
  readonly asOf: TradingDay
  readonly calendar: DraftCalendar
  readonly evidenceThrough?: TradingDay
}

/** No draft, so no reference price: a price level in the factor rows prints bare. */
function subjectOf(parts: SubjectParts): CaseSubject {
  const { request, subject, calendar } = parts

  return {
    request,
    factors: parts.factors,
    instrument: subject.instrument,
    asOf: parts.asOf,
    factorsHeading: ANALYSIS_FACTORS_HEADING,
    withoutAnalystCoverage: true,
    ...(parts.evidenceThrough === undefined ? {} : { evidenceThrough: parts.evidenceThrough }),
    ...(subject.name === undefined ? {} : { name: subject.name }),
    ...(subject.sector === undefined ? {} : { sector: subject.sector }),
    ...(calendar.events.length === 0 ? {} : { upcomingEvents: calendar.events }),
    ...(calendar.recent.length === 0 ? {} : { recentEvents: calendar.recent }),
    ...(calendar.calendarFailed === true ? { calendarFailed: true } : {}),
  }
}

/** Every claim both sides made is checked, up to the cap the verifier's own schema is sized to:
 *  with no synthesis to pick the claims a case leans on, none of them is optional. */
async function argue(context: RoleCallContext, evidenceText: string): Promise<AnalysisResult> {
  const evidence = { text: evidenceText }
  const cases = await runCasePair(context, {
    bull: {
      role: 'bull-researcher',
      schema: BULL_ANALYSIS_SCHEMA,
      prompt: () => analysisCasePrompt({ evidence }, 'bull-researcher'),
    },
    bear: {
      role: 'bear-researcher',
      schema: BEAR_ANALYSIS_SCHEMA,
      prompt: () => analysisCasePrompt({ evidence }, 'bear-researcher'),
    },
  })

  if (cases.kind === 'failed') {
    throw incomplete(context.signal, cases.caveat)
  }

  const bull = toAnalysisCase(cases.value.bull)
  const bear = toAnalysisCase(cases.value.bear)
  const material = [
    ...claimsOf('bull-researcher', bull),
    ...claimsOf('bear-researcher', bear),
  ].slice(0, MAXIMUM_REVIEWED_CLAIMS)
  const verified = await runClaimVerifier(context, { evidence, material, invalidators: [] })

  if (verified.kind === 'failed') {
    throw incomplete(context.signal, verified.caveat)
  }

  return {
    bull,
    bear,
    verification: verified.value,
    claims: material.map(({ id, text }) => ({ id, text })),
    playbook: playbookOf(ANALYSIS_ROLES, context.market.manifest, context.instrumentKind),
    models: [...context.models].sort(),
  }
}

/** A caller's own cancellation is the abort, not a role's failure to answer. */
function incomplete(signal: AbortSignal, caveat: Caveat): Error {
  return signal.aborted
    ? abortError(signal)
    : new AnalysisError({ kind: 'incomplete', caveat }, 'a role of the analysis did not answer')
}
