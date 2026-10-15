import { lookup } from 'node:dns/promises'

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
import type { OperationPolicy, OperationsPolicy, TradingConfig } from '@/trading/kernel/config'
import type {
  RefreshAllMarketDataOptions,
  RefreshMarketDataResult,
} from '@/trading/kernel/market/refresh'
import type { DeliveryAddress } from '@/trading/kernel/operator/delivery'
import type { TradingNoticeSender } from '@/trading/kernel/operator/notice'
import type { MarketRegistry } from '@/trading/markets/types'
import type { VenueRegistry } from '@/trading/venues/types'
import { ChannelError, isAbortError, LLMError, RunHalted, StorageError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { settleWithin } from '@/core/utils/concurrency'
import { sleep } from '@/core/utils/time'
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
import { withQuarantine } from '@/trading/wiring/quarantine'

type OperationTick = (signal: AbortSignal) => Promise<void>
type Reachability = Pick<
  OperationsPolicy,
  'reachabilityHost' | 'reachabilityTimeoutMs' | 'offlineRetryMs'
>

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
  recipient(): DeliveryAddress | undefined
  refreshMarketData(
    options: RefreshAllMarketDataOptions
  ): Promise<readonly RefreshMarketDataResult[]>
  readonly logger: Logger
}

interface LoopSpec {
  readonly name: string
  nextDelayMs(now: number): number
  readonly tick: OperationTick
  readonly logger: Logger
  readonly reachability: Reachability
}

/** Eight bounded loops behind one factory, plus the exit reconciler when some venue accepts orders
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
        }),
    }),
  ]
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
 *  families against the book. Delivering first is what keeps a row out of the tick that armed it. */
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
      await alerts.tickExits(options)
      await alerts.tickScreeners(options)
    },
  })
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

/** The one loop. There is no `setInterval` anywhere in trading: an interval that fires while the
 *  previous tick is still running is how a bounded loop becomes concurrent with itself. */
function createLoopTask(spec: LoopSpec): DaemonTask {
  return {
    name: spec.name,
    async start(signal) {
      await runLoop(spec, signal)
    },
  }
}

function createDelayedLoopTask(spec: LoopSpec): DaemonTask {
  return {
    name: spec.name,
    async start(signal) {
      if (!(await waitForNextTick(spec.nextDelayMs(Date.now()), signal))) {
        return
      }

      await runLoop(spec, signal)
    },
  }
}

async function runLoop(spec: LoopSpec, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    if (!(await waitUntilReachable(spec, signal))) {
      return
    }

    if (!(await runTick(spec, signal))) {
      return
    }

    if (!(await waitForNextTick(spec.nextDelayMs(Date.now()), signal))) {
      return
    }
  }
}

/** `false` means stop. A tick waits out an offline stretch instead of running into it, so a fetch
 *  trips no source breaker and a send burns no delivery attempt. One warning per stretch. */
async function waitUntilReachable(spec: LoopSpec, signal: AbortSignal): Promise<boolean> {
  const { reachabilityHost, reachabilityTimeoutMs, offlineRetryMs } = spec.reachability
  let warned = false

  for (;;) {
    // The OS resolver, the path every outbound fetch takes: raw DNS or an address policy would gate
    // on a different question than the one the tick is about to ask.
    const resolved = lookup(reachabilityHost).then(
      () => true,
      () => false
    )
    const reachable = (await settleWithin(resolved, reachabilityTimeoutMs)) && (await resolved)

    if (reachable) {
      return true
    }

    if (signal.aborted) {
      return false
    }

    if (!warned) {
      spec.logger.warn('trading.tick_offline', { operation: spec.name, host: reachabilityHost })
      warned = true
    }

    if (!(await waitForNextTick(offlineRetryMs, signal))) {
      return false
    }
  }
}

/** `false` means stop. A boundary failure is logged and retried on the next interval; an invariant
 *  failure escapes to the quarantine around the loop rather than spinning forever getting the same
 *  thing wrong; an abort is shutdown, not a failure. */
async function runTick(spec: LoopSpec, signal: AbortSignal): Promise<boolean> {
  try {
    await spec.tick(signal)
    return true
  } catch (err: unknown) {
    if (isAbortError(err)) {
      return false
    }

    if (!isBoundaryFailure(err)) {
      throw err
    }

    spec.logger.warn('trading.tick_failed', { operation: spec.name, err: formatErrForLog(err) })
    return true
  }
}

/** A storage, channel, or provider failure is the outside world being unreachable, and the next
 *  interval is the right response. Everything else — a validation failure, a lost invariant, a
 *  misconfiguration — is this code being wrong, and retrying it forever would hide that. */
export function isBoundaryFailure(err: unknown): boolean {
  if (err instanceof RunHalted) {
    return err.code === 'budget' || err.code === 'rate'
  }

  return err instanceof StorageError || err instanceof ChannelError || err instanceof LLMError
}

/** `sleep` rejects on abort, which here means shutdown rather than a task failure, so the loop
 *  exits normally instead of propagating it to the tracker. */
async function waitForNextTick(delayMs: number, signal: AbortSignal): Promise<boolean> {
  try {
    await sleep(delayMs, signal)
    return true
  } catch (err: unknown) {
    if (isAbortError(err)) {
      return false
    }

    throw err
  }
}
