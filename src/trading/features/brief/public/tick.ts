import type { Logger } from '@/core/logging/logger'
import type {
  BuiltPublicBriefRow,
  PublicBriefInput,
  PublicBriefPublisher,
  PublicBriefRender,
  PublicBriefRow,
  PublicBriefStore,
  PublishOutcome,
} from '@/trading/features/brief/public/types'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { TradingCalendar } from '@/trading/markets/types'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { MS_PER_MINUTE } from '@/core/utils/time'
import { isBuilt, PUBLIC_BRIEF_MAX_ATTEMPTS } from '@/trading/features/brief/public/store'
import { resolveLocalTimeAt } from '@/trading/markets/calendar'

export const PUBLIC_BRIEF_TICK_MS = MS_PER_MINUTE
const PUBLIC_BRIEF_RETRY_MS = 5 * MS_PER_MINUTE
/** Subscribers from which each publish says the push list is nearing its cap. */
const PUBLIC_BRIEF_PUSH_WARN_AT = 40
const STATUS_REQUEST_TIMEOUT = 408
const STATUS_TOO_MANY_REQUESTS = 429
const STATUS_SERVER_ERROR = 500

interface PublicBriefTickDeps {
  /** The calendar the brief is dated and timed on. */
  readonly calendar: TradingCalendar
  /** Local `HH:mm` in the calendar's zone. */
  readonly publishTime: string
  readonly store: Pick<PublicBriefStore, 'find' | 'recordAttempt'>
  readonly publisher: PublicBriefPublisher
  readonly logger: Logger
  build(input: PublicBriefInput): Promise<BuiltPublicBriefRow | null>
  render(row: BuiltPublicBriefRow): PublicBriefRender
  /** Only the kind is read: what the guard found never leaves the guard. `refuse` is the guard's
   *  finding on this render and stands for the day; `unread` is the guard failing to look, which a
   *  later attempt may cure. */
  judge(
    row: BuiltPublicBriefRow,
    render: PublicBriefRender,
    signal: AbortSignal
  ): Promise<{ readonly kind: 'publish' | 'refuse' | 'unread' }>
}

/** What a tick may say about its own pass: the loop reports a failed day as the pass's error. */
interface TickNotes {
  fail(): void
}

interface Attempt {
  readonly day: TradingDay
  readonly now: number
  readonly signal: AbortSignal
  readonly row: PublicBriefRow | null
  readonly notes: TickNotes
}

type Settled = Extract<PublishOutcome, { readonly kind: 'stored' | 'unchanged' }>

type AttemptResult =
  | { readonly kind: 'late' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'closed'; readonly status: number }
  | { readonly kind: 'sent'; readonly outcome: Settled }

/** One pass per minute, so it never overlaps itself: it posts today's brief once, before the open.
 *  A post that fails is retried a few minutes later up to a bound. A refusal the guard or the public
 *  side will repeat closes the day, and so does the session opening first: an attempt runs under a
 *  deadline at the open, and a day it misses is dropped and logged. Nothing here touches the
 *  owner's brief. */
export function createPublicBriefTick(
  deps: PublicBriefTickDeps
): (signal: AbortSignal, notes: TickNotes) => Promise<void> {
  return async (signal, notes) => {
    const now = Date.now()
    const day = deps.calendar.dayAt(now)

    if (!isInWindow(deps, day, now)) {
      return
    }

    const row = await deps.store.find(day, signal)

    if (!isDue(row, now)) {
      return
    }

    const attempt = { day, now, signal, row, notes }

    await settle(deps, attempt, await runAttempt(deps, attempt))
  }
}

/** A trading day, from the publish time until the session opens. */
function isInWindow(deps: PublicBriefTickDeps, day: TradingDay, now: number): boolean {
  const { calendar } = deps

  return (
    calendar.isTradingDay(day) &&
    now >= resolveLocalTimeAt(day, deps.publishTime, calendar.timezone) &&
    now < calendar.sessionOpenAt(day)
  )
}

function isDue(row: PublicBriefRow | null, now: number): boolean {
  if (row === null) {
    return true
  }

  return (
    row.publishedAt === undefined &&
    row.attempts < PUBLIC_BRIEF_MAX_ATTEMPTS &&
    (row.lastAttemptAt === undefined || row.lastAttemptAt + PUBLIC_BRIEF_RETRY_MS <= now)
  )
}

/** One attempt under a deadline at the session open, so a slow build stops there instead of running
 *  past it. The deadline's abort is a late day; the loop's own abort is shutdown and propagates. */
