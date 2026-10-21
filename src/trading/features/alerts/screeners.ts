import type { Locale } from '@/core/types/locale'
import type { AlertStore } from '@/trading/features/alerts/store/alert'
import type { Alert, AlertDraft, AlertOrigin, AlertService } from '@/trading/features/alerts/types'
import type { BriefService } from '@/trading/features/brief/types'
import type { MarketDataStore } from '@/trading/features/market-data/store/market-data'
import type { PortfolioAtOptions } from '@/trading/features/portfolio/options'
import type { Holding } from '@/trading/features/portfolio/types'
import type { AlertPolicy } from '@/trading/kernel/config'
import type { InstrumentRef } from '@/trading/kernel/instrument'
import type { AlertId } from '@/trading/kernel/operator/alert'
import type { DeliveryAddress } from '@/trading/kernel/operator/delivery'
import type { UserProfile } from '@/trading/kernel/operator/profile'
import type { OperationTickOptions } from '@/trading/kernel/store/page'
import type { MarketRegistry } from '@/trading/markets/types'
import { buildScreenOrigin, isScreenOrigin } from '@/trading/features/alerts/types'
import { dedupeInstruments } from '@/trading/kernel/instrument'
import { resolveSettledDay } from '@/trading/markets/calendar'

/** Below this many usable sessions the average daily range says more about missing history than
 *  about the name, and a band built on it would fire on noise. Exported so the config schema refuses
 *  a `breakout_sessions` that could never arm a band. */
export const MINIMUM_RANGE_SESSIONS = 5
const EXHAUSTED_REARM_COOLDOWN_MS = 15 * 60_000

export interface ScreenerReconcileDeps {
  readonly alerts: Pick<AlertService, 'create' | 'disable'>
  readonly store: AlertStore
  readonly briefs: Pick<BriefService, 'find' | 'resolveRecipient'>
  readonly markets: MarketRegistry
  readonly marketDataStore: MarketDataStore
  readonly policy: AlertPolicy
  readonly defaultLocale: Locale
  /** The operator's policy, injected rather than imported: a screener reads the watchlist and the
   *  exclusions, and nothing else about the profile feature. */
  getProfile(options: {
    readonly defaultLocale: Locale
    readonly signal: AbortSignal
  }): Promise<UserProfile>
  tradeableHoldingsAt(options: PortfolioAtOptions): Promise<readonly Holding[]>
}

/** Detection on the same stack the operator's own alerts ride: a watched or held name that moves
 *  further than it normally does in a session becomes a notice, and the operator decides whether to
 *  ask for a suggestion. The settled day is part of each origin, so yesterday's bands retire
 *  themselves on the first tick after the next settle. */
export async function reconcileScreenerAlerts(
  deps: ScreenerReconcileDeps,
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
  deps: ScreenerReconcileDeps,
  delivery: DeliveryAddress,
  options: OperationTickOptions
): Promise<ReadonlyMap<AlertOrigin, AlertDraft>> {
  const [profile, holdings] = await Promise.all([
    deps.getProfile({ defaultLocale: deps.defaultLocale, signal: options.signal }),
    deps.tradeableHoldingsAt({ now: options.now, signal: options.signal }),
  ])
  const instruments = dedupeInstruments([
    ...profile.watchlist,
    ...holdings.map((holding) => holding.instrument),
  ])
  const expected = new Map<AlertOrigin, AlertDraft>()

  for (const instrument of instruments) {
    for (const draft of await bandDrafts(deps, instrument, { delivery, options })) {
      expected.set(draft.origin, draft.draft)
    }
  }

  return expected
}

interface BandContext {
  readonly delivery: DeliveryAddress
  readonly options: OperationTickOptions
}

/** Thresholds sit one multiple of the average daily range either side of the settled close, so the
 *  alert fires on a move the name does not make on a normal day. Re-derived per settled session -
 *  the day is part of the origin, so yesterday's bands disable themselves on the first tick after
 *  the settle. */
async function bandDrafts(
  deps: ScreenerReconcileDeps,
  instrument: InstrumentRef,
  context: BandContext
): Promise<readonly OriginatedDraft[]> {
  const market = deps.markets.find(instrument.market)

  if (market === null) {
    return []
  }

  const calendar = market.manifest.calendar
  const settled = resolveSettledDay(calendar, context.options.now)
  const bars = await deps.marketDataStore.listBars({
    instrument,
    fromDay: calendar.addTradingDays(settled, -deps.policy.breakoutSessions),
    toDay: settled,
    signal: context.options.signal,
  })
  const newest = bars[bars.length - 1]

  if (newest === undefined || newest.candle.at < settled) {
    return []
  }

  const ranges = bars
    .map((bar) => bar.candle.high - bar.candle.low)
    .filter((range) => Number.isFinite(range) && range > 0)

  if (ranges.length < MINIMUM_RANGE_SESSIONS) {
    return []
  }

  const averageRange = ranges.reduce((sum, range) => sum + range, 0) / ranges.length
  const band = averageRange * deps.policy.breakoutRange
  const anchor = newest.candle.close

  return bandsAround({ instrument, anchor, band, settled }, context.delivery)
}

interface BandInput {
  readonly instrument: InstrumentRef
  readonly anchor: number
  readonly band: number
  readonly settled: string
}

