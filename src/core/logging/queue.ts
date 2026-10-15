import type { LogDestinationHooks, LogQueueState } from './files'

const MAX_PENDING_LOG_RECORDS = 256
const MAX_PENDING_LOG_BYTES = 1_048_576
const QUEUE_OVERFLOW_TEXT = 'Logging queue full; excess records were dropped.\n'

export interface PendingLogQueue {
  reserve(bytes: number): boolean
  release(bytes: number): void
}

export function createPendingLogQueue(hooks?: LogDestinationHooks): PendingLogQueue {
  let pendingRecords = 0
  let pendingBytes = 0
  let overflowReported = false

  return {
    reserve: (bytes) => {
      if (
        pendingRecords >= MAX_PENDING_LOG_RECORDS ||
        pendingBytes + bytes > MAX_PENDING_LOG_BYTES
      ) {
        reportOverflow()
        return false
      }

      pendingRecords += 1
      pendingBytes += bytes
      notifyQueueChange()
      return true
    },
    release: (bytes) => {
      pendingRecords -= 1
      pendingBytes -= bytes

      if (pendingRecords === 0) {
        overflowReported = false
      }

      notifyQueueChange()
    },
  }

  function notifyQueueChange(): void {
    const state: LogQueueState = { pendingRecords, pendingBytes }

    try {
      hooks?.onQueueChange?.(state)
    } catch {
      // Diagnostics must not affect queue ownership.
    }
  }

  function reportOverflow(): void {
    if (overflowReported) {
      return
    }

    overflowReported = true

    try {
      process.stderr.write(QUEUE_OVERFLOW_TEXT)
    } catch {
      // The bounded fallback must never recurse into logging.
    }
  }
}