async function runAttempt(deps: PublicBriefTickDeps, attempt: Attempt): Promise<AttemptResult> {
  const { day, now, signal } = attempt
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), deps.calendar.sessionOpenAt(day) - now)

  try {
    return await post(deps, { ...attempt, signal: AbortSignal.any([signal, deadline.signal]) })
  } catch (err: unknown) {
    if (deadline.signal.aborted && !signal.aborted) {
      return { kind: 'late' }
    }

    return logFailure(deps, day, err)
  } finally {
    clearTimeout(timer)
  }
}

/** Posts exactly the render the guard judged. The session is checked again after the judging, which
 *  can take a while. */
async function post(deps: PublicBriefTickDeps, attempt: Attempt): Promise<AttemptResult> {
  const { day, now, signal, row } = attempt
  const built = row !== null && isBuilt(row) ? row : await deps.build({ day, now, signal })

  if (built === null) {
    return { kind: 'failed', reason: 'empty' }
  }

  const render = deps.render(built)
  const verdict = await deps.judge(built, render, signal)

  if (verdict.kind === 'refuse') {
    return { kind: 'refused' }
  }

  if (verdict.kind === 'unread') {
    return { kind: 'failed', reason: 'guard-unread' }
  }

  if (Date.now() >= deps.calendar.sessionOpenAt(day)) {
    return { kind: 'late' }
  }

  return toResult(await deps.publisher.publish(render, signal))
}

function toResult(outcome: PublishOutcome): AttemptResult {
  if (outcome.kind === 'unreachable') {
    return { kind: 'failed', reason: 'unreachable' }
  }

  if (outcome.kind === 'refused') {
    return isRetryable(outcome.status)
      ? { kind: 'failed', reason: `http-${outcome.status}` }
      : { kind: 'closed', status: outcome.status }
  }

  return { kind: 'sent', outcome }
}

function isRetryable(status: number): boolean {
  return (
    status === STATUS_REQUEST_TIMEOUT ||
    status === STATUS_TOO_MANY_REQUESTS ||
    status >= STATUS_SERVER_ERROR
  )
}

/** A failure of the build (its refresh, reads and saved row), of the guard or of the post counts as
 *  an attempt, so a day that keeps failing stops at the bound instead of running once a minute. A
 *  failure of the store reading or recording the attempt itself is not caught here: the pass fails
 *  and the next minute tries again. Shutdown is not a failure. */
function logFailure(deps: PublicBriefTickDeps, day: TradingDay, err: unknown): AttemptResult {
  if (isAbortError(err)) {
    throw err
  }

  deps.logger.error('trading.public_brief_attempt_failed', { day, err: formatErrForLog(err) })

  return { kind: 'failed', reason: 'error' }
}

async function settle(
  deps: PublicBriefTickDeps,
  attempt: Attempt,
  result: AttemptResult
): Promise<void> {
  const { day, signal, notes } = attempt
  const at = Date.now()

  if (result.kind === 'sent') {
    logPublished(deps, day, result.outcome)
    await deps.store.recordAttempt({ day, at, publishedAt: at }, signal)

    return
  }

  notes.fail()

  if (result.kind === 'failed') {
    await recordFailure(deps, attempt, result.reason)

    return
  }

  logClosed(deps, day, result)
  await deps.store.recordAttempt({ day, at, closed: true }, signal)
}

/** A day with no attempt left to spend. A guard refusal logged itself where the names are known. */
function logClosed(
  deps: PublicBriefTickDeps,
  day: TradingDay,
  result: Extract<AttemptResult, { readonly kind: 'late' | 'refused' | 'closed' }>
): void {
  if (result.kind === 'late') {
    deps.logger.warn('trading.public_brief_late', { day })
  }

  if (result.kind === 'closed') {
    deps.logger.error('trading.public_brief_publish_refused', { day, status: result.status })
  }
}

async function recordFailure(
  deps: PublicBriefTickDeps,
  attempt: Attempt,
  reason: string
): Promise<void> {
  const { day, signal } = attempt

  await deps.store.recordAttempt({ day, at: Date.now() }, signal)

  const attempts = (attempt.row?.attempts ?? 0) + 1

  if (attempts >= PUBLIC_BRIEF_MAX_ATTEMPTS) {
    deps.logger.warn('trading.public_brief_publish_failed', { day, attempts, reason })
  }
}

function logPublished(deps: PublicBriefTickDeps, day: TradingDay, outcome: Settled): void {
  const { subscribers, rejected } = outcome

  deps.logger.info('trading.public_brief_published', { day, subscribers })

  if (subscribers >= PUBLIC_BRIEF_PUSH_WARN_AT) {
    deps.logger.warn('trading.public_brief_push_near_limit', {
      day,
      subscribers,
      warnAt: PUBLIC_BRIEF_PUSH_WARN_AT,
    })
  }

  if (rejected > 0) {
    deps.logger.error('trading.public_brief_push_full', { day, rejected })
  }
}
