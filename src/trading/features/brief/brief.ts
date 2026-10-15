import type { BriefServiceDeps } from '@/trading/features/brief/delivery'
import type {
  BriefResult,
  BriefService,
  BriefSnapshot,
  BuildBriefOptions,
  EnableBriefOptions,
  EnableBriefResult,
  GetLatestBriefOptions,
  RescheduleBriefOptions,
  RescheduleBriefResult,
  ScheduledBriefDelivery,
} from '@/trading/features/brief/types'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { findCurrentSnapshot, findOrBuildBrief } from '@/trading/features/brief/build'
import { deliverDue } from '@/trading/features/brief/delivery'
import {
  initialScheduled,
  isValidSendTime,
  nextScheduled,
  resolvePlan,
  scheduleGuardOf,
} from '@/trading/features/brief/schedule'
import { resolveDay } from '@/trading/features/market-data/resolve'

type EnableBriefRejection = Extract<EnableBriefResult, { kind: 'rejected' }>['reason']

export function createBriefService(deps: BriefServiceDeps): BriefService {
  return {
    build: (options) => build(deps, options),
    getLatest: (options) => getLatest(deps, options),
    find: (signal) => deps.deliveries.find(signal),
    canDeliver: (delivery) => deps.sender.canDeliver(delivery),
    enable: (options) => enable(deps, options),
    reschedule: (options) => reschedule(deps, options),
    disable: (options) =>
      deps.deliveries.disable({ disabledAt: options.now, signal: options.signal }),
    deliverDue: (options) => deliverDue(deps, options),
  }
}

function build(deps: BriefServiceDeps, options: BuildBriefOptions): Promise<BriefResult> {
  const plan = resolvePlan(deps, options.region)

  return findOrBuildBrief(deps, {
    market: plan.market,
    region: options.region,
    asOf: resolveDay(plan.market, options.now),
    locale: options.locale,
    now: options.now,
    signal: options.signal,
    ...(options.progress === undefined ? {} : { progress: options.progress }),
    ...(options.forced === undefined ? {} : { forced: options.forced }),
    ...(options.billingSessionId === undefined
      ? {}
      : { billingSessionId: options.billingSessionId }),
  })
}

/** The named day's brief when one exists, otherwise the most recent one — so a user who asks before
 *  the morning run still reads yesterday's rather than nothing. A snapshot this build can no longer
 *  read is absent rather than an error: the vocabulary it was written in is the store's problem, and
 *  taking a surface down over a derived artifact is worse than showing the empty state. */
async function getLatest(
  deps: BriefServiceDeps,
  options: GetLatestBriefOptions
): Promise<BriefSnapshot | null> {
  const plan = resolvePlan(deps, options.region)
  const day = resolveDay(plan.market, options.now)
  const profile = await deps.profiles.find(options.signal)
  const today = await findCurrentSnapshot(deps, {
    asOf: day,
    locale: options.locale,
    profile,
    signal: options.signal,
  })

  if (today.kind === 'current') {
    return today.snapshot
  }

  // A snapshot the profile has moved past is never served, and the older one behind it would be
  // just as stale: the caller builds instead. Only a day with no snapshot at all falls back.
  if (today.kind === 'stale') {
    return null
  }

  try {
    return await deps.store.findLatest({
      authoredLocale: options.locale,
      signal: options.signal,
    })
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    deps.logger.warn('trading.brief_snapshot_unreadable_read', {
      asOf: day,
      err: formatErrForLog(err),
    })

    return null
  }
}

async function reschedule(
  deps: BriefServiceDeps,
  options: RescheduleBriefOptions
): Promise<RescheduleBriefResult> {
  const current = await deps.deliveries.find(options.signal)

  if (current === null || current.state === 'disabled') {
    return { kind: 'rejected', reason: 'not-enabled' }
  }

  const plan = resolvePlan(deps, current.region, options.sendTime)
  const guard = scheduleGuardOf(current, plan, options.now)

  if (guard === 'delivering') {
    return { kind: 'rejected', reason: guard }
  }

  const scheduled = scheduleOf(deps, {
    region: current.region,
    delivery: current.delivery,
    sendTime: options.sendTime,
    ...(guard.skipToday ? { skipToday: true } : {}),
    now: options.now,
    signal: options.signal,
  })

  if (typeof scheduled === 'string') {
    return { kind: 'rejected', reason: scheduled }
  }

  if (await deps.deliveries.reschedule(scheduled, options.signal)) {
    return { kind: 'rescheduled', delivery: scheduled }
  }

  // A tick claimed the row, or it was switched off, between the read and the write.
  const latest = await deps.deliveries.find(options.signal)

  return { kind: 'rejected', reason: latest?.state === 'delivering' ? 'delivering' : 'not-enabled' }
}

async function enable(
  deps: BriefServiceDeps,
  options: EnableBriefOptions
): Promise<EnableBriefResult> {
  const current = await deps.deliveries.find(options.signal)
  const plan = resolvePlan(deps, options.region, options.sendTime)
  const guard = scheduleGuardOf(current, plan, options.now)

  if (guard === 'delivering') {
    return { kind: 'rejected', reason: guard }
  }

  const scheduled = scheduleOf(deps, guard.skipToday ? { ...options, skipToday: true } : options)

  if (typeof scheduled === 'string') {
    return { kind: 'rejected', reason: scheduled }
  }

  const stored = await deps.deliveries.enable(scheduled, options.signal)

  // A tick claimed the row between the read and the write.
  return stored === null
    ? { kind: 'rejected', reason: 'delivering' }
    : { kind: 'enabled', delivery: stored }
}

/** The delivery a request would store, or the reason it cannot be. */
function scheduleOf(
  deps: BriefServiceDeps,
  options: EnableBriefOptions
): ScheduledBriefDelivery | EnableBriefRejection {
  const plan = resolvePlan(deps, options.region, options.sendTime)

  // A region whose calendar owner publishes no brief would schedule a delivery that suppresses
  // every morning forever. Subscribing is the one moment a user is present to read the reason.
  if (plan.market.capabilities.brief === undefined) {
    return 'no-brief-capability'
  }

  // A chat the outbound router cannot reach would build a brief every morning and fail every send,
  // with the skipped-day notice going to the same unreachable address.
  if (!deps.sender.canDeliver(options.delivery)) {
    return 'not-deliverable'
  }

  // Guard before the schedule is computed: a send time that never lands pre-open would reschedule
  // to the same time tomorrow, forever.
  if (!isValidSendTime(plan, options.now)) {
    return 'send-time-after-open'
  }

  const today = plan.market.manifest.calendar.dayAt(options.now)
  const scheduled =
    options.skipToday === true ? nextScheduled(plan, today) : initialScheduled(plan, options.now)

  return {
    region: options.region,
    delivery: options.delivery,
    ...(options.sendTime === undefined ? {} : { sendTime: options.sendTime }),
    state: 'scheduled',
    nextDeliveryDay: scheduled.day,
    nextDueAt: scheduled.dueAt,
    attempts: 0,
  }
}
