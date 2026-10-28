import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { AlertStore } from '@/trading/features/alerts/store/alert'
import type { DeliveringAlert, LeaseToken } from '@/trading/features/alerts/types'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { DeliveryErrorCode } from '@/trading/kernel/caveat'
import type { TradingConfig } from '@/trading/kernel/config'
import type { InstrumentRef, Ticker } from '@/trading/kernel/instrument'
import type { AlertId } from '@/trading/kernel/operator/alert'
import type {
  AlertFired,
  AlertFiredListener,
  TradingNotice,
  TradingNoticePayload,
  TradingNoticeSender,
} from '@/trading/kernel/operator/notice'
import type { OperationTickOptions } from '@/trading/kernel/store/page'
import type { MarketRegistry } from '@/trading/markets/types'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { buildLeaseToken, isScreenOrigin, parseExitLevel } from '@/trading/features/alerts/types'
import {
  nextAttemptAt,
  notifyDeliveryStopped,
  sendCaught,
} from '@/trading/kernel/operator/delivery-retry'
import { quotedInOf } from '@/trading/render/money'
import { liveMoveOf } from '@/trading/render/price-pair'

/** What a send needs, and nothing the evaluation half holds. */
interface AlertDeliveryDeps {
  readonly store: AlertStore
  readonly sender: TradingNoticeSender
  readonly config: TradingConfig
  readonly logger: Logger
  readonly defaultLocale: Locale
  readonly onAlertFired: AlertFiredListener
  readonly markets: MarketRegistry
  readonly marketData: Pick<MarketDataService, 'quote' | 'instrumentQuoteConvention'>
}

type AlertNoticePayload = Extract<TradingNoticePayload, { readonly alert: DeliveringAlert }>
type ScreenerSession = NonNullable<
  Extract<TradingNoticePayload, { readonly kind: 'screener-alert' }>['session']
>

export interface DeliveryResult {
  readonly delivered: number
  readonly deferred: number
}

/** Only a completed sender call marks fired. `claimDue` already incremented `attempts` atomically
 *  with the lease transition, so this is the count both the maximum decision and the backoff read;
 *  `deferDelivery` never touches it. A throw mid-batch, abort included, hands the unfinished claims
 *  back — lease cleared, attempt uncounted — before it propagates. */
export async function deliverDue(
  deps: AlertDeliveryDeps,
  options: OperationTickOptions<AlertId>
): Promise<DeliveryResult> {
  const leaseToken = buildLeaseToken()
  const claimed = await deps.store.claimDue({
    now: options.now,
    leaseToken,
    leaseUntil: options.now + deps.config.operations.deliveryLeaseMs,
    limit: options.batchSize,
    signal: options.signal,
  })
  const tally = { delivered: 0, deferred: 0 }
  let index = 0

  try {
    for (; index < claimed.length; index += 1) {
      const alert = claimed[index]

      if (alert === undefined) {
        break
      }

      await deliverClaimedAlert(deps, { alert, leaseToken, options, tally })
    }
  } catch (err: unknown) {
    await releaseRemaining(deps, { claimed: claimed.slice(index), leaseToken, now: options.now })

    throw err
  }

  return tally
}

interface ClaimedAlertDelivery {
  readonly alert: DeliveringAlert
  readonly leaseToken: LeaseToken
  readonly options: OperationTickOptions<AlertId>
  readonly tally: { delivered: number; deferred: number }
}

