import type {
  CapRejectionWire,
  ConfirmOrderResponse,
  ExitResponse,
  OrphanExitWire,
  ReconcileOrdersResponse,
  RestingExitWire,
  StagedOrderWire,
  TradeStatusResponse,
  UnguardedPositionWire,
  UnmirroredOrderWire,
} from '@/app/server/wire/orders'
import type { Locale } from '@/core/types/locale'
import type {
  CapRejection,
  ConfirmOutcome,
  ExitOutcome,
  OrphanExit,
  ReconcileReview,
  RestingExitRow,
  StagedOrder,
  TradeStatus,
  UnguardedPosition,
  UnmirroredIntent,
} from '@/trading/api'
import { toInstrumentWire } from '@/app/server/mappers/trading'
import { bindLocale } from '@/i18n'

type ExecutedOutcome = Extract<ConfirmOutcome, { readonly kind: 'executed' }>

function toStagedOrderWire(order: StagedOrder): StagedOrderWire {
  return {
    token: order.token,
    instrument: toInstrumentWire(order.instrument),
    venue: order.venue,
    side: order.side,
    orderType: order.orderType,
    quantity: order.quantity,
    ...(order.limitPrice === undefined ? {} : { limitPrice: order.limitPrice }),
    ...(order.takeProfit === undefined ? {} : { takeProfit: order.takeProfit }),
    ...(order.stopLoss === undefined ? {} : { stopLoss: order.stopLoss }),
    quotePrice: order.quotePrice,
    notionalBase: order.notionalBase,
    createdAt: order.createdAt,
  }
}

function toRestingExitWire(exit: RestingExitRow): RestingExitWire {
  return {
    instrument: toInstrumentWire(exit.instrument),
    venue: exit.venue,
    quantity: exit.quantity,
    ...(exit.takeProfit === undefined ? {} : { takeProfit: exit.takeProfit }),
    ...(exit.stopLoss === undefined ? {} : { stopLoss: exit.stopLoss }),
    ...(exit.currency === undefined ? {} : { currency: exit.currency }),
    placedAt: exit.placedAt,
  }
}

function toUnguardedWire(position: UnguardedPosition): UnguardedPositionWire {
  return {
    instrument: toInstrumentWire(position.instrument),
    venue: position.venue,
    quantity: position.quantity,
    guarded: position.guarded,
  }
}

function toUnmirroredWire(intent: UnmirroredIntent): UnmirroredOrderWire {
  return {
    token: intent.token,
    instrument: toInstrumentWire(intent.instrument),
    venue: intent.venue,
    side: intent.side,
    quantity: intent.quantity,
    createdAt: intent.createdAt,
    failure: intent.failure,
    ...(intent.orderId === undefined ? {} : { orderId: intent.orderId }),
  }
}

function toOrphanExitWire(exit: OrphanExit): OrphanExitWire {
  return {
    venue: exit.venue,
    symbol: exit.symbol,
    exitId: exit.exitId,
    quantity: exit.quantity,
    ...(exit.takeProfit === undefined ? {} : { takeProfit: exit.takeProfit }),
    ...(exit.stopLoss === undefined ? {} : { stopLoss: exit.stopLoss }),
  }
}

function toCapRejectionWire(rejection: CapRejection): CapRejectionWire {
  return {
    code: rejection.code,
    limit: rejection.limit,
    actual: rejection.actual,
    ...(rejection.venue === undefined ? {} : { venue: rejection.venue }),
  }
}

export function toTradeStatusWire(status: TradeStatus): TradeStatusResponse {
  return {
    staged: status.staged.map(toStagedOrderWire),
    exits: status.exits.map(toRestingExitWire),
    unguarded: status.unguarded.map(toUnguardedWire),
    unguardedResidue: [...status.unguardedResidue],
    unmirrored: status.unmirrored.map(toUnmirroredWire),
    ...(status.haltedAt === undefined ? {} : { haltedAt: status.haltedAt }),
  }
}

/** The exit failure in `/trade`'s words, since only the code travels with the order. */
function toExecutedWire(outcome: ExecutedOutcome, locale: Locale): ConfirmOrderResponse {
  const { receipt, exit, exitFailure } = outcome.executed

  return {
    kind: 'executed',
    order: toStagedOrderWire(outcome.staged),
    fill: {
      orderId: receipt.orderId,
      state: receipt.state,
      averagePrice: receipt.averagePrice,
      filledQuantity: receipt.filledQuantity,
      fee: Math.abs(receipt.fee),
      feeCurrency: receipt.feeCurrency,
      ...(receipt.filledAt === undefined ? {} : { filledAt: receipt.filledAt }),
    },
    currency: outcome.prepared.currency,
    exitPlaced: exit !== undefined,
    ...(exitFailure === undefined
      ? {}
      : {
          exitFailure: {
            code: exitFailure,
            text: bindLocale(locale).translate(`toolErrors.${exitFailure}`),
          },
        }),
  }
}

export function toConfirmOrderWire(outcome: ConfirmOutcome, locale: Locale): ConfirmOrderResponse {
  if (outcome.kind === 'unknown-token') {
    return { kind: 'unknown-token' }
  }

  if (outcome.kind === 'rejected') {
    return {
      kind: 'rejected',
      order: toStagedOrderWire(outcome.staged),
      rejections: outcome.prepared.rejections.map(toCapRejectionWire),
    }
  }

  return toExecutedWire(outcome, locale)
}

export function toExitWire(outcome: ExitOutcome): ExitResponse {
  return {
    action: outcome.action,
    instrument: toInstrumentWire(outcome.instrument),
    venue: outcome.venue,
    currency: outcome.currency,
    quantity: outcome.quantity,
    uncovered: outcome.uncovered,
    ...(outcome.takeProfit === undefined ? {} : { takeProfit: outcome.takeProfit }),
    ...(outcome.stopLoss === undefined ? {} : { stopLoss: outcome.stopLoss }),
  }
}

export function toReconcileOrdersWire(review: ReconcileReview): ReconcileOrdersResponse {
  return {
    settled: review.settled,
    outstanding: review.outstanding.map(toUnmirroredWire),
    orphanExits: review.orphanExits.map(toOrphanExitWire),
    unreadExitVenues: [...review.unreadExitVenues],
  }
}
