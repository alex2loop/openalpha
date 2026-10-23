import type { DaemonTask } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import type { AlertService } from '@/trading/features/alerts/types'
import type { BriefService } from '@/trading/features/brief/types'
import type { VenueFill } from '@/trading/features/ledger/sync'
import type { IntradayReportDeps } from '@/trading/features/market-data/intraday/report'
import type { IntradaySettingsStore } from '@/trading/features/market-data/store/intraday-settings'
import type { RestingExitStore } from '@/trading/features/order/store/resting-exit'
import type { OrderService } from '@/trading/features/order/types'
import type { NavSnapshotTick } from '@/trading/features/portfolio/nav/types'
import type { PortfolioService } from '@/trading/features/portfolio/types'
import type { SuggestionService } from '@/trading/features/suggestion/suggestion'
import type { FactorLogService } from '@/trading/features/suggestion/track-record/factor-log-types'
import type { ThemeService } from '@/trading/features/themes/types'
import type { OperationPolicy, TradingConfig } from '@/trading/kernel/config'
import type {
  RefreshAllMarketDataOptions,
  RefreshMarketDataResult,
} from '@/trading/kernel/market/refresh'
import type { DeliveryAddress } from '@/trading/kernel/operator/delivery'
import type { OrderFilledListener, TradingNoticeSender } from '@/trading/kernel/operator/notice'
import type { MarketRegistry } from '@/trading/markets/types'
import type { VenueRegistry } from '@/trading/venues/types'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { createBriefTick } from '@/trading/features/brief/tick'
import { resolveIntradayPlan } from '@/trading/features/market-data/intraday/schedule'
import {
  createIntradayTick,
  IDLE_DELAY_MS,
  nextIntradayDelayMs,
} from '@/trading/features/market-data/ops/intraday'
import {
  logRefreshDegradations,
  refreshDegradations,
} from '@/trading/features/market-data/ops/refresh'
import { nextRefreshDelayMs } from '@/trading/features/market-data/ops/refresh-schedule'
import { createExitTick } from '@/trading/features/order/exit-tick'
import { createFactorLogTick } from '@/trading/features/suggestion/track-record/factor-log-tick'
import { createOutcomeTick } from '@/trading/features/suggestion/track-record/tick'
import { createThemeOutcomeTick } from '@/trading/features/themes/outcomes/tick'
import { nextAttemptAt } from '@/trading/kernel/operator/delivery-retry'
import {
  createDelayedLoopTask,
  createLoopTask,
  type OperationTick,
  type Reachability,
} from '@/trading/wiring/loop'
import { withQuarantine } from '@/trading/wiring/quarantine'

interface TradingDaemonDeps {
  readonly config: TradingConfig
  readonly alerts: AlertService
  readonly suggestions: SuggestionService
  readonly factorLog: FactorLogService
  readonly navSnapshot: NavSnapshotTick
  macroExtractTick(policy: OperationPolicy): OperationTick
  readonly themes: Pick<ThemeService, 'resolveOutcomes'>
  readonly briefs: BriefService
  readonly markets: MarketRegistry
  readonly portfolio: Pick<PortfolioService, 'positionsAt' | 'record'>
  readonly reportDeps: IntradayReportDeps
  readonly intradaySettings: IntradaySettingsStore
  readonly restingExit: RestingExitStore
  isFillBooked(fill: VenueFill, signal: AbortSignal): Promise<boolean>
  readonly venues: VenueRegistry
  readonly order?: Pick<OrderService, 'reconcileUnmirrored'>
  readonly sender: TradingNoticeSender
  readonly onFilled: OrderFilledListener
  /** Called with the pass time once an alert pass has delivered what was armed. */
  readonly onAlertsChecked?: (at: number) => void
  recipient(): DeliveryAddress | undefined
  refreshMarketData(
    options: RefreshAllMarketDataOptions
  ): Promise<readonly RefreshMarketDataResult[]>
  readonly logger: Logger
}

/** The bounded loops behind one factory, plus the exit reconciler when some venue accepts orders
 *  and the intent sweep when an order service exists. Each starts with the daemon; the underlying
 *  service returns immediately when there is no eligible work. */
