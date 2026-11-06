import { unrefTimer } from '@/core/utils/time'

interface PeriodicPassOptions {
  readonly everyMs: number
  readonly pass: () => Promise<void>
  /** Told of a pass that failed; the next one still runs on schedule. */
  readonly onError: (err: unknown) => void
}

export interface PeriodicPass {
  /** Clears the timer and waits out the pass in flight; safe to call twice. */
  readonly stop: () => Promise<void>
  /** Runs a pass now when the last one started at least `everyMs` ago by the wall clock, which
   *  keeps counting while a sleeping machine's timers do not; otherwise does nothing. */
  readonly runIfDue: () => void
}

/** Runs `pass` now and every `everyMs`, never two at once: a tick that finds one in flight is
 *  skipped. A failed pass is reported and waits for the next tick. */
export function createPeriodicPass(options: PeriodicPassOptions): PeriodicPass {
  let inFlight: Promise<void> | null = null
  let stopped = false
  let lastStartedAt = 0

  const run = (): void => {
    if (stopped || inFlight !== null) {
      return
    }

    lastStartedAt = Date.now()
    inFlight = attempt(options.pass)
      .catch((err: unknown) => reportQuietly(options.onError, err))
      .finally(() => {
        inFlight = null
      })
  }

  // A pass is never worth holding a process open for.
  const timer = unrefTimer(setInterval(run, options.everyMs))

  // The first pass is not deferred an interval: whatever accrued while nothing ran is due now.
  run()

  return {
    stop: async () => {
      stopped = true
      clearInterval(timer)

      if (inFlight !== null) {
        await inFlight
      }
    },
    runIfDue: () => {
      if (Date.now() - lastStartedAt >= options.everyMs) {
        run()
      }
    },
  }
}

// Async so a pass that throws before its first await is a failed pass, not a throw out of a timer.
async function attempt(pass: () => Promise<void>): Promise<void> {
  await pass()
}

// A reporter that throws must not leave the pass rejected: the stop awaits it and cannot fail.
function reportQuietly(onError: (err: unknown) => void, err: unknown): void {
  try {
    onError(err)
  } catch {
    // Nowhere left to report to.
  }
}
