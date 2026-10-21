import type { ToolAudience, ToolInvocationContext } from '@/core/tool'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type {
  BatchOvercommit,
  SuggestionBatchResult,
} from '@/trading/features/suggestion/batch-types'
import type { HeadlinesRead } from '@/trading/features/suggestion/citation'
import type { HeldPosition } from '@/trading/features/suggestion/exposure'
import type { CalibrationBucket } from '@/trading/features/suggestion/track-record/calibration'
import type {
  TrackRecordReport,
  TrackRecordSummary,
} from '@/trading/features/suggestion/track-record/types'
import type {
  ActionableStoredSuggestion,
  PriceBandNote,
  ResolvedActionableSuggestion,
  StoredSuggestion,
  SuggestionOutcome,
  SuggestionQuote,
  SuggestionRunResult,
} from '@/trading/features/suggestion/types'
import type { FactorComposite, FactorResult } from '@/trading/kernel/factor'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { CapBreach } from '@/trading/kernel/operator/exposure'
import type { PriceWriter, WrittenQuote } from '@/trading/kernel/surface/agent-json'
import { bankedShareOf, heldFirstExitOf } from '@/trading/features/suggestion/exit-plan/first-exit'
import { shownCall } from '@/trading/features/suggestion/render/second-opinion'
import { renderHoldReasons } from '@/trading/features/suggestion/render/verdict'
import { fractionToPct, writtenQuote } from '@/trading/kernel/surface/agent-json'
import { renderScoreBand } from '@/trading/render/format'
import { formatScaledPrice } from '@/trading/render/money'

/** Top-level fields a tool must never hand a model: an absolute figure added to `Suggestion` belongs
 *  here on the same commit. `units` is not on it: the order quantity reaches the operator's own
 *  client, and only that. */
type OperatorOnlyField = 'held' | 'policyUnits'

/** Fields the model reads in its own convention: prices written as the board quotes them, a score
 *  as its band, a share in percent. */
type RewrittenField =
  | 'entry'
  | 'stop'
  | 'target'
  | 'takeProfit'
  | 'atr'
  | 'raisedStopFrom'
  | 'quote'
  | 'composite'
  | 'factorScores'
  | 'takeProfitTranchePct'
  | 'standingExit'
  | 'standingTakeProfit'
  | 'priceBand'
  | 'headlinesRead'

type HoldStoredSuggestion = Extract<StoredSuggestion, { readonly action: 'hold' }>

export type AgentMarketData = Pick<MarketDataService, 'quoteConvention' | 'boardLot' | 'trailsStop'>

/** Who reads the projection: `audience` decides whether the order quantity ships, `locale` the
 *  language every written value is in, and `marketData` how each market quotes and trades. */
interface AgentReader extends Pick<ToolInvocationContext, 'audience' | 'locale'> {
  readonly marketData: AgentMarketData
}

/** What the operator holds, as a model may know it: the shape of the position and its weight, never
 *  its size or its cost. */
interface HeldWeight {
  readonly openLotCount: number
  readonly firstAcquiredAt?: TradingDay
  readonly pctNav?: number
}

/** The first sale on a held name, as a share of what is held today - never a unit count, which
 *  would give away the size of the position. */
type AgentHeldTakeProfit =
  | { readonly kind: 'taken' }
  | { readonly kind: 'sell'; readonly sellPct: number }

/** The venue's band in percent, as a model reads every `Pct`; the floor and ceiling are prices. */
type AgentPriceBand = Omit<PriceBandNote, 'maximumUpPct' | 'maximumDownPct'> & {
  readonly maximumUpPct: number
  readonly maximumDownPct: number
}

type AgentFactor = Omit<FactorResult, 'score' | 'provenance'> & { readonly band: string }

interface AgentFields {
  readonly entry?: string
  readonly stop?: string
  readonly target?: string
  readonly takeProfit?: string
  readonly atr?: string
  readonly raisedStopFrom?: string
  readonly quote?: WrittenQuote<SuggestionQuote>
  readonly composite: Omit<FactorComposite, 'score'>
  readonly factorScores: readonly AgentFactor[]
  readonly takeProfitTranchePct?: number
  readonly standingExit?: { readonly stop: string; readonly takeProfit: string }
  readonly heldTakeProfit?: AgentHeldTakeProfit
  readonly held?: HeldWeight
  /** A model never sees LLM spend, so the read's cost stays behind. */
  readonly headlinesRead?: Omit<HeadlinesRead, 'costUsd'>
}

