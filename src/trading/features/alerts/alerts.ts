import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { DeliveryResult } from '@/trading/features/alerts/delivery'
import type { ExitReconcileDeps, ExitWatchDeps } from '@/trading/features/alerts/exits'
import type { PriceObservation } from '@/trading/features/alerts/observation'
import type { ScreenerReconcileDeps } from '@/trading/features/alerts/screeners'
import type { AlertStore } from '@/trading/features/alerts/store/alert'
import type {
  ActiveAlert,
  Alert,
  AlertDeliveryBatch,
  AlertRefResolution,
  AlertService,
  CreateAlertOptions,
  DisableAlertOptions,
  DisableAlertResult,
} from '@/trading/features/alerts/types'
import type { BriefService } from '@/trading/features/brief/types'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { ExitPlanner } from '@/trading/features/suggestion/exit-plan/types'
import type { SuggestionStore } from '@/trading/features/suggestion/store/suggestion'
import type { Caveat } from '@/trading/kernel/caveat'
import type { TradingConfig } from '@/trading/kernel/config'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { AlertId } from '@/trading/kernel/operator/alert'
import type { TradingNoticeSender } from '@/trading/kernel/operator/notice'
import type { OperationTickOptions } from '@/trading/kernel/store/page'
import type { MarketRegistry } from '@/trading/markets/types'
import { ValidationError } from '@/core/errors'
import { lruMap } from '@/core/utils/collections'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { deliverDue } from '@/trading/features/alerts/delivery'
import {
  reconcileExitAlerts,
  stalePositions,
  unwatchedPositions,
  watchPositionExits,
} from '@/trading/features/alerts/exits'
import { observePrice, toCrossing } from '@/trading/features/alerts/observation'
import { reconcileScreenerAlerts } from '@/trading/features/alerts/screeners'
import { stopDistances } from '@/trading/features/alerts/stop-distances'
import { resolveInstrument } from '@/trading/features/market-data/resolve'
import { buildInstrumentKey, isIdRef } from '@/trading/kernel/instrument'
import { buildAlertId } from '@/trading/kernel/operator/alert'

const ALERT_EVALUATION_CONCURRENCY = 4
/** Pages one tick walks before handing its position to the next. */
const MAXIMUM_EVALUATION_PAGES = 40
/** One entry per planned holding. Ids change when a plan is replaced, so the bound is what keeps a
 *  long-running daemon's memo from growing with every roll. */
const PLAN_MEMO_CAPACITY = 512

interface AlertServiceDeps {
  readonly store: AlertStore
  readonly markets: MarketRegistry
  readonly marketData: MarketDataService
  readonly sender: TradingNoticeSender
  readonly config: TradingConfig
  readonly logger: Logger
  /** Delivery language. With one operator it can only ever be `[locale] language`, so it is read
   *  at send time rather than frozen onto each alert when it was armed. */
  readonly defaultLocale: Locale
  /** The arming passes read the book and the plans behind it; both arm through this same service,
   *  which is why they are its dependencies rather than services of their own. */
  readonly suggestions: SuggestionStore
  /** Writes the levels a held name is watched against when nothing does. */
  readonly exitPlans: ExitPlanner
  readonly briefs: Pick<BriefService, 'find'>
  readonly marketDataStore: ScreenerReconcileDeps['marketDataStore']
  tradeableHoldingsAt: ExitReconcileDeps['tradeableHoldingsAt']
  instrumentKinds: ExitWatchDeps['instrumentKinds']
  getProfile: ScreenerReconcileDeps['getProfile']
  /** Absent on an install with no exchange, where nothing could rest anywhere. */
  restingStops?: ExitReconcileDeps['restingStops']
}

interface EvaluationResult {
  readonly triggered: number
  readonly nextCursor?: AlertId
  readonly caveats: readonly Caveat[]
}

/** The service owns the store, the sender, and both arming passes; the daemon operations only
 *  loop. Nothing above this layer decides what "triggered" or "fired" mean, and the scan position
 *  lives here rather than in a caller's closure. */
