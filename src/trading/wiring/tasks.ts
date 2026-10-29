import type { DaemonTask, TaskPassListener } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import type { AlertService } from '@/trading/features/alerts/types'
import type { BriefService } from '@/trading/features/brief/types'
import type { VenueFill } from '@/trading/features/ledger/sync'
import type { IntradayReportDeps } from '@/trading/features/market-data/intraday/report'
import type { HeldWatch } from '@/trading/features/market-data/ops/held-watch'
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
import type {
  OrderFill,
  OrderFilledListener,
  TradingNoticeSender,
} from '@/trading/kernel/operator/notice'
import type { MarketRegistry } from '@/trading/markets/types'
import type { VenueRegistry } from '@/trading/venues/types'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { createBriefTick } from '@/trading/features/brief/tick'
import { resolveIntradayPlan } from '@/trading/features/market-data/intraday/schedule'
import {
  createIntradayTick,
  createIntradayTiming,
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
  type PassNotes,
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
  /** How late after its slot a timed send may still go out (`[schedule] late_grace_ms`). */
  readonly lateGraceMs: number
  readonly restingExit: RestingExitStore
  isFillBooked(fill: VenueFill, signal: AbortSignal): Promise<boolean>
  readonly venues: VenueRegistry
  readonly order?: Pick<OrderService, 'reconcileUnmirrored'>
  readonly sender: TradingNoticeSender
  /** Told once per alert pass, after the alerts: the bell hears about held names and a falling index. */
  readonly heldWatch: HeldWatch
  readonly onFilled: OrderFilledListener
  /** Called with the pass time once an alert pass has delivered what was armed. */
  readonly onAlertsChecked?: (at: number) => void
  /** Told each pass of every loop below, so the app can show when each last ran and runs next. */
  readonly onTaskPass: TaskPassListener
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
  const { logger } = deps
  const tasks = [
    alertTask(deps),
    ...operationTasks(deps),
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

/** The loops that each run one batch-sized service call at their own interval. */
function operationTasks(deps: TradingDaemonDeps): readonly DaemonTask[] {
  const { operations } = deps.config
  const { logger } = deps

  return [
    operationTask(deps, {
      name: 'trading.outcomes',
      policy: operations.outcomes,
      tickFor: (policy) =>
        createOutcomeTick({ suggestions: deps.suggestions, batchSize: policy.batchSize }),
    }),
    operationTask(deps, {
      name: 'trading.macro-extract',
      policy: operations.macroExtract,
      tickFor: (policy) => deps.macroExtractTick(policy),
    }),
    operationTask(deps, {
      name: 'trading.theme-outcomes',
      policy: operations.themeOutcomes,
      tickFor: (policy) =>
        createThemeOutcomeTick({ themes: deps.themes, batchSize: policy.batchSize, logger }),
    }),
    operationTask(deps, {
      name: 'trading.briefs',
      policy: operations.briefs,
      tickFor: (policy) => createBriefTick({ briefs: deps.briefs, batchSize: policy.batchSize }),
    }),
  ]
}

/** No venue accepting orders means no exchange, so there is nothing resting to reconcile and no
 *  loop to run. */
function exitTasks(deps: TradingDaemonDeps): readonly DaemonTask[] {
  if (!deps.venues.list().some((venue) => venue.adapter !== undefined)) {
    return []
  }

  return [
    operationTask(deps, {
      name: 'trading.exits',
      policy: deps.config.operations.exits,
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
          notifyFill: (fill, signal) => notifyFill(deps, fill, signal),
        }),
    }),
  ]
}

/** Tells the operator an exit filled, at the chat the daemon would use. With no recipient there is
 *  nobody to tell and the ledger row is the record. A refused send is logged and never retried: the
 *  sale is booked either way, and a second send could not be told apart from the first. */
async function notifyFill(
  deps: TradingDaemonDeps,
  fill: OrderFill,
  signal: AbortSignal
): Promise<void> {
  const target = deps.recipient()

  if (target === undefined) {
    return
  }

  const outcome = await deps.sender.send(
    {
      target,
      locale: deps.reportDeps.locale,
      payload: { kind: 'exit-filled', fill },
    },
    signal
  )

  // An aborted send is shutdown, not a refusal.
  if (outcome !== 'accepted' && outcome !== 'aborted') {
    deps.logger.warn('trading.exit_fill_notice_undelivered', {
      ticker: fill.instrument.ticker,
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
      everyMs: policy.intervalMs,
      nextDelayMs: () => policy.intervalMs,
      logger,
      reachability: deps.config.operations,
      onTaskPass: deps.onTaskPass,
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
    everyMs: policy.intervalMs,
    nextDelayMs: () => policy.intervalMs,
    logger,
    reachability: deps.config.operations,
    onTaskPass: deps.onTaskPass,
    tick: async (signal, notes) => {
      const options = { now: Date.now(), batchSize: policy.batchSize, signal }

      await alerts.tick(options)
      deps.onAlertsChecked?.(options.now)
      await armingStep({ logger, notes, name: 'exits' }, () => alerts.tickExits(options))
      await armingStep({ logger, notes, name: 'screeners' }, () => alerts.tickScreeners(options))
      await deps.heldWatch(options)
    },
  })
}

interface ArmingStep {
  readonly logger: Logger
  readonly notes: PassNotes
  readonly name: 'exits' | 'screeners'
}

/** Each pass fails alone: the other still runs, and the next interval retries both. The loop's
 *  pass carries the failure as its error. An abort is shutdown, not a failure. */
async function armingStep(step: ArmingStep, run: () => Promise<void>): Promise<void> {
  try {
    await run()
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    const failure = formatErrForLog(err)

    step.logger.warn('trading.alert_arming_failed', { step: step.name, err: failure })
    step.notes.fail()
  }
}

interface OperationTaskSpec {
  readonly name: string
  readonly policy: OperationPolicy
  tickFor(policy: OperationPolicy): OperationTick
}

function operationTask(deps: TradingDaemonDeps, spec: OperationTaskSpec): DaemonTask {
  return createLoopTask({
    name: spec.name,
    everyMs: spec.policy.intervalMs,
    nextDelayMs: () => spec.policy.intervalMs,
    logger: deps.logger,
    reachability: deps.config.operations,
    onTaskPass: deps.onTaskPass,
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
    onTaskPass: deps.onTaskPass,
    tick: async (signal) => {
      const results = await deps.refreshMarketData({ signal, scheduled: true })
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
  const timing = createIntradayTiming(plan)

  // `createDelayedLoopTask` waits before the first tick, so the loop sleeps until the first
  // configured fire rather than sending one at boot.
  return createDelayedLoopTask({
    name: 'trading.intraday',
    nextDelayMs: timing.nextDelayMs,
    logger: deps.logger,
    reachability: deps.config.operations,
    onTaskPass: deps.onTaskPass,
    tick: createIntradayTick({
      ...deps.reportDeps,
      plan,
      timing,
      lateGraceMs: deps.lateGraceMs,
      settings: deps.intradaySettings,
      sender: deps.sender,
      recipient: deps.recipient,
      logger: deps.logger,
    }),
  })
}
