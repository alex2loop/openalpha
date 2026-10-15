import type { DaemonTask } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { DeliveryAddress } from '@/trading/kernel/operator/delivery'
import type { TradingNotice, TradingNoticeSender } from '@/trading/kernel/operator/notice'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { MS_PER_DAY, MS_PER_HOUR, sleep } from '@/core/utils/time'
import { sendCaught } from '@/trading/kernel/operator/delivery-retry'

/** A failure that is this code being wrong repeats on the next run, so the wait is long enough for
 *  the operator to read the notice and a fix to ship before the loop tries again. */
const QUARANTINE_COOLDOWN_MS = MS_PER_HOUR
const QUARANTINE_MAXIMUM_RESTARTS = 3
// A loop that ran this long before failing again had recovered, so its restart budget starts over.
const QUARANTINE_HEALTHY_RUN_MS = MS_PER_DAY

interface QuarantineDeps {
  readonly sender: TradingNoticeSender
  recipient(): DeliveryAddress | undefined
  readonly locale: Locale
  readonly logger: Logger
}

/** One loop failing stops that loop, not the daemon: a malformed stored row in one tick must not
 *  take the channels and every other loop down with it. The failure is never silent - it is logged
 *  and sent to the operator at once - and the restarts are bounded so a loop that is wrong every
 *  time ends stopped rather than spinning on an hourly error. */
export function withQuarantine(task: DaemonTask, deps: QuarantineDeps): DaemonTask {
  return {
    name: task.name,
    start: (signal) => superviseTask(task, deps, signal),
  }
}

async function superviseTask(
  task: DaemonTask,
  deps: QuarantineDeps,
  signal: AbortSignal
): Promise<void> {
  let restarts = 0

  while (!signal.aborted) {
    const startedAt = performance.now()

    try {
      await task.start(signal)
      return
    } catch (err: unknown) {
      if (isAbortError(err) || signal.aborted) {
        return
      }

      if (performance.now() - startedAt >= QUARANTINE_HEALTHY_RUN_MS) {
        restarts = 0
      }

      const willRestart = restarts < QUARANTINE_MAXIMUM_RESTARTS

      deps.logger.error('trading.loop_quarantined', {
        operation: task.name,
        restarts,
        willRestart,
        err: formatErrForLog(err),
      })
      await announce(task.name, deps, { willRestart, signal })

      if (!(willRestart && (await waitCooldown(signal)))) {
        return
      }

      restarts += 1
    }
  }
}

interface AnnounceInput {
  readonly willRestart: boolean
  readonly signal: AbortSignal
}

/** A notice that cannot be sent is logged and dropped: the log line above already holds the cause.
 *  `sendCaught` turns a throwing sender into an outcome, so only shutdown arrives as a throw, and
 *  the cooldown wait then ends the supervision. */
async function announce(
  operation: string,
  deps: QuarantineDeps,
  input: AnnounceInput
): Promise<void> {
  const target = deps.recipient()

  if (target === undefined) {
    return
  }

  const notice: TradingNotice = {
    target,
    locale: deps.locale,
    payload: {
      kind: 'loop-quarantined',
      operation,
      ...(input.willRestart ? { retryInMs: QUARANTINE_COOLDOWN_MS } : {}),
    },
  }

  try {
    const outcome = await sendCaught(deps.sender, notice, input.signal)

    if (outcome !== 'accepted') {
      deps.logger.warn('trading.quarantine_notice_undelivered', { operation, outcome })
    }
  } catch (err: unknown) {
    if (!isAbortError(err)) {
      throw err
    }
  }
}

/** `false` means shutdown arrived first. `sleep` clears its timer on abort. */
async function waitCooldown(signal: AbortSignal): Promise<boolean> {
  try {
    await sleep(QUARANTINE_COOLDOWN_MS, signal)
    return true
  } catch (err: unknown) {
    if (isAbortError(err)) {
      return false
    }

    throw err
  }
}
