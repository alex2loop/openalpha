import type { DaemonTask } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import type { OperationTick } from '@/trading/wiring/loop'

const BOOT_REFRESH_BUDGET_MS = 60_000

/** The one owner of "the first market data sweep is done". The refresh loop's first pass is that
 *  sweep, and the loops that read market data wait on `settled` before their first tick. */
export interface FirstSweep {
  /** Settles when the first refresh pass has ended however it ended, when its budget has run out
   *  (a stuck provider or an offline start never holds the other loops), or when the refresh loop
   *  has ended. */
  readonly settled: Promise<void>
  /** `tick`, releasing the loops once it has settled. */
  releaseAfterPass(tick: OperationTick): OperationTick
  /** `task`, with the budget armed while it runs. Nothing is aborted when the budget runs out: an
   *  aborted kind writes no attempt row, so the next pass would redo its whole scope. */
  withBudget(task: DaemonTask): DaemonTask
}

export function createFirstSweep(logger: Logger): FirstSweep {
  const { promise, resolve } = Promise.withResolvers<void>()
  let isReleased = false
  let budgetTimer: ReturnType<typeof setTimeout> | undefined

  // Idempotent: the first pass, the budget and the end of the loop each call it.
  const release = (): void => {
    isReleased = true
    clearTimeout(budgetTimer)
    resolve()
  }
  const armBudget = (): void => {
    if (isReleased) {
      return
    }

    budgetTimer = setTimeout(() => {
      logger.warn('trading.boot_refresh_timeout', { budgetMs: BOOT_REFRESH_BUDGET_MS })
      release()
    }, BOOT_REFRESH_BUDGET_MS)
  }

  return {
    settled: promise,
    releaseAfterPass: (tick) => async (signal, notes) => {
      try {
        await tick(signal, notes)
      } finally {
        release()
      }
    },
    withBudget: (task) => ({
      ...task,
      async start(signal) {
        armBudget()

        try {
          await task.start(signal)
        } finally {
          release()
        }
      },
    }),
  }
}
