import type {
  FxConversionWire,
  LedgerEntryBaseWire,
  LedgerEntryWire,
  LedgerWriteResponse,
  RebalanceResponse,
  RebalanceTextWire,
  ReconcileResponse,
  StopsResponse,
  VenuesResponse,
} from '@/app/server/wire/money'
import type { Locale } from '@/core/types/locale'
import type {
  AbsoluteRebalancePlan,
  HeldStopView,
  LedgerEntry,
  LedgerWriteResult,
  RebalanceText,
  RebalanceView,
  ReconcileView,
  VenueChoice,
} from '@/trading/api'
import {
  percent,
  toCaveatWires,
  toInstrumentWire,
  toSuggestionWire,
} from '@/app/server/mappers/trading'
import { buildInstrumentKey } from '@/trading/api'

type ReadyAdvice = Extract<AbsoluteRebalancePlan['advice'], { readonly kind: 'ready' }>
type PositionChange = ReadyAdvice['rebalance'][number]
type Finding = AbsoluteRebalancePlan['advice']['findings'][number]

function toConversionWire(conversion: {
  readonly fromCurrency: string
  readonly toCurrency: string
  readonly rate: number
  readonly source: 'identity' | 'provider' | 'operator'
}): FxConversionWire {
  return {
    fromCurrency: conversion.fromCurrency,
    toCurrency: conversion.toCurrency,
    rate: conversion.rate,
    source: conversion.source,
  }
}

function entryBase(entry: LedgerEntry): LedgerEntryBaseWire {
  const txn = entry.transaction

  return {
    id: entry.id,
    recordedAt: entry.recordedAt,
    ...(entry.updatedAt === undefined ? {} : { updatedAt: entry.updatedAt }),
    at: txn.at,
    settledAt: txn.settledAt,
    ...(txn.note === undefined ? {} : { note: txn.note }),
    venue: txn.venue,
  }
}

type TradeTxn = Extract<LedgerEntry['transaction'], { readonly kind: 'buy' | 'sell' | 'rights' }>
type TradeFields = Omit<
  Extract<LedgerEntryWire, { readonly unitPrice: number }>,
  keyof LedgerEntryBaseWire
>

function toTradeFields(txn: TradeTxn): TradeFields {
  return {
    kind: txn.kind,
    instrument: toInstrumentWire(txn.instrument),
    currency: txn.currency,
    quantity: txn.quantity,
    unitPrice: txn.unitPrice,
    fee: txn.fee,
    ...(txn.closeReason === undefined ? {} : { closeReason: txn.closeReason }),
    conversion: toConversionWire(txn.conversion),
  }
}

export function toLedgerEntryWire(entry: LedgerEntry): LedgerEntryWire {
  const txn = entry.transaction
  const base = entryBase(entry)

  switch (txn.kind) {
    case 'split':
    case 'distribution':
      return {
        ...base,
        kind: txn.kind,
        instrument: toInstrumentWire(txn.instrument),
        quantityDelta: txn.quantityDelta,
      }

    case 'transfer':
      return {
        ...base,
        kind: txn.kind,
        fromVenue: txn.fromVenue,
        currency: txn.currency,
        amount: txn.amount,
        fee: txn.fee,
        conversion: toConversionWire(txn.conversion),
      }

    case 'buy':
    case 'sell':
    case 'rights':
      return { ...base, ...toTradeFields(txn) }

    case 'dividend':
      return {
        ...base,
        kind: txn.kind,
        instrument: toInstrumentWire(txn.instrument),
        currency: txn.currency,
        amount: txn.amount,
        conversion: toConversionWire(txn.conversion),
      }

    default:
      return {
        ...base,
        kind: txn.kind,
        currency: txn.currency,
        amount: txn.amount,
        conversion: toConversionWire(txn.conversion),
      }
  }
}

export function toLedgerWriteWire(result: LedgerWriteResult, locale: Locale): LedgerWriteResponse {
  return {
    kind: result.kind,
    entry: toLedgerEntryWire(result.entry),
    ...(result.fillSource === undefined ? {} : { fillSource: result.fillSource }),
    ...(result.duplicateOf === undefined ? {} : { duplicateOf: result.duplicateOf }),
    ...(result.planned === undefined ? {} : { planned: toSuggestionWire(result.planned, locale) }),
  }
}