type AgentSuggestion =
  | (Omit<ActionableStoredSuggestion, OperatorOnlyField | RewrittenField> &
      AgentFields & { readonly units?: number; readonly priceBand?: AgentPriceBand })
  | (Omit<HoldStoredSuggestion, OperatorOnlyField | RewrittenField> &
      AgentFields & {
        /** `holdReasonCodes` in the operator's words, so the model explains a hold without guessing. */
        readonly holdReasons: readonly string[]
      })

/** A run result whose stored suggestion has been rewritten for its reader. */
type RunResultOf<S> =
  | { readonly kind: 'completed'; readonly suggestion: S; readonly reused: boolean }
  | Extract<SuggestionRunResult, { readonly kind: 'unsupported' }>
  | Extract<SuggestionRunResult, { readonly kind: 'error' }>
  | { readonly kind: 'cooldown'; readonly previous: S; readonly eligibleAfter: TradingDay }

type AgentRunResult = RunResultOf<AgentSuggestion>

interface AgentBatchResult {
  readonly results: readonly AgentRunResult[]
  readonly breaches: readonly CapBreach[]
  readonly overcommit: readonly BatchOvercommit[]
}

/** A scored call as the record lists it: which call, the levels it named and how it ended. */
interface AgentScoredCall
  extends Pick<
    ResolvedActionableSuggestion,
    'instrument' | 'at' | 'strategyVersion' | 'horizon' | 'conviction' | 'action' | 'probability'
  > {
  readonly entry: string
  readonly stop: string
  readonly target: string
  readonly takeProfit: string
  readonly outcome: SuggestionOutcome
}

interface AgentTrackRecordReport {
  readonly summary: TrackRecordSummary
  readonly recent: readonly AgentScoredCall[]
}

export function toAgentRunResult(result: SuggestionRunResult, reader: AgentReader): AgentRunResult {
  return mapStoredSuggestion(result, (suggestion) => toAgentSuggestion(suggestion, reader))
}

/** The run as a model's report may print it: the policy size never, and the order quantity only
 *  for the operator's own client. The holding stays, because the report states its weight. */
export function toReportResult(
  result: SuggestionRunResult,
  audience: ToolAudience
): SuggestionRunResult {
  return mapStoredSuggestion(result, (suggestion) => toReportSuggestion(suggestion, audience))
}

export function toAgentBatchResult(
  batch: SuggestionBatchResult,
  reader: AgentReader
): AgentBatchResult {
  return { ...batch, results: batch.results.map((result) => toAgentRunResult(result, reader)) }
}

export function toAgentTrackRecord(
  report: TrackRecordReport,
  reader: AgentReader
): AgentTrackRecordReport {
  return {
    summary: agentSummary(report.summary),
    recent: report.recent.map((suggestion) => toScoredCall(suggestion, reader)),
  }
}

/** Only the two arms that carry a stored suggestion have one to rewrite. */
function mapStoredSuggestion<S>(
  result: SuggestionRunResult,
  rewrite: (suggestion: StoredSuggestion) => S
): RunResultOf<S> {
  if (result.kind === 'completed') {
    return { ...result, suggestion: rewrite(result.suggestion) }
  }

  if (result.kind === 'cooldown') {
    return { ...result, previous: rewrite(result.previous) }
  }

  return result
}

/** Narrowed first so each arm destructures a concrete shape: the order quantities exist only on the
 *  actionable one, and a rest over the bare union would keep them without saying so. */
