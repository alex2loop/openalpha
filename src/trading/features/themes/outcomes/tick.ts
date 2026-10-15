import type { Logger } from '@/core/logging/logger'
import type { ThemeService } from '@/trading/features/themes/types'

interface ThemeOutcomeTickDeps {
  readonly themes: Pick<ThemeService, 'resolveOutcomes'>
  readonly batchSize: number
  readonly logger: Logger
}

/** Every page is walked, for the reason the suggestion outcome tick gives. */
export function createThemeOutcomeTick(
  deps: ThemeOutcomeTickDeps
): (signal: AbortSignal) => Promise<void> {
  return async (signal) => {
    const now = Date.now()
    let cursor: string | undefined
    let resolved = 0

    do {
      const batch = await deps.themes.resolveOutcomes({
        now,
        batchSize: deps.batchSize,
        ...(cursor === undefined ? {} : { cursor }),
        signal,
      })

      resolved += batch.resolved
      cursor = batch.nextCursor
    } while (cursor !== undefined)

    if (resolved > 0) {
      deps.logger.info('trading.theme_outcomes_resolved', { resolved })
    }
  }
}