export function createTradingDaemonTasks(deps: TradingDaemonDeps): readonly DaemonTask[] {
  const { operations } = deps.config
  const { logger } = deps
  const tasks = [
    alertTask(deps),
    operationTask({
      name: 'trading.outcomes',
      policy: operations.outcomes,
      logger,
      reachability: operations,
      tickFor: (policy) =>
        createOutcomeTick({ suggestions: deps.suggestions, batchSize: policy.batchSize }),
    }),
    operationTask({
      name: 'trading.macro-extract',
      policy: operations.macroExtract,
      logger,
      reachability: operations,
      tickFor: (policy) => deps.macroExtractTick(policy),
    }),
    operationTask({
      name: 'trading.theme-outcomes',
      policy: operations.themeOutcomes,
      logger,
      reachability: operations,
      tickFor: (policy) =>
        createThemeOutcomeTick({ themes: deps.themes, batchSize: policy.batchSize, logger }),
    }),
    operationTask({
      name: 'trading.briefs',
      policy: operations.briefs,
      logger,
      reachability: operations,
      tickFor: (policy) => createBriefTick({ briefs: deps.briefs, batchSize: policy.batchSize }),
    }),
    refreshTask(deps),
    intradayTask(deps),
    ...exitTasks(deps),
    ...intentTasks(deps),
  ]

  const quarantine = {
    sender: deps.sender,
    recipient: deps.recipient,
    locale: deps.reportDeps.locale,
    logger,
  }

  return Object.freeze(tasks.map((task) => withQuarantine(task, quarantine)))
}

/** No venue accepting orders means no exchange, so there is nothing resting to reconcile and no
 *  loop to run. */
function exitTasks(deps: TradingDaemonDeps): readonly DaemonTask[] {
  if (!deps.venues.list().some((venue) => venue.adapter !== undefined)) {
    return []
  }

  return [
    operationTask({
      name: 'trading.exits',
      policy: deps.config.operations.exits,
      logger: deps.logger,
      reachability: deps.config.operations,
      tickFor: (policy) =>
        createExitTick({
          venues: deps.venues,
          resting: deps.restingExit,
          portfolio: deps.portfolio,
          markets: deps.markets,
          batchSize: policy.batchSize,
          logger: deps.logger,
          isFillBooked: deps.isFillBooked,
          onFilled: deps.onFilled,
          notifyFill: (sale, signal) => notifyFill(deps, sale, signal),
        }),
    }),
  ]
}

/** Tells the operator an exit filled, at the chat the daemon would use. With no recipient there is
 *  nobody to tell and the ledger row is the record. A refused send is logged and never retried: the
 *  sale is booked either way, and a second send could not be told apart from the first. */
async function notifyFill(
  deps: TradingDaemonDeps,
  sale: VenueFill,
  signal: AbortSignal
): Promise<void> {
  const target = deps.recipient()

  if (target === undefined) {
    return
  }

  const { draft } = sale
  const outcome = await deps.sender.send(
    {
      target,
      locale: deps.reportDeps.locale,
      payload: {
        kind: 'exit-filled',
        fill: {
          instrument: draft.instrument,
          venue: draft.venue,
          quantity: draft.quantity,
          unitPrice: draft.unitPrice,
          currency: draft.currency,
          ...(draft.closeReason === undefined ? {} : { closeReason: draft.closeReason }),
        },
      },
    },
    signal
  )

  if (outcome !== 'accepted') {
    deps.logger.warn('trading.exit_fill_notice_undelivered', {
      ticker: draft.instrument.ticker,
      outcome,
    })
  }
}

/** No order service means no exchange this tree can ask, so there is nothing to settle. */
function intentTasks(deps: TradingDaemonDeps): readonly DaemonTask[] {
  const { order, logger } = deps

  if (order === undefined) {
    return []
  }

  const policy = deps.config.operations.intents

  return [
    createLoopTask({
      name: 'trading.intents',
      nextDelayMs: () => policy.intervalMs,
      logger,
      reachability: deps.config.operations,
      tick: async (signal) => {
        const review = await order.reconcileUnmirrored(signal)

        if (review.settled > 0) {
          logger.info('order.unmirrored_settled', {
            settled: review.settled,
            outstanding: review.outstanding.length,
          })
        }
      },
    }),
  ]
}