function toAgentSuggestion(call: StoredSuggestion, reader: AgentReader): AgentSuggestion {
  // A second opinion carries nothing of the operator's book: a woken agent could repeat it in public.
  const suggestion = shownCall(call)
  const fields = agentFields(suggestion, reader)

  if (suggestion.action === 'hold') {
    return toAgentHold(suggestion, fields, reader)
  }

  const {
    held: _held,
    units,
    sizePctNav,
    policyUnits: _policyUnits,
    priceBand,
    entry: _entry,
    stop: _stop,
    target: _target,
    takeProfit: _takeProfit,
    atr: _atr,
    raisedStopFrom: _raisedStopFrom,
    quote: _quote,
    composite: _composite,
    factorScores: _factorScores,
    takeProfitTranchePct: _tranche,
    standingExit: _standingExit,
    standingTakeProfit: _standingTakeProfit,
    headlinesRead: _headlinesRead,
    ...rest
  } = suggestion

  return {
    ...rest,
    ...fields,
    ...(sizePctNav === undefined ? {} : { sizePctNav }),
    ...(priceBand === undefined ? {} : { priceBand: agentPriceBand(priceBand) }),
    ...operatorUnits(reader.audience, units),
  }
}

function toAgentHold(
  suggestion: HoldStoredSuggestion,
  fields: AgentFields,
  reader: AgentReader
): AgentSuggestion {
  const {
    held: _held,
    entry: _entry,
    stop: _stop,
    target: _target,
    takeProfit: _takeProfit,
    raisedStopFrom: _raisedStopFrom,
    quote: _quote,
    composite: _composite,
    factorScores: _factorScores,
    takeProfitTranchePct: _tranche,
    standingExit: _standingExit,
    standingTakeProfit: _standingTakeProfit,
    headlinesRead: _headlinesRead,
    ...rest
  } = suggestion

  return {
    ...rest,
    ...fields,
    holdReasons: renderHoldReasons(reader.locale, rest),
  }
}

function agentPriceBand(band: PriceBandNote): AgentPriceBand {
  return {
    ...band,
    maximumUpPct: fractionToPct(band.maximumUpPct),
    maximumDownPct: fractionToPct(band.maximumDownPct),
  }
}

function toReportSuggestion(
  suggestion: StoredSuggestion,
  audience: ToolAudience
): StoredSuggestion {
  if (suggestion.action === 'hold') {
    return suggestion
  }

  const { policyUnits: _policyUnits, units, ...rest } = suggestion

  return { ...rest, ...operatorUnits(audience, units) }
}

/** The order quantity reaches the operator's own client, and only that. */
function operatorUnits(
  audience: ToolAudience,
  units: number | undefined
): { readonly units?: number } {
  return audience === 'operator' && units !== undefined ? { units } : {}
}

function agentFields(suggestion: StoredSuggestion, reader: AgentReader): AgentFields {
  const price = priceWriter(suggestion.instrument, reader)
  const { score: _score, ...composite } = suggestion.composite

  return {
    ...levelField('entry', suggestion.entry, price),
    ...levelField('stop', suggestion.stop, price),
    ...levelField('target', suggestion.target, price),
    // A holder banks at the take-profit the plan kept; a fresh entry at its own.
    ...levelField('takeProfit', suggestion.standingTakeProfit ?? suggestion.takeProfit, price),
    ...levelField('atr', suggestion.action === 'hold' ? undefined : suggestion.atr, price),
    ...levelField('raisedStopFrom', suggestion.raisedStopFrom, price),
    ...(suggestion.quote === undefined ? {} : { quote: writtenQuote(suggestion.quote, price) }),
    composite,
    factorScores: suggestion.factorScores.map((factor) => agentFactor(factor, reader)),
    ...takeProfitFields(suggestion, reader),
    ...standingExitField(suggestion.standingExit, price),
    ...heldWeightOf(suggestion.held),
    ...headlinesReadOf(suggestion.headlinesRead),
  }
}

function headlinesReadOf(read: HeadlinesRead | undefined): Pick<AgentFields, 'headlinesRead'> {
  return read === undefined ? {} : { headlinesRead: { own: read.own, market: read.market } }
}

function standingExitField(
  exit: StoredSuggestion['standingExit'],
  price: PriceWriter
): Pick<AgentFields, 'standingExit'> {
  return exit === undefined
    ? {}
    : { standingExit: { stop: price(exit.stop), takeProfit: price(exit.takeProfit) } }
}

function priceWriter(instrument: InstrumentRef, reader: AgentReader): PriceWriter {
  const quoted = reader.marketData.quoteConvention(instrument.market) ?? {}

  return (value) => formatScaledPrice(reader.locale, value, quoted)
}