function bandsAround(input: BandInput, delivery: DeliveryAddress): readonly OriginatedDraft[] {
  const bands = [
    { direction: 'up' as const, condition: 'above' as const, threshold: input.anchor + input.band },
    {
      direction: 'down' as const,
      condition: 'below' as const,
      threshold: input.anchor - input.band,
    },
  ]

  return bands.flatMap((entry) => {
    if (!Number.isFinite(entry.threshold) || entry.threshold <= 0) {
      return []
    }

    const origin = buildScreenOrigin(input.instrument, entry.direction, input.settled)

    return [
      {
        origin,
        draft: {
          instrument: input.instrument,
          condition: entry.condition,
          threshold: entry.threshold,
          delivery,
          origin,
        },
      },
    ]
  })
}

/** Only this pass's own rows: an exit alert is another owner's, and disabling it here would tear
 *  down a level the operator's suggestion still stands behind. */
async function disableStale(
  deps: ScreenerReconcileDeps,
  input: {
    readonly live: readonly Alert[]
    readonly expected: ReadonlyMap<AlertOrigin, AlertDraft>
    readonly options: OperationTickOptions
  }
): Promise<number> {
  let disabled = 0

  for (const alert of input.live) {
    if (!isScreenOrigin(alert.origin) || input.expected.has(alert.origin)) {
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

export interface ArmedAlertBatch {
  readonly armed: number
  readonly disabled: number
}

export interface OriginatedDraft {
  readonly origin: AlertOrigin
  readonly draft: AlertDraft
}

interface ReconcilePassDeps {
  readonly alerts: Pick<AlertService, 'create'>
  readonly store: AlertStore
  readonly briefs: Pick<BriefService, 'find' | 'resolveRecipient'>
  readonly markets: Pick<MarketRegistry, 'resolve'>
}

interface ReconcilePassInput {
  readonly options: OperationTickOptions
  expectedDrafts(delivery: DeliveryAddress): Promise<ReadonlyMap<AlertOrigin, AlertDraft>>
  disableStale(input: {
    readonly live: readonly Alert[]
    readonly expected: ReadonlyMap<AlertOrigin, AlertDraft>
  }): Promise<number>
}

/** The one arm/disable cycle every reconcile pass runs — the sole owner of the re-arm rule both the
 *  exit-alert and screener-alert passes share. An origin that already holds a row, in any state,
 *  never gets a second insert: a fired or disabled row sits outside the live index the unique
 *  constraint enforces, so without this gate a price still beyond a retired level would cross again
 *  and re-arm every tick, one notice per poll for the rest of the session. Only a genuinely new
 *  origin — a new suggestion, a new settled day — is eligible to arm, or one whose row was disabled
 *  because delivery gave up, once `EXHAUSTED_REARM_COOLDOWN_MS` has passed: that notice never
 *  reached the operator, and the cooldown bounds the rows a long channel outage can write.
 *
 *  Also walks every page of the live index rather than just the first: a batch-sized page limit
 *  must never hide a row from `disableStale`. */
export async function reconcileAlerts(
  deps: ReconcilePassDeps,
  input: ReconcilePassInput
): Promise<ArmedAlertBatch> {
  const { options } = input
  const delivery = await deps.briefs.find(options.signal)
  const target =
    delivery === null ? undefined : await deps.briefs.resolveRecipient(delivery.delivery)

  // Every draft carries the address the notice will go to, so with none, or one that refuses every
  // send (its channel did not start, or its pairing was revoked), there is nothing to arm.
  if (target === undefined) {
    return { armed: 0, disabled: 0 }
  }

  const expected = await input.expectedDrafts(target)
  const live = await listAllLive(deps.store, options)
  const liveOrigins = new Set(live.map((alert) => alert.origin))
  const candidates = [...expected.keys()].filter((origin) => !liveOrigins.has(origin))
  const known = await deps.store.listKnownOrigins({
    origins: candidates,
    rearmBefore: options.now - EXHAUSTED_REARM_COOLDOWN_MS,
    signal: options.signal,
  })
  let armed = 0

  for (const origin of candidates) {
    const draft = expected.get(origin)

    if (draft === undefined || known.has(origin)) {
      continue
    }

    // Arming refuses anything that does not resolve, and a refusal thrown here would abort the tick
    // on every restart: an unavailable market, an unsupported instrument or an ambiguous market
    // alike stay unarmed and are looked at again next tick.
    const resolution = await deps.markets.resolve({ ...draft.instrument, signal: options.signal })

    if (resolution.kind !== 'resolved') {
      continue
    }

    await deps.alerts.create({ draft, now: options.now, signal: options.signal })
    armed += 1
  }

  const disabled = await input.disableStale({ live, expected })

  return { armed, disabled }
}

async function listAllLive(
  store: AlertStore,
  options: OperationTickOptions
): Promise<readonly Alert[]> {
  const collected: Alert[] = []
  let cursor: AlertId | undefined

  for (;;) {
    const page = await store.listLiveWithOrigin({
      ...(cursor === undefined ? {} : { cursor }),
      limit: options.batchSize,
      signal: options.signal,
    })

    collected.push(...page.items)

    if (page.nextCursor === undefined) {
      return collected
    }

    cursor = page.nextCursor
  }
}
