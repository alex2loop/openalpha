import type { ProviderChain } from '@/core/llm'
import type { Budget } from '@/core/types/budget'
import type { AttemptRecorder } from '@/engine/api'
import type { EnsureMarketData } from '@/trading/features/market-data/ops/ensure'
import type {
  AnalysisId,
  AnalysisRecord,
  AnalysisRequest,
  AnalysisResult,
} from '@/trading/features/suggestion/analysis/types'
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
import type { TradingDay } from '@/trading/kernel/instrument'
import type { Page } from '@/trading/kernel/store/page'
import type { MarketRegistry, MarketResolution } from '@/trading/markets/types'
import { abortError } from '@/core/errors'
import { createBudgetSlicesWithin } from '@/engine/api'
import { buildEnsureOptions } from '@/trading/features/market-data/market-data-run'
import { resolveDay } from '@/trading/features/market-data/resolve'
import {
  ANALYSIS_FACTORS_HEADING,
  analysisCasePrompt,
} from '@/trading/features/suggestion/analysis/prompts'
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
  list(options: AnalysisPageOptions): Promise<Page<AnalysisRecord, AnalysisId>>
}

type ResolvedSubject = Extract<MarketResolution, { readonly kind: 'resolved' }>

export function createAnalysisService(deps: AnalysisServiceDeps): AnalysisService {
  return {
    run: (request, signal) => runAnalysis(deps, { ...request, focus: DEFAULT_RUN_FOCUS, signal }),
    list: (options) => deps.store.listPage(options),
  }
}

/** The same resolve, ensure, factors and events the suggestion pipeline reads, then only the two
 *  waves it shares with the debate: the cases and the verification. Nothing after them runs, so
 *  nothing after them is produced. */
async function runAnalysis(
  deps: AnalysisServiceDeps,
  request: SuggestionRequest
): Promise<AnalysisRecord> {
  const subject = await resolveSubject(deps, request)
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
    instrumentKind: subject.instrumentKind,
    waves: ANALYSIS_WAVES,
    budgets,
    signal: request.signal,
    models: new Set<string>(),
  }
  const result = await argue(context, caseText(read.evidence))
  const record: AnalysisRecord = {
    id: buildAnalysisId(request.now),
    instrument: subject.instrument,
    at: read.asOf,
    authoredLocale: request.locale,
    createdAt: request.now,
    result,
    citations: citationsFrom(
      read.evidence.sources,
      [result.bull, result.bear],
      result.verification
    ),
    caveats: read.evidence.caveats,
    ...(read.evidenceThrough === undefined ? {} : { evidenceThrough: read.evidenceThrough }),
  }

  await deps.store.create(record, request.signal)

  return record
}

async function resolveSubject(
  deps: AnalysisServiceDeps,
  request: SuggestionRequest
): Promise<ResolvedSubject> {
  const resolution = await deps.markets.resolve({
    ticker: request.ticker,
    ...(request.market === undefined ? {} : { market: request.market }),
    operatorRead: true,
    signal: request.signal,
  })

  if (resolution.kind !== 'resolved') {
    throw new AnalysisError({ kind: 'unresolved', resolution }, `cannot analyse ${request.ticker}`)
  }

  return resolution
}

interface EvidenceRead {
  readonly asOf: TradingDay
  readonly evidenceThrough?: TradingDay
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

  const [factors, events, bars] = await Promise.all([
    market.factors({ instrument, asOf, now, signal }),
    readInstrumentEvents({ market, instrument, asOf, now, signal }),
    market.capabilities.bars?.run({ instrument, asOf, now, sessions: LEVEL_BARS_SESSIONS, signal }),
  ])

  const newest = bars?.kind === 'available' ? bars.value[bars.value.length - 1] : undefined
  const evidenceThrough = newest?.at

  const evidence = await buildCaseEvidence({
    market,
    subject: subjectOf({
      request,
      subject,
      factors,
      asOf,
      calendar: toDraftCalendar(events, instrument, asOf),
      ...(evidenceThrough === undefined ? {} : { evidenceThrough }),
    }),
    ...(deps.debate.decisionsChain === undefined
      ? {}
      : { decisionsChain: deps.debate.decisionsChain }),
    recordAttempt: deps.debate.recordAttempt,
    logger: deps.debate.logger,
  })

  return { asOf, evidence, ...(evidenceThrough === undefined ? {} : { evidenceThrough }) }
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