function levelField<K extends string>(
  key: K,
  value: number | undefined,
  price: PriceWriter
): Partial<Record<K, string>> {
  return value === undefined ? {} : ({ [key]: price(value) } as Record<K, string>)
}

function agentFactor(factor: FactorResult, reader: AgentReader): AgentFactor {
  const { score, provenance: _provenance, ...rest } = factor

  return { ...rest, band: renderScoreBand(reader.locale, score) }
}

/** A fresh entry is told the share of the position its take-profit banks; a holder is told the
 *  share of what they hold today, whole lots and all, which is the sale the CLI names. */
function takeProfitFields(
  suggestion: StoredSuggestion,
  reader: AgentReader
): Pick<AgentFields, 'takeProfitTranchePct' | 'heldTakeProfit'> {
  const tranche = suggestion.takeProfitTranchePct

  if (tranche === undefined) {
    return {}
  }

  const { held } = suggestion

  if (held === undefined) {
    return { takeProfitTranchePct: fractionToPct(tranche) }
  }

  const { market } = suggestion.instrument
  const banked = bankedShareOf(suggestion, reader.marketData.trailsStop(market))

  if (banked >= 1) {
    return {}
  }

  const exit = heldFirstExitOf(held, banked, reader.marketData.boardLot(market)?.size)

  return {
    heldTakeProfit:
      exit.kind === 'taken'
        ? { kind: 'taken' }
        : { kind: 'sell', sellPct: fractionToPct(exit.shareOfHeld) },
  }
}

/** Rebuilt field by field, so a field added to the stored row stays out until someone adds it here. */
function toScoredCall(
  suggestion: ResolvedActionableSuggestion,
  reader: AgentReader
): AgentScoredCall {
  const price = priceWriter(suggestion.instrument, reader)

  return {
    instrument: suggestion.instrument,
    at: suggestion.at,
    strategyVersion: suggestion.strategyVersion,
    horizon: suggestion.horizon,
    conviction: suggestion.conviction,
    action: suggestion.action,
    entry: price(suggestion.entry),
    stop: price(suggestion.stop),
    target: price(suggestion.target),
    takeProfit: price(suggestion.takeProfit),
    ...(suggestion.probability === undefined ? {} : { probability: suggestion.probability }),
    outcome: agentOutcome(suggestion.outcome),
  }
}

/** The record stores returns as fractions; a model reads every `Pct` as percent. */
function agentOutcome(outcome: SuggestionOutcome): SuggestionOutcome {
  return {
    ...outcome,
    returnPct: fractionToPct(outcome.returnPct),
    ...(outcome.benchmarkReturnPct === undefined
      ? {}
      : { benchmarkReturnPct: fractionToPct(outcome.benchmarkReturnPct) }),
  }
}

function agentSummary(summary: TrackRecordSummary): TrackRecordSummary {
  return {
    ...summary,
    ...percentField('meanReturnPct', summary.meanReturnPct),
    ...percentField('medianReturnPct', summary.medianReturnPct),
    ...percentField('benchmarkMeanReturnPct', summary.benchmarkMeanReturnPct),
    calibration: summary.calibration.map(agentBucket),
  }
}

function agentBucket(bucket: CalibrationBucket): CalibrationBucket {
  return {
    ...bucket,
    ...percentField('meanReturnPct', bucket.meanReturnPct),
    ...percentField('meanWinPct', bucket.meanWinPct),
    ...percentField('meanLossPct', bucket.meanLossPct),
  }
}

function percentField<K extends string>(
  key: K,
  fraction: number | undefined
): Partial<Record<K, number>> {
  return fraction === undefined ? {} : ({ [key]: fractionToPct(fraction) } as Record<K, number>)
}

/** Rebuilt field by field rather than spread minus keys, so an absolute figure added to
 *  `HeldPosition` later is absent here until someone decides otherwise. */
function heldWeightOf(held: HeldPosition | undefined): { readonly held?: HeldWeight } {
  if (held === undefined) {
    return {}
  }

  return {
    held: {
      openLotCount: held.openLotCount,
      ...(held.firstAcquiredAt === undefined ? {} : { firstAcquiredAt: held.firstAcquiredAt }),
      ...(held.pctNav === undefined ? {} : { pctNav: held.pctNav }),
    },
  }
}
