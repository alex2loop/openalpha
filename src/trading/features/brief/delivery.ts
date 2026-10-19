import type { Locale } from '@/core/types/locale'
import type { LeaseToken } from '@/trading/features/alerts/types'
import type { BriefBuildDeps } from '@/trading/features/brief/build'
import type { BriefSchedulePlan, SchedulePlanDeps } from '@/trading/features/brief/schedule'
import type { BriefDeliveryStore } from '@/trading/features/brief/store/delivery'
import type {
  BriefDeliveryBatch,
  BriefSnapshot,
  DeliveringBriefDelivery,
} from '@/trading/features/brief/types'
import type { DeliveryErrorCode } from '@/trading/kernel/caveat'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { TradingNotice, TradingNoticeSender } from '@/trading/kernel/operator/notice'
import type { OperationTickOptions } from '@/trading/kernel/store/page'
import { missingEnvOf } from '@/core/config/resolve'
import { isAbortError, ValidationError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { buildLeaseToken } from '@/trading/features/alerts/types'
import { findOrBuildBrief } from '@/trading/features/brief/build'
import { nextScheduled, resolvePlan, scheduledOn } from '@/trading/features/brief/schedule'
import {
  nextAttemptAt,
  notifyDeliveryStopped,
  sendCaught,
} from '@/trading/kernel/operator/delivery-retry'

export interface BriefServiceDeps extends BriefBuildDeps, SchedulePlanDeps {
  readonly deliveries: BriefDeliveryStore
  readonly sender: TradingNoticeSender
  /** Unattended delivery has no chat to read a locale from, so the brief uses the configured
   *  `[locale] language`. */
  readonly defaultLocale: Locale
}

interface DeliveryTally {
  delivered: number
  deferred: number
  suppressed: number
}

/** Claim, build, then send. Only a completed send marks delivered; a throw mid-batch hands
 *  unfinished claims back (lease cleared, attempt uncounted) before propagating. */
export async function deliverDue(
  deps: BriefServiceDeps,
  options: OperationTickOptions
): Promise<BriefDeliveryBatch> {
  const leaseToken = buildLeaseToken()
  const claimed = await deps.deliveries.claimDue({
    now: options.now,
    leaseToken,
    leaseUntil: options.now + deps.config.operations.deliveryLeaseMs,
    limit: options.batchSize,
    signal: options.signal,
  })
  const tally: DeliveryTally = { delivered: 0, deferred: 0, suppressed: 0 }
  let index = 0

  try {
    for (; index < claimed.length; index += 1) {
      const subscription = claimed[index]

      if (subscription === undefined) {
        break
      }

      const plan = await planOrDefer(deps, { subscription, leaseToken, options, tally })

      if (plan === undefined) {
        continue
      }

      await deliverScheduled(deps, { subscription, plan, leaseToken, options, tally })
    }
  } catch (err: unknown) {
    await releaseRemaining(deps, { claimed: claimed.slice(index), leaseToken, now: options.now })

    throw err
  }

  return { ...tally }
}

/** A region whose owner is gone cannot be scheduled, so the next day cannot be computed: the
 *  same day is retried on the backoff ladder (one warning an hour). Only this subscription
 *  waits. */
async function planOrDefer(
  deps: BriefServiceDeps,
  claim: Omit<DeliveryContext, 'plan'>
): Promise<BriefSchedulePlan | undefined> {
  const { subscription, options } = claim

  try {
    return resolvePlan(deps, subscription.region, subscription.sendTime)
  } catch (err: unknown) {
    if (!(err instanceof ValidationError)) {
      throw err
    }

    deps.logger.warn('trading.brief_plan_unresolved', {
      region: subscription.region,
      err: formatErrForLog(err),
    })

    const deferred = await deps.deliveries.deferDelivery({
      leaseToken: claim.leaseToken,
      deliveryDay: subscription.deliveryDay,
      nextDeliveryDay: subscription.deliveryDay,
      nextDueAt: nextAttemptAt(
        options.now,
        subscription.attempts,
        deps.config.operations.deliveryRetry
      ),
      errorCode: 'render-failed',
      signal: options.signal,
    })

    claim.tally.deferred += deferred ? 1 : 0

    return undefined
  }
}

async function deliverScheduled(deps: BriefServiceDeps, context: DeliveryContext): Promise<void> {
  try {
    await deliverOne(deps, context)
  } catch (err: unknown) {
    if (context.options.signal.aborted || isAbortError(err)) {
      throw err
    }

    deps.logger.warn('trading.brief_delivery_render_failed', {
      deliveryDay: context.subscription.deliveryDay,
      err: formatErrForLog(err),
    })

    const missing = missingEnvOf(err)

    if (missing !== undefined) {
      // A key arrives with a restart, so retrying today cannot succeed: one notice for the day.
      await abandonDay(deps, context, { errorCode: 'render-failed', missingEnv: missing.env })
      return
    }

    await deferClaimed(deps, context, 'render-failed')
  }
}

/** Cleanup, not delivery: a failed release is logged and its lease left to expire, so a storage
 *  error never masks the original one. */
async function releaseRemaining(
  deps: BriefServiceDeps,
  input: {
    readonly claimed: readonly DeliveringBriefDelivery[]
    readonly leaseToken: LeaseToken
    readonly now: number
  }
): Promise<void> {
  for (const subscription of input.claimed) {
    try {
      await deps.deliveries.release({
        leaseToken: input.leaseToken,
        deliveryDay: subscription.deliveryDay,
        now: input.now,
      })
    } catch (err: unknown) {
      deps.logger.warn('trading.brief_release_failed', { err: formatErrForLog(err) })
    }
  }
}

interface DeliveryContext {
  readonly subscription: DeliveringBriefDelivery
  readonly plan: BriefSchedulePlan
  readonly leaseToken: LeaseToken
  readonly options: OperationTickOptions
  readonly tally: DeliveryTally
}

/** After downtime the schedule holds one overdue day per missed day. A brief is a pre-open read
 *  of its own morning, so a day already past is skipped: the schedule jumps to today. */
async function skipStaleDay(
  deps: BriefServiceDeps,
  context: DeliveryContext,
  today: TradingDay
): Promise<void> {
  const next = scheduledOn(context.plan, today)

  if (await moveSchedule(deps, context, next)) {
    deps.logger.warn('trading.brief_stale_day_skipped', {
      deliveryDay: context.subscription.deliveryDay,
      nextDeliveryDay: next.day,
    })
  }
}

/** A daemon that was down through the send time wakes mid-session or after the close: the brief is
 *  a pre-open read and never goes out then, so today's is dropped and the next morning's is due. */
async function skipPastOpenDay(deps: BriefServiceDeps, context: DeliveryContext): Promise<void> {
  const { subscription, plan } = context
  const next = nextScheduled(plan, subscription.deliveryDay)

  if (await moveSchedule(deps, context, next)) {
    deps.logger.warn('trading.brief_past_open_skipped', {
      deliveryDay: subscription.deliveryDay,
      nextDeliveryDay: next.day,
    })
    // The only skip that tells: `skipStaleDay` moves straight to today, whose brief can still go
    // out before the open, and runs into this one if it cannot. `markDelivered` is lease- and
    // day-guarded, so one move sends at most one notice; a crash between the move and the send
    // loses it.
    await notifyDeliveryStopped({
      kind: 'delivery-missed',
      sender: deps.sender,
      target: subscription.delivery,
      locale: deps.defaultLocale,
      subject: 'brief',
      logger: deps.logger,
      signal: context.options.signal,
    })
  }
}

function moveSchedule(
  deps: BriefServiceDeps,
  context: DeliveryContext,
  next: ReturnType<typeof nextScheduled>
): Promise<boolean> {
  return deps.deliveries.markDelivered({
    leaseToken: context.leaseToken,
    deliveryDay: context.subscription.deliveryDay,
    nextDeliveryDay: next.day,
    nextDueAt: next.dueAt,
    signal: context.options.signal,
  })
}

/** Whether a brief may still go out as a pre-open read. A continuous market is never past its open,
 *  and a day the market does not trade has no session to be past: the brief reports the last one.
 *  On a trading day only the stretch before the open qualifies. Asked before the build starts; a
 *  build that runs the debate can outlast the open, and the send then says so (`sentAfterOpen`). */
function isPreOpen(plan: BriefSchedulePlan, now: number): boolean {
  const { calendar } = plan.market.manifest

  return (
    calendar.continuous ||
    !calendar.isTradingDay(calendar.dayAt(now)) ||
    calendar.sessionState(now) === 'pre-open'
  )
}

async function deliverOne(deps: BriefServiceDeps, context: DeliveryContext): Promise<void> {
  const { subscription, plan, options, tally } = context

  const today = plan.market.manifest.calendar.dayAt(options.now)

  if (subscription.deliveryDay < today) {
    await skipStaleDay(deps, context, today)
    return
  }

  if (!isPreOpen(plan, options.now)) {
    await skipPastOpenDay(deps, context)
    return
  }

  const result = await findOrBuildBrief(deps, {
    market: plan.market,
    region: subscription.region,
    asOf: subscription.deliveryDay,
    locale: deps.defaultLocale,
    now: options.now,
    signal: options.signal,
  })

  if (result.kind === 'suppressed') {
    await deferClaimed(deps, context)
    tally.suppressed += 1
    return
  }

  // The build and the send are separate operations: a start just before the open can send just
  // after it. A brief begun before the open is worth more than a missed-brief line, so it goes, with
  // a line saying prices have moved.
  await sendClaimed(deps, context, {
    snapshot: result.snapshot,
    afterOpen: !isPreOpen(plan, Date.now()),
  })
}

async function sendClaimed(
  deps: BriefServiceDeps,
  context: DeliveryContext,
  built: { readonly snapshot: BriefSnapshot; readonly afterOpen: boolean }
): Promise<void> {
  const { subscription, options, tally } = context
  const outcome = await sendCaught(
    deps.sender,
    noticeFor(deps, subscription, built),
    options.signal
  )

  if (outcome === 'accepted') {
    const marked = await deps.deliveries.markDelivered(completion(context))

    tally.delivered += marked ? 1 : 0
    return
  }

  // The same day, retried: the claim already counted this attempt, so the backoff reads it and the
  // deferral is the one completion that leaves the count alone.
  await deferClaimed(deps, context, outcome)
}

async function deferClaimed(
  deps: BriefServiceDeps,
  context: DeliveryContext,
  errorCode?: DeliveryErrorCode
): Promise<void> {
  const { subscription, options, tally } = context

  // A day that never becomes deliverable must not retry forever, but only that day is lost: a
  // channel or model blip at send time must not switch the morning brief off until `/brief enable`.
  if (subscription.attempts >= deps.config.operations.deliveryRetry.maximumAttempts) {
    await abandonDay(deps, context, errorCode === undefined ? {} : { errorCode })
    return
  }

  const deferred = await deps.deliveries.deferDelivery({
    ...completion(context),
    nextDeliveryDay: subscription.deliveryDay,
    nextDueAt: nextAttemptAt(
      options.now,
      subscription.attempts,
      deps.config.operations.deliveryRetry
    ),
    ...(errorCode === undefined ? {} : { errorCode }),
  })

  tally.deferred += deferred ? 1 : 0
}

/** Gives the claimed day up and schedules the next one without recording it as delivered. The
 *  notice follows the write: a worker that lost its lease no longer owns the row and says
 *  nothing. */
async function abandonDay(
  deps: BriefServiceDeps,
  context: DeliveryContext,
  cause: { readonly errorCode?: DeliveryErrorCode; readonly missingEnv?: string }
): Promise<void> {
  const { subscription, options } = context
  const { errorCode, missingEnv } = cause
  const abandoned = await deps.deliveries.abandonDelivery({
    ...completion(context),
    ...(errorCode === undefined ? {} : { errorCode }),
  })

  if (!abandoned) {
    return
  }

  deps.logger.warn('trading.brief_day_abandoned', {
    deliveryDay: subscription.deliveryDay,
    attempts: subscription.attempts,
  })
  await notifyDeliveryStopped({
    kind: 'delivery-skipped',
    sender: deps.sender,
    target: subscription.delivery,
    locale: deps.defaultLocale,
    subject: 'brief',
    ...(missingEnv === undefined ? {} : { missingEnv }),
    logger: deps.logger,
    signal: options.signal,
  })
}

/** The one guarded-transition payload. Every post-claim write carries the lease and claimed day,
 *  so a worker whose lease expired writes nothing rather than overwriting a newer claim. */
function completion(context: DeliveryContext): Parameters<BriefDeliveryStore['markDelivered']>[0] {
  const { subscription } = context
  const scheduled = nextScheduled(context.plan, subscription.deliveryDay)

  return {
    leaseToken: context.leaseToken,
    deliveryDay: subscription.deliveryDay,
    nextDeliveryDay: scheduled.day,
    nextDueAt: scheduled.dueAt,
    signal: context.options.signal,
  }
}

/** Section bodies in the snapshot are model-authored prose and travel as-is in their authored
 *  locale; only the notice around them is rendered from a locale key. */
function noticeFor(
  deps: BriefServiceDeps,
  subscription: DeliveringBriefDelivery,
  built: { readonly snapshot: BriefSnapshot; readonly afterOpen: boolean }
): TradingNotice {
  return {
    target: subscription.delivery,
    locale: deps.defaultLocale,
    payload: {
      kind: 'brief',
      snapshot: built.snapshot,
      ...(built.afterOpen ? { sentAfterOpen: true as const } : {}),
    },
  }
}