export function createAlertService(deps: AlertServiceDeps): AlertService {
  // Never module scope: two services would otherwise share one scan position. It is set only when a
  // tick ran out of pages before the pool did; a completed sweep restarts from the front.
  let cursor: AlertId | undefined
  const arming = armingMethods(deps)
  const watch = exitWatchDeps(deps)
  // Never module scope: two services would otherwise share these memos, and a plan replaced under
  // one would read as already trailed or re-planned by the other.
  const exits = exitReconcileDeps(deps, arming, {
    trailedThrough: lruMap<string, TradingDay>(PLAN_MEMO_CAPACITY),
    replannedOn: lruMap<string, TradingDay>(PLAN_MEMO_CAPACITY),
  })
  const screeners = screenerReconcileDeps(deps, arming)

  return {
    ...arming,
    resolveRecipient: (origin) => deps.sender.resolveRecipient(origin),
    resolveAlertRef: (ref, signal) => resolveAlertRef(deps, ref, signal),
    list: (options) => deps.store.listPage(options),
    listWithActiveCount: async (options) => {
      const [page, activeCount] = await Promise.all([
        deps.store.listPage(options),
        deps.store.countActive(options.signal),
      ])

      return { ...page, activeCount }
    },
    listFired: (options) => deps.store.listFired(options),
    positionExits: (options) => watchPositionExits(watch, options),
    unwatchedPositions: (options) => unwatchedPositions(watch, options),
    stalePositions: (options) => stalePositions(watch, options),
    stopDistances: (options) => stopDistances(watch, options),
    poll: (options) => pollDeliveries(deps, options),

    async tick(options) {
      const batch = await pollDeliveries(deps, {
        ...options,
        ...(cursor === undefined ? {} : { cursor }),
      })

      cursor = batch.nextCursor
    },

    async tickExits(options) {
      await reconcileExitAlerts(exits, options)
    },

    async tickScreeners(options) {
      await reconcileScreenerAlerts(screeners, options)
    },
  }
}

/** The two methods both arming passes need. They are the service's own, handed to the passes so a
 *  reconcile can never reach past `create`/`disable` into the store. */
function armingMethods(deps: AlertServiceDeps): Pick<AlertService, 'create' | 'disable'> {
  return {
    create: (options: CreateAlertOptions) => create(deps, options),
    disable: (options: DisableAlertOptions): Promise<DisableAlertResult> =>
      deps.store.disable({
        alertId: options.alertId,
        disabledAt: options.now,
        signal: options.signal,
      }),
  }
}

function exitReconcileDeps(
  deps: AlertServiceDeps,
  alerts: Pick<AlertService, 'create' | 'disable'>,
  memos: Pick<ExitReconcileDeps, 'trailedThrough' | 'replannedOn'>
): ExitReconcileDeps {
  return {
    alerts,
    store: deps.store,
    suggestions: deps.suggestions,
    markets: deps.markets,
    exitPlans: deps.exitPlans,
    sender: deps.sender,
    logger: deps.logger,
    defaultLocale: deps.defaultLocale,
    briefs: deps.briefs,
    ...memos,
    tradeableHoldingsAt: deps.tradeableHoldingsAt,
    ...(deps.restingStops === undefined ? {} : { restingStops: deps.restingStops }),
  }
}

function screenerReconcileDeps(
  deps: AlertServiceDeps,
  alerts: Pick<AlertService, 'create' | 'disable'>
): ScreenerReconcileDeps {
  return {
    alerts,
    store: deps.store,
    briefs: deps.briefs,
    markets: deps.markets,
    marketDataStore: deps.marketDataStore,
    policy: deps.config.alerts,
    defaultLocale: deps.defaultLocale,
    getProfile: deps.getProfile,
    tradeableHoldingsAt: deps.tradeableHoldingsAt,
  }
}

/** A sweep delivers what is already due, evaluates the active alerts, then delivers again only if
 *  that triggered something - so a crossing found now is not held for the next tick. */
