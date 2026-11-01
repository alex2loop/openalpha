import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { LruMap } from '@/core/utils/collections'
import type { ArmedAlertBatch, OriginatedDraft } from '@/trading/features/alerts/screeners'
import type { AlertStore } from '@/trading/features/alerts/store/alert'
import type {
  Alert,
  AlertDraft,
  AlertOrigin,
  AlertService,
  EXIT_LEVELS,
  PositionExit,
  PositionExitOptions,
  StalePositionOptions,
  StopDistanceOptions,
} from '@/trading/features/alerts/types'
import type { BriefService } from '@/trading/features/brief/types'
import type { PortfolioAtOptions } from '@/trading/features/portfolio/options'
import type { Holding } from '@/trading/features/portfolio/types'
import type { ExitPlanner } from '@/trading/features/suggestion/exit-plan/types'
import type { SuggestionStore } from '@/trading/features/suggestion/store/suggestion'
import type { StoredSuggestion } from '@/trading/features/suggestion/types'
import type { SuggestionAction } from '@/trading/kernel/conviction'
import type { InstrumentKind, InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { StopCover } from '@/trading/kernel/operator/alert'
import type { DeliveryAddress } from '@/trading/kernel/operator/delivery'
import type { TradingNoticeSender } from '@/trading/kernel/operator/notice'
import type { OperationTickOptions } from '@/trading/kernel/store/page'
import type { MarketRegistry } from '@/trading/markets/types'
import { planAndTrail } from '@/trading/features/alerts/exit-plans'
import { reconcileAlerts } from '@/trading/features/alerts/screeners'
import { DUE_STATES } from '@/trading/features/alerts/store/alert'
import { buildExitOrigin, isScreenOrigin } from '@/trading/features/alerts/types'
import { isFirstExitTaken } from '@/trading/features/suggestion/exit-plan/first-exit'
import {
  isPastOutcomeWindow,
  isPositionStale,
} from '@/trading/features/suggestion/exit-plan/staleness'
import { toHeldPosition } from '@/trading/features/suggestion/pipeline/concentration'
import { armsExit, planStopOf, planTakeProfitOf } from '@/trading/features/suggestion/types'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { horizonFor } from '@/trading/kernel/operator/profile'
import { exitPriceOf } from '@/trading/markets/stored-quote'

interface ArmedLevel {
  readonly level: (typeof EXIT_LEVELS)[number]
  readonly threshold: number
  readonly condition: PositionExit['condition']
}

export interface ExitReconcileDeps {
  readonly alerts: Pick<AlertService, 'create' | 'disable'>
  readonly store: AlertStore
  readonly suggestions: SuggestionStore
  readonly markets: MarketRegistry
  readonly exitPlans: ExitPlanner
  readonly sender: TradingNoticeSender
  readonly logger: Logger
  readonly defaultLocale: Locale
  readonly briefs: Pick<BriefService, 'find' | 'resolveRecipient'>
  /** Plan id to the settled session its trail was last computed for. See `ExitPlanDeps`. */
  readonly trailedThrough: LruMap<string, TradingDay>
  /** See `ExitPlanDeps`. */
  readonly trailRetryAt: LruMap<string, number>
  /** See `ExitPlanDeps`. */
  readonly replannedOn: LruMap<string, TradingDay>
  tradeableHoldingsAt(options: PortfolioAtOptions): Promise<readonly Holding[]>
  /** Whether a stop rests at the exchange behind each held name. See `ExitPlanDeps`. */
  restingStops?(options: PortfolioAtOptions): Promise<ReadonlyMap<string, StopCover>>
}

/** Exits are system-armed alerts, not a parallel pipeline: crossing detection, retry, lease and
 *  terminal-disable stay owned by the alert stack. This pass only reconciles rows - one per level
 *  per actionable suggestion behind a held position - against the book as it stands now, so a
 *  ledger edit that re-bases positions enables or disables rows on the next tick. */
export async function reconcileExitAlerts(
  deps: ExitReconcileDeps,
  options: OperationTickOptions
): Promise<ArmedAlertBatch> {
  return reconcileAlerts(
    { alerts: deps.alerts, store: deps.store, briefs: deps.briefs, markets: deps.markets },
    {
      options,
      expectedDrafts: (delivery) => expectedDrafts(deps, delivery, options),
      disableStale: (input) => disableStale(deps, { ...input, options }),
    }
  )
}

async function expectedDrafts(
  deps: ExitReconcileDeps,
  delivery: DeliveryAddress,
  options: OperationTickOptions
): Promise<ReadonlyMap<AlertOrigin, AlertDraft>> {
  const holdings = await deps.tradeableHoldingsAt({ now: options.now, signal: options.signal })
  const expected = new Map<AlertOrigin, AlertDraft>()

  for (const holding of holdings) {
    const plan = await planAndTrail(deps, {
      instrument: holding.instrument,
      standing: await findHoldingPlan(deps.suggestions, holding, options.signal),
      delivery,
      options,
    })

    if (plan === null) {
      continue
    }

    const taken = isTakeProfitTaken(deps, holding, plan)

    for (const draft of levelDrafts(holding, plan, { delivery, taken })) {
      expected.set(draft.origin, draft.draft)
    }
  }

  return expected
}

/** Whether sales since the holding opened already banked the share the plan takes at its
 *  take-profit, the same test `/suggest` states the first exit by. */
function isTakeProfitTaken(
  deps: Pick<ExitWatchDeps, 'markets'>,
  holding: Holding,
  plan: StoredSuggestion
): boolean {
  const held = toHeldPosition([holding], holding.instrument)
  const trails = deps.markets.find(holding.instrument.market)?.trail !== undefined

  return held !== undefined && isFirstExitTaken(held, plan, trails)
}

function levelDrafts(
  holding: Holding,
  suggestion: StoredSuggestion,
  at: { readonly delivery: DeliveryAddress; readonly taken: boolean }
): readonly OriginatedDraft[] {
  const { instrument } = holding
  const { delivery } = at

  return armedLevels(suggestion, at.taken).map((entry) => {
    const origin = buildExitOrigin(suggestion.id, entry.level, entry.threshold)

    return {
      origin,
      draft: {
        instrument,
        condition: entry.condition,
        threshold: entry.threshold,
        delivery,
        origin,
      },
    }
  })
}

/** A live system row whose origin the book no longer expects - position closed, or a newer
 *  suggestion replaced the levels - is disabled, never deleted, and without a disable notice:
 *  the operator did not lose a channel, the reason for the row went away. */
async function disableStale(
  deps: ExitReconcileDeps,
  input: {
    readonly live: readonly Alert[]
    readonly expected: ReadonlyMap<AlertOrigin, AlertDraft>
    readonly options: OperationTickOptions
  }
): Promise<number> {
  let disabled = 0

  for (const alert of input.live) {
    if (alert.origin === undefined || input.expected.has(alert.origin)) {
      continue
    }

    // The screener owns its own bands; each arming pass disables only the rows it armed.
    if (isScreenOrigin(alert.origin)) {
      continue
    }

    // A crossed row still owes its delivery: the retry claims it, and a disable would lose it.
    if (DUE_STATES.some((state) => state === alert.state)) {
      continue
    }

    const result = await deps.alerts.disable({
      alertId: alert.id,
      now: input.options.now,
      signal: input.options.signal,
    })

    disabled += result === 'disabled' ? 1 : 0
  }

  return disabled
}

export interface ExitWatchDeps {
  readonly markets: MarketRegistry
  readonly store: SuggestionStore
  tradeableHoldingsAt(options: PortfolioAtOptions): Promise<readonly Holding[]>
  /** The kind the stored record files each held name under, keyed by `buildInstrumentKey`. */
  instrumentKinds(options: PortfolioAtOptions): Promise<ReadonlyMap<string, InstrumentKind>>
}

/** The exit prompt a suggest-only system owes: each held name checked against the levels of its
 *  stored exit plan — the buy that motivated it, else the latest hold that priced levels — at the
 *  price the holder would be paid to sell. A name with no stored plan, no market, or no quote
 *  produces no row — absence of evidence is not an exit signal. */
export async function watchPositionExits(
  deps: ExitWatchDeps,
  options: PositionExitOptions
): Promise<readonly PositionExit[]> {
  const holdings = await deps.tradeableHoldingsAt(options)
  const exits: PositionExit[] = []

  for (const holding of holdings) {
    const exit = await exitFor(deps, holding, options)

    if (exit !== null) {
      exits.push(exit)
    }
  }

  return exits
}

async function exitFor(
  deps: ExitWatchDeps,
  holding: Holding,
  options: PositionExitOptions
): Promise<PositionExit | null> {
  const market = deps.markets.find(holding.instrument.market)

  if (market === null) {
    return null
  }

  const suggestion = await findHoldingPlan(deps.store, holding, options.signal)

  if (suggestion === null) {
    return null
  }

  const quote = await market.capabilities.quote?.run({
    instrument: holding.instrument,
    asOf: market.manifest.calendar.dayAt(options.now),
    now: options.now,
    signal: options.signal,
  })

  if (quote === undefined || quote.kind === 'unavailable') {
    return null
  }

  const taken = isTakeProfitTaken(deps, holding, suggestion)
  const crossed = crossedLevel(armedLevels(suggestion, taken), exitPriceOf(quote.value))

  return crossed === null ? null : { instrument: holding.instrument, ...crossed }
}

/** The first armed level the price has reached. */
function crossedLevel(
  levels: readonly ArmedLevel[],
  observedPrice: number
): Omit<PositionExit, 'instrument'> | null {
  const crossed = levels.find((entry) => reached(observedPrice, entry.threshold, entry.condition))

  return crossed === undefined
    ? null
    : { condition: crossed.condition, threshold: crossed.threshold, observedPrice }
}

/** The stop, then the take-profit: the two levels a held name is closed or trimmed at, one owner
 *  for the arming pass and the watch. A plan that arms no exit keeps its take-profit - reaching it
 *  is still a trim worth naming - and arms no stop. A take-profit already banked arms nothing: the
 *  rest rides the stop. */
function armedLevels(suggestion: StoredSuggestion, taken: boolean): readonly ArmedLevel[] {
  const sides = exitSides(suggestion.action)
  const risk = armsExit(suggestion)
    ? [{ level: 'stop' as const, threshold: planStopOf(suggestion), condition: sides.stop }]
    : []
  const reward = taken
    ? []
    : [
        {
          level: 'target' as const,
          threshold: planTakeProfitOf(suggestion),
          condition: sides.target,
        },
      ]

  return [...risk, ...reward].flatMap((entry) =>
    entry.threshold !== undefined && Number.isFinite(entry.threshold) && entry.threshold > 0
      ? [{ ...entry, threshold: entry.threshold }]
      : []
  )
}

/** Held names whose latest stored plan carries no watchable levels — no plan, or a hold the market
 *  never priced. Disclosed so the watch's silence never reads as safety. */
export async function unwatchedPositions(
  deps: ExitWatchDeps,
  options: PositionExitOptions
): Promise<readonly InstrumentRef[]> {
  const holdings = await deps.tradeableHoldingsAt(options)
  const unwatched: InstrumentRef[] = []

  for (const holding of holdings) {
    const plan = await findHoldingPlan(deps.store, holding, options.signal)

    if (plan === null || (planStopOf(plan) === undefined && planTakeProfitOf(plan) === undefined)) {
      unwatched.push(holding.instrument)
    }
  }

  return unwatched
}

/** Held names past the window the outcome scorer measures a call over that have not moved: the same
 *  barrier the reduce path applies, read on demand so a surface can prompt for the run that would
 *  apply it. Marks are the caller's where it has valued the book, exactly as `stopDistances` takes
 *  them. Dated by today rather than by a settled session: the question is whether the wait has
 *  elapsed, which a calendar day answers and a settled close does not. */
export async function stalePositions(
  deps: ExitWatchDeps,
  options: StalePositionOptions
): Promise<readonly InstrumentRef[]> {
  const holdings = await deps.tradeableHoldingsAt(options)
  const stale: InstrumentRef[] = []

  for (const holding of holdings) {
    const market = deps.markets.find(holding.instrument.market)
    const held = toHeldPosition([holding], holding.instrument)

    if (market === null || held === undefined) {
      continue
    }

    // The window is answered from the book alone, so a position too young to be stale never costs
    // the quote that would only confirm it.
    const window = {
      market,
      held,
      asOf: market.manifest.calendar.dayAt(options.now),
      horizon: horizonFor(options.profile, market.manifest.segment),
    }

    if (!isPastOutcomeWindow(window)) {
      continue
    }

    const price = await resolveMark(deps, holding, options)

    if (price !== undefined && isPositionStale({ ...window, price })) {
      stale.push(holding.instrument)
    }
  }

  return stale
}

/** The caller's own mark where it valued the book, the market's otherwise. */
export function resolveMark(
  deps: ExitWatchDeps,
  holding: Holding,
  options: StopDistanceOptions
): Promise<number | undefined> {
  const known = options.marks?.get(buildInstrumentKey(holding.instrument))

  return known === undefined ? markFor(deps, holding, options) : Promise.resolve(known)
}

/** What the holder would be paid for a held name, read the way `exitFor` reads it. Absent when the
 *  market is unknown or unquoted. */
async function markFor(
  deps: ExitWatchDeps,
  holding: Holding,
  options: PositionExitOptions
): Promise<number | undefined> {
  const market = deps.markets.find(holding.instrument.market)

  if (market === null || market.capabilities.quote === undefined) {
    return undefined
  }

  const quote = await market.capabilities.quote.run({
    instrument: holding.instrument,
    asOf: market.manifest.calendar.dayAt(options.now),
    now: options.now,
    signal: options.signal,
  })

  return quote === undefined || quote.kind === 'unavailable' ? undefined : exitPriceOf(quote.value)
}

/** The plan this holding is watched on: one written since it opened, never a closed holding's. */
export function findHoldingPlan(
  store: SuggestionStore,
  holding: Holding,
  signal: AbortSignal
): Promise<StoredSuggestion | null> {
  const heldSince = toHeldPosition([holding], holding.instrument)?.openedOn

  return store.findLatestExitPlan({
    market: holding.instrument.market,
    ticker: holding.instrument.ticker,
    ...(heldSince === undefined ? {} : { heldSince }),
    signal,
  })
}

interface ExitSides {
  readonly stop: PositionExit['condition']
  readonly target: PositionExit['condition']
}

/** A `reduce` inverts both levels — its stop sits above the entry — so which side a level is
 *  crossed from follows the action, the same way `resolveOutcome` reads a bar. A hold on a held
 *  name reads buy-side: its stop is where holding stops being the plan. Only the side is shared:
 *  a watch fires when the price reaches a level, while `resolveOutcome` scores a target only once
 *  the market trades through it. A prompt to look is not a claim of a fill. */
function exitSides(action: SuggestionAction): ExitSides {
  const stop: PositionExit['condition'] = action === 'reduce' ? 'above' : 'below'

  return { stop, target: stop === 'below' ? 'above' : 'below' }
}

function reached(price: number, threshold: number, condition: PositionExit['condition']): boolean {
  return condition === 'below' ? price <= threshold : price >= threshold
}
