import type { Logger } from '@/core/logging/logger'
import type {
  FactorLogId,
  FactorLogService,
} from '@/trading/features/suggestion/track-record/factor-log-types'
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
): (signal: AbortSignal) => Promise<void> {
  return async (signal) => {
    const now = Date.now()
    const capture = await deps.factorLog.capture({ now, signal })

    if (capture.captured.length > 0) {
      deps.logger.info('trading.factor_log_captured', { boards: capture.captured })
    }

    for (const skip of capture.skipped) {
      if (skip.reason === 'capture-failed') {
        deps.logger.warn('trading.factor_log_capture_failed', {
          market: skip.market,
          err: formatErrForLog(skip.error),
        })
      }
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