async function pollDeliveries(
  deps: AlertServiceDeps,
  options: OperationTickOptions<AlertId>
): Promise<AlertDeliveryBatch> {
  const tally = { delivered: 0, deferred: 0 }

  addDelivery(tally, await deliverDue(deps, options))

  const evaluated = await evaluateActive(deps, options)

  if (evaluated.triggered > 0) {
    addDelivery(tally, await deliverDue(deps, options))
  }

  return {
    triggered: evaluated.triggered,
    delivered: tally.delivered,
    deferred: tally.deferred,
    ...(evaluated.nextCursor === undefined ? {} : { nextCursor: evaluated.nextCursor }),
    caveats: evaluated.caveats,
  } satisfies AlertDeliveryBatch
}

/** The watch reads plans and holdings; it arms nothing, so it takes no alert seam. */
function exitWatchDeps(deps: AlertServiceDeps): ExitWatchDeps {
  return {
    markets: deps.markets,
    store: deps.suggestions,
    tradeableHoldingsAt: deps.tradeableHoldingsAt,
    instrumentKinds: deps.instrumentKinds,
  }
}

function addDelivery(tally: { delivered: number; deferred: number }, result: DeliveryResult): void {
  tally.delivered += result.delivered
  tally.deferred += result.deferred
}

async function resolveAlertRef(
  deps: AlertServiceDeps,
  ref: string,
  signal: AbortSignal
): Promise<AlertRefResolution> {
  const wanted = ref.trim().toLowerCase()

  // Before any query: `%` and `_` never reach `LIKE`.
  if (!isIdRef(wanted)) {
    return { kind: 'none' }
  }

  const ids = await deps.store.listIdsMatching(wanted, signal)
  const [only] = ids

  if (only === undefined) {
    return { kind: 'none' }
  }

  return ids.length === 1 ? { kind: 'one', id: only } : { kind: 'several', ids }
}

/** Both rejections happen before the insert: an unsupported instrument can never be evaluated,
 *  and a non-positive threshold would fire on the first quote. */
async function create(deps: AlertServiceDeps, options: CreateAlertOptions): Promise<Alert> {
  const { draft } = options

  if (!Number.isFinite(draft.threshold) || draft.threshold <= 0) {
    throw new ValidationError(`alert threshold must be finite and positive, got ${draft.threshold}`)
  }

  const { instrument } = draft
  const resolution = await resolveInstrument(deps.markets, {
    ticker: instrument.ticker,
    ...(instrument.market === undefined ? {} : { market: instrument.market }),
    signal: options.signal,
  })

  if (resolution.kind !== 'resolved') {
    const named = instrument.market === undefined ? '' : `${instrument.market}:`

    throw new ValidationError(`instrument is not supported: ${named}${instrument.ticker}`)
  }

  // An operator-armed alert (no origin) lands where the sender can reach; a system-armed one reuses
  // the address its stored row already carries. Before the write: an alert armed at an address the
  // router cannot reach would poll, trigger, fail every send and disable itself in silence.
  const delivery =
    draft.origin === undefined ? deps.sender.resolveRecipient(draft.delivery) : draft.delivery

  if (delivery === undefined) {
    throw new ValidationError('alert target cannot receive notices', {
      key: 'slash.tradingAlertUndeliverable',
    })
  }

  const alert: ActiveAlert = {
    id: buildAlertId(options.now),
    // The resolved ref, never the request: a stored row is polled for months and must name the
    // market it was armed on, whether or not the arming surface did.
    instrument: resolution.instrument,
    condition: draft.condition,
    threshold: draft.threshold,
    delivery,
    ...(draft.origin === undefined ? {} : { origin: draft.origin }),
    state: 'active',
    createdAt: options.now,
  }
  const result = await deps.store.create(alert, options.signal)

  return result.alert
}

interface EvaluationTick {
  readonly quotes: Map<string, Promise<PriceObservation | undefined>>
  readonly options: OperationTickOptions<AlertId>
}

interface AlertOutcome {
  readonly alert: ActiveAlert
  /** Absent when the instrument could not be priced this tick. */
  readonly crossing?: { readonly crossed: boolean; readonly price: number }
}

/** A tick pages through the whole pool so every stop or target is checked each minute however
 *  many are live. The sweep stops at `MAXIMUM_EVALUATION_PAGES` and hands its position back as
 *  `nextCursor` for the next tick; an abort ends it at the next page boundary. */
