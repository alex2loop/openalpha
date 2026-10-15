import type { StopCover } from '@/trading/kernel/operator/alert'
import type { AgentMethods } from '@/trading/wiring/host/agents'
import type { LedgerMethods } from '@/trading/wiring/host/ledger'
import type { MarketMethods } from '@/trading/wiring/host/market'
import type { OrderMethods } from '@/trading/wiring/host/order'
import type { HeldStopView, TradingHost, TradingHostDeps } from '@/trading/wiring/host/types'
import { ValidationError } from '@/core/errors'
import { reconcileSentences } from '@/trading/features/portfolio/render/reconcile'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { bounded, profileOf, resolveRegion, scoped, scopedSlow } from '@/trading/wiring/host/scope'

const UNDELIVERABLE_KEY = 'slash.tradingAlertUndeliverable'
const NO_COVERS: ReadonlyMap<string, StopCover> = new Map()

type AccountMethods = Omit<
  TradingHost,
  keyof MarketMethods | keyof LedgerMethods | keyof OrderMethods | keyof AgentMethods
>
type AlertMethods = Pick<AccountMethods, 'listAlerts' | 'createAlert' | 'disableAlert'>
type BriefMethods = Pick<AccountMethods, 'getBrief' | 'rescheduleBrief' | 'getBriefDelivery'>

type BookMethods = Pick<
  AccountMethods,
  'getPortfolio' | 'getNavHistory' | 'getStopDistances' | 'getRebalance' | 'getReconcile'
>

async function heldStops(
  deps: TradingHostDeps,
  scope: { readonly now: number; readonly signal: AbortSignal }
): Promise<readonly HeldStopView[]> {
  const options = { now: scope.now, signal: scope.signal }
  const [distances, covers] = await Promise.all([
    deps.services.alerts.stopDistances(options),
    deps.services.order?.restingStops(options) ?? NO_COVERS,
  ])

  return distances.map((distance) => {
    const cover = covers.get(buildInstrumentKey(distance.instrument))

    return cover === undefined ? distance : { ...distance, cover }
  })
}

function bookMethods(deps: TradingHostDeps): BookMethods {
  return {
    // The only method that reaches the absolute view. Everything an agent can reach goes through
    // the relative surface, which this host does not expose at all.
    getPortfolio: (request) =>
      scoped(deps, request.signal, (scope) =>
        deps.services.portfolio.viewAbsoluteSized({ now: scope.now, signal: scope.signal })
      ),

    getNavHistory: (request) =>
      scoped(deps, request.signal, (scope) =>
        deps.services.nav.history({ window: request.window, now: scope.now, signal: scope.signal })
      ),

    // The level each holding's latest plan names, and whether an order rests behind it.
    getStopDistances: (request) => scoped(deps, request.signal, (scope) => heldStops(deps, scope)),

    getRebalance: (request) =>
      scopedSlow(deps, request.signal, (scope) =>
        deps.services.rebalanceViews.plan({
          ...(request.tickers === undefined ? {} : { tickers: request.tickers }),
          locale: deps.defaultLocale,
          now: scope.now,
          signal: scope.signal,
        })
      ),

    // Asks each venue with a balance feed; the rest answer `unsupported`.
    getReconcile: (request) =>
      scoped(deps, request.signal, async (scope) => {
        const venues = await deps.services.portfolio.reconcile({
          now: scope.now,
          signal: scope.signal,
        })

        return { venues, text: reconcileSentences(deps.defaultLocale, venues) }
      }),
  }
}

function recordMethods(
  deps: TradingHostDeps
): Omit<AccountMethods, keyof BookMethods | keyof AlertMethods | keyof BriefMethods> {
  return {
    // Non-null, unlike the hook's `ProfileReader.find`: this only ever serves the single operator
    // this host is closed over, and that profile is auto-provisioned at first boot.
    getProfile: (signal) => scoped(deps, signal, (scope) => profileOf(deps, scope)),

    updateProfile: (request) =>
      scoped(deps, request.signal, (scope) =>
        deps.services.profiles.update({
          patch: request.patch,
          defaultLocale: deps.defaultLocale,
          signal: scope.signal,
        })
      ),

    listSuggestions: (request) =>
      scoped(deps, request.signal, (scope) =>
        deps.services.suggestions.list({
          status: request.status,
          ...(request.focusKey === undefined ? {} : { focusKey: request.focusKey }),
          ...(request.instrument === undefined ? {} : { instrument: request.instrument }),
          limit: bounded(request.limit, deps.limits.maximumTrackRecordItems),
          ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
          signal: scope.signal,
        })
      ),

    getTrackRecord: (request) =>
      scoped(deps, request.signal, (scope) =>
        deps.services.appViews.trackRecord({
          limit: bounded(request.limit, deps.limits.maximumTrackRecordItems),
          locale: deps.defaultLocale,
          signal: scope.signal,
        })
      ),

    listVenues: (request) =>
      scoped(deps, request.signal, async () => deps.services.portfolio.venueChoices()),
  }
}

function briefMethods(deps: TradingHostDeps): BriefMethods {
  return {
    getBrief: (request) =>
      scoped(deps, request.signal, async (scope) => {
        const region = resolveRegion(deps, request.region)
        const brief = await deps.services.appViews.brief({
          region,
          locale: deps.defaultLocale,
          now: scope.now,
          signal: scope.signal,
        })

        return { region, ...brief }
      }),

    rescheduleBrief: (request) =>
      scoped(deps, request.signal, (scope) =>
        deps.services.appViews.rescheduleBrief({
          sendTime: request.sendTime,
          locale: deps.defaultLocale,
          now: scope.now,
          signal: scope.signal,
        })
      ),

    getBriefDelivery: (request) =>
      scoped(deps, request.signal, (scope) => deps.services.briefs.find(scope.signal)),
  }
}

function alertMethods(deps: TradingHostDeps): AlertMethods {
  const { alerts } = deps.services

  return {
    listAlerts: (request) =>
      scoped(deps, request.signal, (scope) =>
        alerts.listWithActiveCount({
          limit: bounded(request.limit, deps.limits.maximumAlertItems),
          ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
          signal: scope.signal,
        })
      ),

    // An alert nothing can push to would arm and never be heard, so it is refused up front.
    createAlert: (request) =>
      scoped(deps, request.signal, (scope) => {
        if (!alerts.canDeliver(request.delivery)) {
          throw new ValidationError('alert target cannot receive notices', {
            key: UNDELIVERABLE_KEY,
          })
        }

        return alerts.create({
          draft: {
            instrument: request.instrument,
            condition: request.condition,
            threshold: request.threshold,
            delivery: request.delivery,
          },
          now: scope.now,
          signal: scope.signal,
        })
      }),

    disableAlert: (request) =>
      scoped(deps, request.signal, (scope) =>
        alerts.disable({ alertId: request.alertId, now: scope.now, signal: scope.signal })
      ),
  }
}

export function accountMethods(deps: TradingHostDeps): AccountMethods {
  return {
    ...bookMethods(deps),
    ...recordMethods(deps),
    ...briefMethods(deps),
    ...alertMethods(deps),
  }
}
