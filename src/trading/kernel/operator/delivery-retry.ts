import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { DeliveryErrorCode } from '@/trading/kernel/caveat'
import type { RetryPolicy } from '@/trading/kernel/config'
import type { DeliveryAddress } from '@/trading/kernel/operator/delivery'
import type {
  NoticeKind,
  TradingNotice,
  TradingNoticeSender,
  TradingNoticeSendResult,
} from '@/trading/kernel/operator/notice'
import { abortError, isAbortError, ValidationError } from '@/core/errors'

const BACKOFF_FACTOR = 2
// Not a tunable - the attempt cap ends a sequence. This only keeps the ladder schedulable.
const MAXIMUM_DELAY_MS = 3_600_000

type SendOutcome = 'accepted' | DeliveryErrorCode

/** The one durable-backoff schedule, shared by alerts and briefs. Channel notifier retries are a
 *  different thing: they retry one live send inside the channel's own queue, while this schedules
 *  the next durable domain attempt after that live send has terminally failed. */
export function nextAttemptAt(now: number, attempts: number, policy: RetryPolicy): number {
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new ValidationError(`attempt count must be a positive integer, got ${attempts}`)
  }

  if (!Number.isSafeInteger(now) || now < 0) {
    throw new ValidationError(`now must be a non-negative safe integer, got ${now}`)
  }

  const delayMs = Math.min(
    MAXIMUM_DELAY_MS,
    policy.initialDelayMs * BACKOFF_FACTOR ** (attempts - 1)
  )
  const at = now + delayMs

  if (!Number.isSafeInteger(at)) {
    throw new ValidationError(`next attempt instant is not representable: ${at}`)
  }

  return at
}

/** The one classification of a sender outcome, shared by both delivery loops. Catches per item,
 *  not per tick: one throwing send must not abandon the rest of a claimed batch that is holding
 *  live leases. An abort rethrows — shutdown is not a channel failure. */
export async function sendCaught(
  sender: TradingNoticeSender,
  notice: TradingNotice,
  signal: AbortSignal
): Promise<SendOutcome> {
  let result: TradingNoticeSendResult

  try {
    result = await sender.send(notice, signal)
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    return 'channel-rejected'
  }

  if (result === 'aborted') {
    throw abortError(signal)
  }
  return result === 'accepted' ? 'accepted' : 'channel-unavailable'
}

interface DeliveryNoticeInput {
  readonly kind: 'delivery-disabled' | 'delivery-skipped' | 'delivery-missed'
  readonly sender: TradingNoticeSender
  readonly target: DeliveryAddress
  readonly locale: Locale
  readonly subject: NoticeKind
  /** The unset key variable that stopped the delivery, when one did. */
  readonly missingEnv?: string
  readonly logger: Logger
  readonly signal: AbortSignal
}

/** Best-effort: a silent stop leaves the operator waiting for a delivery that never comes. The
 *  channel that just failed every attempt may refuse this too, so a refusal is logged, never
 *  raised - the disable or the skip must still happen. */
export async function notifyDeliveryStopped(input: DeliveryNoticeInput): Promise<void> {
  const notice: TradingNotice = {
    target: input.target,
    locale: input.locale,
    payload:
      input.missingEnv === undefined
        ? { kind: input.kind, subject: input.subject }
        : { kind: 'key-missing', subject: input.subject, env: input.missingEnv },
  }
  const outcome = await sendCaught(input.sender, notice, input.signal)

  if (outcome !== 'accepted') {
    input.logger.warn('trading.delivery_notice_undelivered', {
      kind: input.kind,
      subject: input.subject,
      outcome,
    })
  }
}
