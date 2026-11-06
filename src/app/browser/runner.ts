import type { ResolvedBudget } from '@/core/config/resolve'
import type { HaltDetail } from '@/core/errors'
import type { Runner } from '@/engine/api'

const DAILY_CAP: HaltDetail = 'daily_cap'
const DAILY_CAP_KEY = 'errors.browserDailyCap'

/** A web run as the daemon's, except that the daily cap stopping it says so in the visitor's words:
 *  the installed wording names a config key the page has none of. */
export function createBrowserRunner(
  runner: Runner,
  budget: Pick<ResolvedBudget, 'maxDailyUsd'>
): Runner {
  return {
    async run(input, options) {
      const result = await runner.run(input, options)

      if (result.haltDetail !== DAILY_CAP) {
        return result
      }

      return {
        ...result,
        operator: {
          key: DAILY_CAP_KEY,
          params: { cap: { amount: budget.maxDailyUsd, digits: 0 } },
        },
      }
    },
  }
}
