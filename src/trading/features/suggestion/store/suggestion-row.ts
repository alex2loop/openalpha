import type { HeadlinesRead, SuggestionCitation } from '@/trading/features/suggestion/citation'
import type { StoredDebate } from '@/trading/features/suggestion/debate/types'
import type { HeldPosition } from '@/trading/features/suggestion/exposure'
import type {
  CitationPayload,
  StoredDebatePayload,
  SuggestionPayload,
} from '@/trading/features/suggestion/store/suggestion-payload'
import type {
  ActionableStoredSuggestion,
  ResolvedActionableSuggestion,
  StoredSuggestion,
  SuggestionOutcome,
  SuggestionQuote,
} from '@/trading/features/suggestion/types'
import type { ConvictionBand, SuggestionAction } from '@/trading/kernel/conviction'
import type { DealerBoard } from '@/trading/kernel/market/market-data'
import type { FocusKey } from '@/trading/kernel/operator/focus'
import { StorageError } from '@/core/errors'
import { LOCALES } from '@/core/types/locale'
import { definedOnly } from '@/core/utils/collections'
import { playbookField } from '@/trading/features/suggestion/debate/types'
import {
  toFactorResult,
  toFactorResultPayload,
} from '@/trading/features/suggestion/store/factor-payload'
import { parseSuggestionPayload } from '@/trading/features/suggestion/store/suggestion-payload'
import { suggestionId } from '@/trading/features/suggestion/types'
import { REDUCE_REASON_CODES } from '@/trading/kernel/caveat'
import {
  CONVICTION_BANDS,
  OUTCOME_STATUSES,
  SUGGESTION_ACTIONS,
  UNFILLED_STATUS,
} from '@/trading/kernel/conviction'
import { factorComposite } from '@/trading/kernel/factor'
import {
  ticker as brandTicker,
  currencyCode,
  marketRef,
  strategyId,
  tradingDay,
} from '@/trading/kernel/instrument'
import { toMember, toProvenance } from '@/trading/kernel/store/store-payload'
import { requireColumn } from '@/trading/kernel/store/store-row'

export interface SuggestionRow {
  readonly id: string
  readonly strategy_id: string
  readonly strategy_version: string
  readonly focus_key: string
  readonly market: string
  readonly ticker: string
  readonly day: string
  readonly action: string
  readonly conviction: string
  readonly authored_locale: string
  readonly created_at: number
  readonly outcome_status: string | null
  readonly resolved_at: number | null
  readonly exit_day: string | null
  readonly return_pct: number | null
  readonly trailing_stop: number | null
  readonly payload: string
}

export function toPayload(suggestion: StoredSuggestion): SuggestionPayload {
  const shared = sharedPayload(suggestion)
  const levels = {
    thesis: suggestion.thesis,
    entry: suggestion.entry,
    stop: suggestion.stop,
    target: suggestion.target,
    takeProfit: suggestion.takeProfit,
    riskReward: suggestion.riskReward,
  }

  if (suggestion.action === 'hold') {
    return {
      ...shared,
      ...levels,
      direction: suggestion.direction,
      holdReasonCodes: [...suggestion.holdReasonCodes],
      ...(suggestion.unsupportedClaims === undefined
        ? {}
        : { unsupportedClaims: [...suggestion.unsupportedClaims] }),
    }
  }

  return {
    ...shared,
    ...levels,
    sizePctNav: suggestion.sizePctNav,
    units: suggestion.units,
    policyUnits: suggestion.policyUnits,
    targetPctNav: suggestion.targetPctNav,
    atr: suggestion.atr,
    concentration: suggestion.concentration,
    orderSession: suggestion.orderSession,
    restingEntry: suggestion.restingEntry,
    settlement: suggestion.settlement,
    priceBand: suggestion.priceBand,
    benchmarkReturnPct: suggestion.outcome?.benchmarkReturnPct,
    outcomeFormulaVersion: suggestion.outcome?.formulaVersion,
  }
}

/** Everything both arms write, so neither arm can drift from the other on a shared field. An
 *  undefined field is dropped when the payload is serialized. */