async function evaluateActive(
  deps: AlertServiceDeps,
  options: OperationTickOptions<AlertId>
): Promise<EvaluationResult> {
  const tick: EvaluationTick = { quotes: new Map(), options }
  const caveats: Caveat[] = []
  let triggered = 0
  let cursor = options.cursor

  for (let pages = 0; pages < MAXIMUM_EVALUATION_PAGES; pages += 1) {
    const page = await deps.store.listActive({
      ...(cursor === undefined ? {} : { cursor }),
      limit: options.batchSize,
      signal: options.signal,
    })
    const evaluated = await evaluatePage(deps, page.items, tick)

    triggered += evaluated.triggered
    caveats.push(...evaluated.caveats)

    if (page.nextCursor === undefined) {
      return { triggered, caveats }
    }

    cursor = page.nextCursor
  }

  return { triggered, caveats, ...(cursor === undefined ? {} : { nextCursor: cursor }) }
}

/** A crossing persists `triggered` with delivery due immediately; a missing or non-finite quote
 *  leaves the alert active and reports why, because an alert that silently stops watching is worse
 *  than one that says it could not look. Quotes are coalesced per instrument per tick and compared
 *  against the session's high/low, so a threshold touched between polls still fires, except in a
 *  session that opened before the alert did (see `toCrossing`). */
async function evaluatePage(
  deps: AlertServiceDeps,
  items: readonly ActiveAlert[],
  tick: EvaluationTick
): Promise<EvaluationResult> {
  const { options } = tick
  const watchable = items.filter((alert) => !isMarketClosed(deps, alert, options.now))
  const caveats: Caveat[] = []
  let triggered = 0

  const outcomes = await mapWithConcurrency<ActiveAlert, AlertOutcome>(
    watchable,
    ALERT_EVALUATION_CONCURRENCY,
    async (alert) => {
      const quoted = await coalescedObservation(deps, alert, tick)

      if (quoted === undefined) {
        return { alert }
      }

      return { alert, crossing: toCrossing(alert, quoted) }
    }
  )

  for (const outcome of outcomes) {
    if (outcome.crossing === undefined) {
      caveats.push({
        code: 'alert.price-unavailable',
        detail: { ticker: outcome.alert.instrument.ticker },
      })
      continue
    }

    if (
      outcome.crossing.crossed &&
      (await markTriggered(deps, outcome.alert, { price: outcome.crossing.price, options }))
    ) {
      triggered += 1
    }
  }

  return { triggered, caveats }
}

/** Only the hard-closed states skip: pre-open and post-close still evaluate against the settled
 *  close (unchanged behavior), while weekends and the lunch break stop burning live quotes. */
function isMarketClosed(deps: AlertServiceDeps, alert: ActiveAlert, now: number): boolean {
  const market = deps.markets.find(alert.instrument.market)

  return market !== null && market.manifest.calendar.sessionState(now) === 'closed'
}

/** One quote per instrument per tick, shared by every alert watching it - faster, and kinder to
 *  the provider rate limit. The map lives in the tick, never module scope. */
function coalescedObservation(
  deps: AlertServiceDeps,
  alert: ActiveAlert,
  tick: EvaluationTick
): Promise<PriceObservation | undefined> {
  const key = buildInstrumentKey(alert.instrument)
  const pending = tick.quotes.get(key)

  if (pending !== undefined) {
    return pending
  }

  const observation = observePrice(deps, alert, tick.options)

  tick.quotes.set(key, observation)

  return observation
}

function markTriggered(
  deps: AlertServiceDeps,
  alert: ActiveAlert,
  crossing: { readonly price: number; readonly options: OperationTickOptions<AlertId> }
): Promise<boolean> {
  const { options } = crossing

  return deps.store.markTriggered({
    alertId: alert.id,
    triggeredAt: options.now,
    observedPrice: crossing.price,
    // Due immediately: the backoff schedule starts only once a send has actually failed.
    nextDueAt: options.now,
    signal: options.signal,
  })
}