async function deliverClaimedAlert(
  deps: AlertDeliveryDeps,
  context: ClaimedAlertDelivery
): Promise<void> {
  const { alert, leaseToken, options, tally } = context
  const retry = deps.config.operations.deliveryRetry

  // `claimDue` counted this try before the read, so one means the first: a send that is retried
  // never starts a job again.
  if (alert.attempts === 1) {
    announceFired(deps, alert, options.now)
  }

  const notice = await noticeFor(deps, alert, options)
  const outcome = await sendCaught(deps.sender, notice, options.signal)

  if (outcome === 'accepted') {
    const fired = await deps.store.markFired({
      alertId: alert.id,
      leaseToken,
      firedAt: options.now,
      signal: options.signal,
    })

    tally.delivered += fired ? 1 : 0
    return
  }

  // No retry reaches a chat whose pairing was revoked, whoever armed the alert.
  if (outcome === 'recipient-revoked') {
    await disableUndeliverable(deps, context, outcome)
    return
  }

  // A channel that never accepts must not retry forever, so a system-armed row ends disabled and
  // reconcile re-arms it. An operator alert has no origin to re-arm it and disabling would lose a
  // crossing they never saw, so it stays on the backoff ladder, whose ceiling holds it to one try
  // an hour.
  if (alert.attempts >= retry.maximumAttempts) {
    if (alert.origin !== undefined) {
      await disableUndeliverable(deps, context, outcome)
      return
    }

    deps.logger.warn('trading.alert_delivery_still_failing', {
      alertId: alert.id,
      attempts: alert.attempts,
    })
  }

  const defer = await deps.store.deferDelivery({
    alertId: alert.id,
    leaseToken,
    nextDueAt: nextAttemptAt(options.now, alert.attempts, retry),
    errorCode: outcome,
    signal: options.signal,
  })

  tally.deferred += defer ? 1 : 0
}

/** Tells whoever listens that this alert fired, before the send. A listener that throws is logged
 *  and never fails the delivery: the operator's notice matters more than what it triggers. */
function announceFired(deps: AlertDeliveryDeps, alert: DeliveringAlert, firedAt: number): void {
  const event = firedEventOf(alert)

  if (event === undefined) {
    return
  }

  try {
    deps.onAlertFired({
      alertId: alert.id,
      event,
      instrument: alert.instrument,
      condition: alert.condition,
      threshold: alert.threshold,
      observedPrice: alert.observedPrice,
      firedAt,
    })
  } catch (err: unknown) {
    deps.logger.warn('trading.alert_listener_failed', {
      alertId: alert.id,
      err: formatErrForLog(err),
    })
  }
}

/** Which arming pass owns the row, in the words a job names it: an exit's level, a screener band,
 *  or a name the operator armed. A foreign origin names none. */
function firedEventOf(alert: DeliveringAlert): AlertFired['event'] | undefined {
  if (alert.origin === undefined) {
    return 'price'
  }

  return isScreenOrigin(alert.origin) ? 'mover' : (parseExitLevel(alert.origin) ?? undefined)
}

/** A revoked chat gets no notice: the send would be refused like the alert was. */
async function disableUndeliverable(
  deps: AlertDeliveryDeps,
  context: ClaimedAlertDelivery,
  errorCode: DeliveryErrorCode
): Promise<void> {
  const { alert, options } = context

  if (errorCode !== 'recipient-revoked') {
    await notifyDeliveryStopped({
      kind: 'delivery-disabled',
      sender: deps.sender,
      target: alert.delivery,
      locale: deps.defaultLocale,
      subject: alertPayload(alert).kind,
      logger: deps.logger,
      signal: options.signal,
    })
  }

  await deps.store.disable({
    alertId: alert.id,
    disabledAt: options.now,
    errorCode,
    signal: options.signal,
  })
}

/** Cleanup, not delivery: a failed release is logged and its lease left to expire, because masking
 *  the abort with a storage error would turn shutdown into a task failure. */
async function releaseRemaining(
  deps: AlertDeliveryDeps,
  input: {
    readonly claimed: readonly DeliveringAlert[]
    readonly leaseToken: LeaseToken
    readonly now: number
  }
): Promise<void> {
  for (const alert of input.claimed) {
    try {
      await deps.store.release({ alertId: alert.id, leaseToken: input.leaseToken, now: input.now })
    } catch (err: unknown) {
      deps.logger.warn('trading.alert_release_failed', {
        alertId: alert.id,
        err: formatErrForLog(err),
      })
    }
  }
}

