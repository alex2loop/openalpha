import type { OrderService } from '@/trading/features/order/types'
import type { TradingHost, TradingHostDeps } from '@/trading/wiring/host/types'
import { OperatorConfigError } from '@/core/config/resolve'
import { ValidationError } from '@/core/errors'
import { translateToolError } from '@/i18n'
import { OrderError } from '@/trading/features/order/types'
import { scoped, scopedSlow } from '@/trading/wiring/host/scope'

const ORDER_FAILED_KEY = 'slash.tradingTradeFailed'

/** A write to an exchange runs on no caller signal: a client hanging up mid-fill must not
 *  abandon an order the exchange holds or split an exit's placement from the row that records
 *  it. Shutdown and the slow ceiling still bound it. */
const UNABORTED = new AbortController().signal

export type OrderMethods = Pick<
  TradingHost,
  | 'ordersEnabled'
  | 'getTradeStatus'
  | 'confirmOrder'
  | 'discardOrder'
  | 'setExit'
  | 'cancelExit'
  | 'setBuyingHalted'
  | 'reconcileOrders'
  | 'clearUnmirrored'
>

/** The order service exists only where a venue can place; the route gate checks `ordersEnabled`
 *  first, so reaching this without one is a wiring fault. */
function orderService(deps: TradingHostDeps): OrderService {
  const { order } = deps.services

  if (order === undefined) {
    throw new OperatorConfigError('no exchange account can place orders', {
      key: 'errors.orderNoExchangeAccount',
    })
  }

  return order
}

/** An order the exchange or a guard refused is the operator's to read, in the words `/trade`
 *  prints for it; anything else stays a fault. */
async function refusedAsOperatorText<T>(deps: TradingHostDeps, work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (err: unknown) {
    if (!(err instanceof OrderError)) {
      throw err
    }

    const reason = translateToolError(deps.defaultLocale, err.code, err.detail(deps.defaultLocale))

    throw new ValidationError(err.message, { key: ORDER_FAILED_KEY, params: { reason } }, err)
  }
}

type OrderWrites = Pick<OrderMethods, 'confirmOrder' | 'discardOrder' | 'setExit' | 'cancelExit'>

/** What reaches an exchange or spends a staged token. */
function orderWrites(deps: TradingHostDeps): OrderWrites {
  return {
    confirmOrder: (request) =>
      scopedSlow(deps, UNABORTED, (scope) =>
        refusedAsOperatorText(deps, () =>
          orderService(deps).confirm({
            token: request.token,
            now: scope.now,
            signal: scope.signal,
          })
        )
      ),

    discardOrder: (request) =>
      scoped(deps, request.signal, (scope) =>
        orderService(deps).discard({ token: request.token, now: scope.now, signal: scope.signal })
      ),

    setExit: (request) =>
      scopedSlow(deps, UNABORTED, (scope) =>
        refusedAsOperatorText(deps, () =>
          orderService(deps).setExit({
            ticker: request.ticker,
            exit: request.exit,
            ...(request.venue === undefined ? {} : { venue: request.venue }),
            ...(request.quantity === undefined ? {} : { quantity: request.quantity }),
            requestId: request.requestId,
            now: scope.now,
            signal: scope.signal,
          })
        )
      ),

    cancelExit: (request) =>
      scopedSlow(deps, UNABORTED, (scope) =>
        refusedAsOperatorText(deps, () =>
          orderService(deps).cancelExit({
            ticker: request.ticker,
            ...(request.venue === undefined ? {} : { venue: request.venue }),
            now: scope.now,
            signal: scope.signal,
          })
        )
      ),
  }
}

export function orderMethods(deps: TradingHostDeps): OrderMethods {
  return {
    ...orderWrites(deps),

    ordersEnabled: () => deps.services.order !== undefined,

    getTradeStatus: (request) =>
      scoped(deps, request.signal, (scope) =>
        orderService(deps).tradeStatus({ now: scope.now, signal: scope.signal })
      ),

    setBuyingHalted: (request) =>
      scoped(deps, request.signal, (scope) =>
        orderService(deps).setHalted({
          halted: request.halted,
          now: scope.now,
          signal: scope.signal,
        })
      ),

    reconcileOrders: (request) =>
      scoped(deps, request.signal, (scope) => orderService(deps).reconcileOrders(scope.signal)),

    clearUnmirrored: (request) =>
      scoped(deps, request.signal, (scope) =>
        orderService(deps).clearUnmirrored(request.token, scope.signal)
      ),
  }
}