/** One service, one loop: it delivers what is already armed, then reconciles the two system-armed
 *  families against the book. Delivering first is what keeps a row out of the tick that armed it. A
 *  failure of the delivery itself quarantines the loop; an arming pass only adds and retires rows,
 *  so its failure never reaches the delivery of the next interval. */
function alertTask(deps: TradingDaemonDeps): DaemonTask {
  const { alerts, logger } = deps
  const policy = deps.config.operations.alerts

  return createLoopTask({
    name: 'trading.alerts',
    nextDelayMs: () => policy.intervalMs,
    logger,
    reachability: deps.config.operations,
    tick: async (signal) => {
      const options = { now: Date.now(), batchSize: policy.batchSize, signal }

      await alerts.tick(options)
      deps.onAlertsChecked?.(options.now)
      await armingStep(logger, 'exits', () => alerts.tickExits(options))
      await armingStep(logger, 'screeners', () => alerts.tickScreeners(options))
    },
  })
}

/** Each pass fails alone: the other still runs, and the next interval retries both. An abort is
 *  shutdown, not a failure. */
async function armingStep(
  logger: Logger,
  name: 'exits' | 'screeners',
  run: () => Promise<void>
): Promise<void> {
  try {
    await run()
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    logger.warn('trading.alert_arming_failed', { step: name, err: formatErrForLog(err) })
  }
}

interface OperationTaskSpec {
  readonly name: string
  readonly policy: OperationPolicy
  readonly logger: Logger
  readonly reachability: Reachability
  tickFor(policy: OperationPolicy): OperationTick
}

function operationTask(spec: OperationTaskSpec): DaemonTask {
  return createLoopTask({
    name: spec.name,
    nextDelayMs: () => spec.policy.intervalMs,
    logger: spec.logger,
    reachability: spec.reachability,
    tick: spec.tickFor(spec.policy),
  })
}

function refreshTask(deps: TradingDaemonDeps): DaemonTask {
  const { refresh, refreshRetry, factorLog } = deps.config.operations
  const factorLogTick = createFactorLogTick({
    factorLog: deps.factorLog,
    batchSize: factorLog.batchSize,
    logger: deps.logger,
  })
  let failedPasses = 0

  // Ticks at start rather than waiting for an anchor: it joins a boot sweep still in flight, and
  // after an offline boot it is the pass that waits for the network and enters the retry ladder.
  return createLoopTask({
    name: 'trading.refresh',
    nextDelayMs: (now) => {
      const anchorMs = nextRefreshDelayMs(deps.markets, now, refresh.intervalMs)

      if (failedPasses === 0 || failedPasses >= refreshRetry.maximumAttempts) {
        return anchorMs
      }

      return Math.min(anchorMs, nextAttemptAt(now, failedPasses, refreshRetry) - now)
    },
    logger: deps.logger,
    reachability: deps.config.operations,
    tick: async (signal) => {
      const results = await deps.refreshMarketData({ signal })
      const degradations = refreshDegradations(results)
      const emptied = results.some((result) =>
        result.results.some((kind) => kind.status === 'unavailable')
      )

      if (degradations.length > 0) {
        logRefreshDegradations({ logger: deps.logger, forced: false, degradations })
      }

      failedPasses = emptied ? (failedPasses % refreshRetry.maximumAttempts) + 1 : 0

      await deps.navSnapshot(signal)
      await factorLogTick(signal)
    },
  })
}

function intradayTask(deps: TradingDaemonDeps): DaemonTask {
  // Resolved once: the registry and the config are both frozen by the time tasks are built, and
  // boot has already rejected a `defaultRegion` no market covers.
  const plan = resolveIntradayPlan(deps, deps.config.defaultRegion)

  // `createDelayedLoopTask` waits before the first tick, so the loop sleeps until the first
  // configured fire rather than sending one at boot.
  return createDelayedLoopTask({
    name: 'trading.intraday',
    nextDelayMs: (now) => nextIntradayDelayMs(plan, now, IDLE_DELAY_MS),
    logger: deps.logger,
    reachability: deps.config.operations,
    tick: createIntradayTick({
      ...deps.reportDeps,
      plan,
      settings: deps.intradaySettings,
      sender: deps.sender,
      recipient: deps.recipient,
      logger: deps.logger,
    }),
  })
}
