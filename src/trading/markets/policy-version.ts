import STRATEGY_RECORD from '@/trading/markets/strategy-versions.json'

const POLICY_CALCULATION_NAME = 'policy'

type PolicyRecordKey = Exclude<keyof typeof STRATEGY_RECORD, 'themes'>

/** The digest `check-strategy-version` recorded for the market's policy literals. A policy change
 *  re-recorded under the same `*_STRATEGY_VERSION` still moves it, so the track record never
 *  pools calls made under different policies. */
export function policyVersionOf(record: PolicyRecordKey): {
  readonly name: string
  readonly version: string
} {
  return { name: POLICY_CALCULATION_NAME, version: STRATEGY_RECORD[record].digest }
}