function sharedPayload(suggestion: StoredSuggestion) {
  return {
    calculationVersions: [...suggestion.calculationVersions],
    horizon: suggestion.horizon,
    citations: [...suggestion.citations],
    headlinesRead: suggestion.headlinesRead,
    provenance: [...suggestion.provenance],
    caveats: [...suggestion.caveats],
    factorScores: suggestion.factorScores.map(toFactorResultPayload),
    held: suggestion.held,
    composite: suggestion.composite,
    profile: suggestion.profile,
    indexTier: suggestion.indexTier,
    instrumentKind: suggestion.instrumentKind,
    reviewOnly: suggestion.reviewOnly,
    reduceReasonCode: suggestion.reduceReasonCode,
    debate: suggestion.debate,
    invalidators: suggestion.invalidators?.slice(),
    probability: suggestion.probability,
    quote: suggestion.quote,
    pullback: suggestion.pullback,
    raisedStopFrom: suggestion.raisedStopFrom,
    standingExit: suggestion.standingExit,
    standingTakeProfit: suggestion.standingTakeProfit,
    takeProfitTranchePct: suggestion.takeProfitTranchePct,
    evidenceThrough: suggestion.evidenceThrough,
    ...(suggestion.invalidatedPrior === undefined
      ? {}
      : {
          invalidatedPrior: {
            at: suggestion.invalidatedPrior.at,
            fired: [...suggestion.invalidatedPrior.fired],
          },
        }),
  }
}

export function toSuggestion(row: SuggestionRow): StoredSuggestion {
  const payload = parseSuggestionPayload(row.payload)
  const action = toMember<SuggestionAction>(row.action, SUGGESTION_ACTIONS, 'suggestion action')
  const base = toBase(row, payload)

  if (action === 'hold') {
    return toHoldRow(row, payload, base)
  }

  const outcome = toOutcome(row, payload)
  const restatedAt = restatedAtOf(row)
  const unfilledAt = unfilledAtOf(row)
  const target = readField(payload.target, row, 'target')

  return {
    ...base,
    action,
    thesis: readField(payload.thesis, row, 'thesis'),
    entry: readField(payload.entry, row, 'entry'),
    stop: readField(payload.stop, row, 'stop'),
    target,
    takeProfit: takeProfitOf(payload) ?? target,
    riskReward: readField(payload.riskReward, row, 'riskReward'),
    ...definedOnly({
      sizePctNav: payload.sizePctNav,
      units: payload.units,
      policyUnits: payload.policyUnits,
      targetPctNav: payload.targetPctNav,
      atr: payload.atr,
      concentration: payload.concentration,
      priceBand: payload.priceBand,
      outcome,
      restatedAt,
      unfilledAt,
    }),
    ...(payload.orderSession === undefined
      ? {}
      : { orderSession: tradingDay(payload.orderSession) }),
    ...(payload.restingEntry === undefined
      ? {}
      : {
          restingEntry: { ...payload.restingEntry, until: tradingDay(payload.restingEntry.until) },
        }),
    ...(payload.settlement === undefined
      ? {}
      : {
          settlement: {
            sellableFrom: tradingDay(payload.settlement.sellableFrom),
            worstCaseDrawdownPct: payload.settlement.worstCaseDrawdownPct,
          },
        }),
  }
}

/** Every level field is optional on a hold: the market may have computed none of them. */
function toHoldRow(
  row: SuggestionRow,
  payload: SuggestionPayload,
  base: Omit<StoredSuggestion, 'action' | 'thesis' | 'outcome'>
): StoredSuggestion {
  return {
    ...base,
    action: 'hold',
    ...definedOnly({
      thesis: payload.thesis,
      entry: payload.entry,
      stop: payload.stop,
      target: payload.target,
      takeProfit: takeProfitOf(payload),
      riskReward: payload.riskReward,
      unsupportedClaims: payload.unsupportedClaims,
    }),
    direction: readField(payload.direction, row, 'direction'),
    holdReasonCodes: readField(payload.holdReasonCodes, row, 'holdReasonCodes'),
  }
}