/** The notice carries the alert itself, including its stable id: a crash between `accepted` and
 *  `markFired` may duplicate, and a duplicate the user can recognise beats a lost alert. */
async function noticeFor(
  deps: AlertDeliveryDeps,
  alert: DeliveringAlert,
  options: OperationTickOptions<AlertId>
): Promise<TradingNotice> {
  const payload = alertPayload(alert)
  const { ticker, market } = alert.instrument
  const [convention, session] = await Promise.all([
    bestEffort(deps, { ticker, signal: options.signal }, () =>
      deps.marketData.instrumentQuoteConvention({ ticker, market, signal: options.signal })
    ),
    payload.kind === 'screener-alert' ? screenerSession(deps, alert, options) : undefined,
  ])
  const quote =
    convention === undefined
      ? {}
      : { quote: { currency: convention.currency, ...quotedInOf(convention) } }

  return {
    target: alert.delivery,
    locale: deps.defaultLocale,
    payload:
      payload.kind === 'screener-alert'
        ? { ...payload, ...quote, ...(session === undefined ? {} : { session }) }
        : { ...payload, ...quote },
  }
}

/** The name's session move beside its market's benchmark, so a notice says whether the whole
 *  market is moving. A market that declares no benchmark prints the name alone. */
async function screenerSession(
  deps: AlertDeliveryDeps,
  alert: DeliveringAlert,
  options: OperationTickOptions<AlertId>
): Promise<ScreenerSession | undefined> {
  const declared = deps.markets.find(alert.instrument.market)?.manifest.benchmark
  const benchmark = declared?.ticker === alert.instrument.ticker ? undefined : declared
  const [movePct, benchmarkMovePct] = await Promise.all([
    sessionMovePct(deps, alert.instrument, options),
    benchmark === undefined ? undefined : sessionMovePct(deps, benchmark, options),
  ])

  if (movePct === undefined) {
    return undefined
  }

  return {
    movePct,
    ...(benchmark === undefined || benchmarkMovePct === undefined
      ? {}
      : { benchmark: { ticker: benchmark.ticker, movePct: benchmarkMovePct } }),
  }
}

/** Absent outside a live session, so a retry after the close cannot state a move as today's. */
async function sessionMovePct(
  deps: AlertDeliveryDeps,
  instrument: InstrumentRef,
  options: OperationTickOptions<AlertId>
): Promise<number | undefined> {
  const result = await bestEffort(deps, { ticker: instrument.ticker, signal: options.signal }, () =>
    deps.marketData.quote({
      ticker: instrument.ticker,
      market: instrument.market,
      now: options.now,
      signal: options.signal,
      withPreviousClose: true,
    })
  )

  if (result?.kind !== 'available') {
    return undefined
  }

  const { observed, previousClose, quote } = result.value

  return liveMoveOf({
    ...(previousClose === undefined ? {} : { previousClose }),
    live: {
      price: quote.price,
      observed,
      ...(quote.changePct === undefined ? {} : { changePct: quote.changePct }),
    },
  })
}

/** A failed read drops its line, never the notice. An abort still propagates, so shutdown hands the
 *  unsent claims back. */
async function bestEffort<T>(
  deps: AlertDeliveryDeps,
  context: { readonly ticker: Ticker; readonly signal: AbortSignal },
  read: () => Promise<T>
): Promise<T | undefined> {
  try {
    return await read()
  } catch (err: unknown) {
    if (context.signal.aborted || isAbortError(err)) {
      throw err
    }

    deps.logger.warn('trading.alert_notice_read_failed', {
      ticker: context.ticker,
      err: formatErrForLog(err),
    })

    return undefined
  }
}

/** Which arming pass owns the row decides how it reads: an operator alert, a suggestion's exit
 *  level, or a screener band. */
function alertPayload(alert: DeliveringAlert): AlertNoticePayload {
  if (alert.origin === undefined) {
    return { kind: 'price-alert', alert }
  }

  return isScreenOrigin(alert.origin)
    ? { kind: 'screener-alert', alert }
    : { kind: 'exit-alert', alert }
}
