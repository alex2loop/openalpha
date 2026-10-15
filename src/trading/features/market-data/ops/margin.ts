import type { Logger } from '@/core/logging/logger'
import type { ScreenedCandidate } from '@/trading/features/market-data/types'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { Market } from '@/trading/markets/types'
import { formatErrForLog } from '@/core/security/credentials'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import {
  MARGIN_STATUS_LOOKBACK_SESSIONS,
  standingMarginEvent,
} from '@/trading/kernel/market/margin-status'
import { SURFACE_LIMITS } from '@/trading/surface-limits'

interface MarkMarginInput {
  readonly market: Market
  readonly candidates: readonly ScreenedCandidate[]
  readonly asOf: TradingDay
  readonly now: number
  readonly signal: AbortSignal
  readonly logger: Logger
}

/** Best-effort per name: a market with no event feed marks nothing, and a name whose read fails
 *  keeps its unmarked row. One provider read per name, so it is bounded by the board a surface can
 *  show — past that the request is a bulk score read rather than a board, and marking part of one
 *  would read as the rest being eligible. */
export async function markMarginIneligible(
  input: MarkMarginInput
): Promise<readonly ScreenedCandidate[]> {
  const events = input.market.capabilities.events

  if (events === undefined || input.candidates.length > SURFACE_LIMITS.maximumScreenCandidates) {
    return input.candidates
  }

  const fromDay = input.market.manifest.calendar.addTradingDays(
    input.asOf,
    -MARGIN_STATUS_LOOKBACK_SESSIONS
  )
  const failures: unknown[] = []
  const marked = await mapWithConcurrency(
    input.candidates,
    SURFACE_LIMITS.calendarConcurrency,
    async (candidate) => {
      try {
        const result = await events.run({
          instrument: candidate.instrument,
          asOf: input.asOf,
          now: input.now,
          fromDay,
          signal: input.signal,
        })

        if (result.kind !== 'available') {
          return candidate
        }

        return standingMarginEvent(result.value, input.asOf)?.kind === 'margin-ineligible'
          ? { ...candidate, marginIneligible: true as const }
          : candidate
      } catch (err: unknown) {
        if (input.signal.aborted) {
          throw err
        }

        failures.push(err)

        return candidate
      }
    }
  )

  // A feed that is down fails every name the same way, so the first stands for all of them.
  if (failures.length > 0) {
    input.logger.warn('trading.screen_margin_unavailable', {
      failed: failures.length,
      err: formatErrForLog(failures[0]),
    })
  }

  return marked
}
