import type { FactorLogResolveDeps } from '@/trading/features/suggestion/track-record/factor-log-resolve'
import type { FactorLogService } from '@/trading/features/suggestion/track-record/factor-log-types'
import { captureBoards } from '@/trading/features/suggestion/track-record/factor-log-capture'
import { resolvePendingEntries } from '@/trading/features/suggestion/track-record/factor-log-resolve'

export function createFactorLogService(deps: FactorLogResolveDeps): FactorLogService {
  return {
    capture: (options) => captureBoards(deps, options),
    resolvePending: (options) => resolvePendingEntries(deps, options),
    listResolved: (options) => deps.store.listResolved(options),
  }
}
