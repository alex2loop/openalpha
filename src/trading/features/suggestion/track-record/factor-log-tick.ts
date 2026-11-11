import type { Logger } from '@/core/logging/logger'
import type {
  FactorLogCaptureResult,
  FactorLogId,
  FactorLogService,
} from '@/trading/features/suggestion/track-record/factor-log-types'
import type { MarketRef } from '@/trading/kernel/instrument'
import { formatErrForLog } from '@/core/security/credentials'

interface FactorLogTickDeps {
  readonly factorLog: FactorLogService
  readonly batchSize: number
  readonly logger: Logger
}

/** Capture first, then resolve: a tick that runs right after a session settles logs the board and,
 *  on the same pass, scores whatever earlier boards have reached the end of their window. Every
 *  page is walked, for the reason the outcome tick gives. */
export function createFactorLogTick(
  deps: FactorLogTickDeps
): (markets: readonly MarketRef[], signal: AbortSignal) => Promise<void> {
  return async (markets, signal) => {
    const now = Date.now()
    const capture = await deps.factorLog.capture({ now, markets, signal })

    if (capture.captured.length > 0) {
      deps.logger.info('trading.factor_log_captured', { boards: capture.captured })
    }

    for (const skip of capture.skipped) {
      logSkip(deps.logger, skip)
    }

    let cursor: FactorLogId | undefined

    do {
      const batch = await deps.factorLog.resolvePending({
        now,
        batchSize: deps.batchSize,
        ...(cursor === undefined ? {} : { cursor }),
        signal,
      })

      cursor = batch.nextCursor
    } while (cursor !== undefined)
  }
}

type Skip = FactorLogCaptureResult['skipped'][number]

function logSkip(logger: Logger, skip: Skip): void {
  if (skip.reason === 'no-screen') {
    logger.debug('trading.factor_log_no_screen', { market: skip.market, day: skip.day })
  }

  if (skip.reason === 'already-captured') {
    logger.debug('trading.factor_log_already_captured', { market: skip.market, day: skip.day })
  }

  if (skip.reason === 'capture-failed') {
    logger.warn('trading.factor_log_capture_failed', {
      market: skip.market,
      err: formatErrForLog(skip.error),
    })
  }

  // Lost for good once the next session settles: capture asks only for the newest settled day.
  if (skip.reason === 'evidence-lagging' || skip.reason === 'universe-empty') {
    logger.warn('trading.factor_log_capture_deferred', {
      market: skip.market,
      reason: skip.reason,
      day: skip.day,
      dataThroughDay: skip.dataThroughDay,
    })
  }
}