export function toActionable(row: SuggestionRow): ActionableStoredSuggestion {
  const suggestion = toSuggestion(row)

  if (suggestion.action === 'hold') {
    throw new StorageError(`suggestion ${row.id} is a hold where an actionable row was required`)
  }

  return suggestion
}

export function toResolved(row: SuggestionRow): ResolvedActionableSuggestion {
  const suggestion = toActionable(row)

  if (!suggestion.outcome) {
    throw new StorageError(`suggestion ${row.id} has no outcome where a resolved row was required`)
  }

  return { ...suggestion, outcome: suggestion.outcome }
}

function toBase(
  row: SuggestionRow,
  payload: SuggestionPayload
): Omit<StoredSuggestion, 'action' | 'thesis' | 'outcome'> {
  return {
    id: suggestionId(row.id),
    createdAt: row.created_at,
    instrument: { market: marketRef(row.market), ticker: brandTicker(row.ticker) },
    at: tradingDay(row.day),
    authoredLocale: toMember(row.authored_locale, LOCALES, 'authored locale'),
    strategyId: strategyId(row.strategy_id),
    strategyVersion: row.strategy_version,
    // why-safe: the column only ever holds `focusKey()` output.
    focusKey: row.focus_key as FocusKey,
    calculationVersions: payload.calculationVersions,
    conviction: toMember<ConvictionBand>(row.conviction, CONVICTION_BANDS, 'conviction band'),
    horizon: payload.horizon,
    citations: payload.citations.map(toCitation),
    provenance: payload.provenance.map(toProvenance),
    caveats: payload.caveats,
    factorScores: payload.factorScores.map(toFactorResult),
    composite: factorComposite(payload.composite),
    profile: payload.profile,
    ...toOptionalBase(row, payload),
  }
}

/** The shared fields a row carries only when its run produced them. */
function toOptionalBase(
  row: SuggestionRow,
  payload: SuggestionPayload
): Partial<Omit<StoredSuggestion, 'action' | 'thesis' | 'outcome'>> {
  return {
    ...(payload.headlinesRead === undefined
      ? {}
      : { headlinesRead: toHeadlinesRead(payload.headlinesRead) }),
    ...definedOnly({
      indexTier: payload.indexTier,
      instrumentKind: payload.instrumentKind,
      reviewOnly: payload.reviewOnly,
      invalidators: payload.invalidators,
      probability: payload.probability,
      pullback: payload.pullback,
      raisedStopFrom: payload.raisedStopFrom,
      standingExit: payload.standingExit,
      standingTakeProfit: payload.standingTakeProfit,
      takeProfitTranchePct: payload.takeProfitTranchePct,
    }),
    ...(payload.reduceReasonCode === undefined
      ? {}
      : {
          reduceReasonCode: toMember(
            payload.reduceReasonCode,
            REDUCE_REASON_CODES,
            'reduce reason'
          ),
        }),
    ...(payload.held === undefined ? {} : { held: toHeld(payload.held) }),
    ...(payload.debate === undefined ? {} : { debate: toDebate(payload.debate) }),
    ...(payload.quote === undefined ? {} : { quote: toQuote(payload.quote) }),
    ...(payload.evidenceThrough === undefined
      ? {}
      : { evidenceThrough: tradingDay(payload.evidenceThrough) }),
    ...(payload.invalidatedPrior === undefined
      ? {}
      : {
          invalidatedPrior: {
            at: tradingDay(payload.invalidatedPrior.at),
            fired: payload.invalidatedPrior.fired,
          },
        }),
    ...(row.trailing_stop === null ? {} : { trailingStop: row.trailing_stop }),
  }
}

function toDealerBoard(
  board: NonNullable<NonNullable<SuggestionPayload['quote']>['board']>
): DealerBoard {
  return {
    buyPrice: board.buyPrice,
    sellPrice: board.sellPrice,
    ...definedOnly({ spreadPct: board.spreadPct }),
  }
}