export function toStopsWire(stops: readonly HeldStopView[]): StopsResponse {
  return {
    stops: stops.map((stop) => ({
      instrument: toInstrumentWire(stop.instrument),
      plan: stop.plan,
      ...(stop.stop === undefined ? {} : { stop: stop.stop }),
      ...(stop.takeProfit === undefined ? {} : { takeProfit: stop.takeProfit }),
      ...(stop.distanceToStopPct === undefined
        ? {}
        : { distanceToStopPct: percent(stop.distanceToStopPct) }),
      ...(stop.price === undefined ? {} : { price: stop.price }),
      review: stop.review,
      ...(stop.cover === undefined ? {} : { cover: stop.cover }),
    })),
  }
}

function toFindingWire(finding: Finding): RebalanceResponse['findings'][number] {
  return { code: finding.kind, direction: finding.direction, data: { ...finding.subject } }
}

function toChangeWire(
  change: PositionChange,
  sizing: AbsoluteRebalancePlan['sizing'],
  locale: Locale
): Extract<RebalanceResponse, { readonly status: 'ready' }>['changes'][number] {
  const order = sizing?.byInstrument.get(buildInstrumentKey(change.instrument))

  return {
    instrument: toInstrumentWire(change.instrument),
    segment: change.segment,
    ...(change.sector === undefined ? {} : { sector: change.sector }),
    ...(change.instrumentKind === undefined ? {} : { instrumentKind: change.instrumentKind }),
    currentPctNav: percent(change.currentPctNav),
    targetPctNav: percent(change.targetPctNav),
    changePctNav: percent(change.changePctNav),
    reason: change.reason.kind,
    ...(order === undefined
      ? {}
      : {
          order: {
            valueBase: order.valueBase,
            quantity: order.quantity,
            boardLot: order.boardLot,
            unitPrice: order.unitPrice,
            currency: order.currency,
          },
        }),
    caveats: toCaveatWires(change.caveats, locale),
  }
}

export function toRebalanceWire(view: RebalanceView, locale: Locale): RebalanceResponse {
  const { advice, sizing } = view.plan
  const text = toRebalanceTextWire(view.text)
  const findings = advice.findings.map(toFindingWire)

  if (advice.kind === 'unavailable') {
    return {
      status: 'unavailable',
      reason: advice.reason,
      findings,
      caveats: toCaveatWires(advice.caveats, locale),
      text,
    }
  }

  return {
    status: 'ready',
    ...(sizing === null ? {} : { baseCurrency: sizing.baseCurrency, navBase: sizing.navBase }),
    deploymentScale: advice.policy.deploymentScale,
    segments: advice.allocation.map((segment) => ({
      segment: segment.segment,
      currentPctNav: percent(segment.currentPctNav),
      targetPctNav: percent(segment.targetPctNav),
      afterPlanPctNav: percent(segment.afterPlanPctNav),
      driftBandPctNav: percent(segment.driftBandPctNav),
      ...(segment.capPctNav === undefined ? {} : { capPctNav: percent(segment.capPctNav) }),
    })),
    changes: advice.rebalance.map((change) => toChangeWire(change, sizing, locale)),
    cash: {
      cashPctNav: percent(advice.cashSleeve.cashPctNav),
      liquidReservePctNav: percent(advice.cashSleeve.liquidReservePctNav),
      termDepositEligiblePctNav: percent(advice.cashSleeve.termDepositEligiblePctNav),
      posture: advice.cashSleeve.posture,
    },
    findings,
    caveats: toCaveatWires(advice.caveats, locale),
    text,
  }
}

function toRebalanceTextWire(text: RebalanceText): RebalanceTextWire {
  return {
    headline: [...text.headline],
    groups: { ...text.groups },
    orders: text.orders.map((order) => ({
      instrument: toInstrumentWire(order.instrument),
      group: order.group,
      line: order.line,
    })),
    sleeves: [...text.sleeves],
    notes: [...text.notes],
  }
}

export function toReconcileWire(view: ReconcileView): ReconcileResponse {
  return {
    text: {
      matched: view.text.matched,
      cashNote: view.text.cashNote,
    },
    venues: view.venues.map((venue) => ({
      venue: venue.venue,
      mismatches: venue.mismatches.map((mismatch) => ({ ...mismatch })),
      ...(venue.uncompared === undefined ? {} : { uncompared: venue.uncompared }),
      ...(venue.missingCredentials === undefined
        ? {}
        : { missingCredentials: [...venue.missingCredentials] }),
    })),
  }
}

export function toVenuesWire(choices: readonly VenueChoice[]): VenuesResponse {
  return {
    venues: choices.map((choice) => ({ venue: choice.venue, markets: [...choice.markets] })),
  }
}