function toHeld(held: NonNullable<SuggestionPayload['held']>): HeldPosition {
  return {
    units: held.units,
    unitCostNative: held.unitCostNative,
    settledUnits: held.settledUnits,
    openLotCount: held.openLotCount,
    ...(held.firstAcquiredAt === undefined
      ? {}
      : { firstAcquiredAt: tradingDay(held.firstAcquiredAt) }),
    ...(held.medianAcquiredAt === undefined
      ? {}
      : { medianAcquiredAt: tradingDay(held.medianAcquiredAt) }),
    ...(held.settlesOn === undefined ? {} : { settlesOn: tradingDay(held.settlesOn) }),
    ...(held.openedOn === undefined ? {} : { openedOn: tradingDay(held.openedOn) }),
    ...definedOnly({ pctNav: held.pctNav, soldUnits: held.soldUnits }),
  }
}

function toQuote(quote: NonNullable<SuggestionPayload['quote']>): SuggestionQuote {
  return {
    price: quote.price,
    observedAt: quote.observedAt,
    ...definedOnly({ changePct: quote.changePct }),
    currency: currencyCode(quote.currency),
    ...(quote.board === undefined ? {} : { board: toDealerBoard(quote.board) }),
  }
}

function toOutcome(row: SuggestionRow, payload: SuggestionPayload): SuggestionOutcome | undefined {
  if (
    row.outcome_status === null ||
    row.outcome_status === UNFILLED_STATUS ||
    row.resolved_at === null ||
    isRestatedRow(row)
  ) {
    return undefined
  }

  const benchmark = payload.benchmarkReturnPct
  const formulaVersion = payload.outcomeFormulaVersion

  return {
    status: toMember(row.outcome_status, OUTCOME_STATUSES, 'outcome status'),
    resolvedAt: row.resolved_at,
    exitDay: tradingDay(readField(row.exit_day, row, 'exit_day')),
    returnPct: readField(row.return_pct, row, 'return_pct'),
    ...(benchmark === undefined ? {} : { benchmarkReturnPct: benchmark }),
    ...(formulaVersion === undefined ? {} : { formulaVersion }),
  }
}

/** A row written before plans named a nearer take-profit banked its tranche at the target. */
function takeProfitOf(payload: SuggestionPayload): number | undefined {
  return payload.takeProfit ?? payload.target
}

function unfilledAtOf(row: SuggestionRow): number | undefined {
  return row.outcome_status === UNFILLED_STATUS && row.resolved_at !== null
    ? row.resolved_at
    : undefined
}

function restatedAtOf(row: SuggestionRow): number | undefined {
  return row.resolved_at !== null && isRestatedRow(row) ? row.resolved_at : undefined
}

/** The shape `clearRestated` writes: closed, with no exit to score. Every scored close has one, and
 *  an unfilled close has none for its own reason. */
function isRestatedRow(row: SuggestionRow): boolean {
  return (
    row.outcome_status !== null && row.outcome_status !== UNFILLED_STATUS && row.return_pct === null
  )
}

function toCitation(raw: CitationPayload): SuggestionCitation {
  return {
    url: raw.url,
    ...definedOnly({ title: raw.title, publishedAt: raw.publishedAt }),
  }
}

function toHeadlinesRead(raw: NonNullable<SuggestionPayload['headlinesRead']>): HeadlinesRead {
  return { own: raw.own, market: raw.market, costUsd: raw.costUsd ?? 0 }
}

function toDebate(raw: StoredDebatePayload): StoredDebate {
  if (raw.mode === 'lean') {
    const { playbook, refutedIds, ...lean } = raw

    return { ...lean, ...definedOnly({ refutedIds }), ...playbookField(playbook) }
  }

  const { riskConviction, riskNote, refutedIds, playbook, ...full } = raw

  return {
    ...full,
    ...definedOnly({ riskConviction, riskNote, refutedIds }),
    ...playbookField(playbook),
  }
}

function readField<T>(value: T | null | undefined, row: SuggestionRow, field: string): T {
  return requireColumn(value, `suggestion ${row.id} is missing ${field}`)
}
