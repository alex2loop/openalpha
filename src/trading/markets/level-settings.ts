import type { MarketConfig } from '@/trading/kernel/config'
import type { LevelPolicy } from '@/trading/kernel/factor'
import { definedOnly } from '@/core/utils/collections'
import { hashString } from '@/core/utils/hash'

const SETTINGS_FINGERPRINT_LENGTH = 8

/** The market's own policy with the operator's `[trading.markets.<id>]` level keys laid over it.
 *  One number serves both horizons: a segment runs one horizon at a time. */
export function resolveLevelPolicy(
  policy: LevelPolicy,
  settings: MarketConfig | undefined
): LevelPolicy {
  if (settings === undefined) {
    return policy
  }

  const { maximumStopLoss, stopLossAtr, rewardRisk } = settings

  return Object.freeze({
    ...policy,
    ...(stopLossAtr === undefined ? {} : { stopVolatilityMultiplier: everyHorizon(stopLossAtr) }),
    ...(rewardRisk === undefined ? {} : { targetRiskMultiplier: everyHorizon(rewardRisk) }),
    ...(maximumStopLoss === undefined ? {} : { maximumStopLoss }),
  })
}

/** Plans priced under the operator's level keys are a different strategy from the shipped one. The
 *  suffix keeps reuse, re-planning and the track record from blending the two, because every one
 *  of them already keys on the version. */
export function strategyVersionOf(version: string, settings: MarketConfig | undefined): string {
  const levels = definedOnly({
    maximumStopLoss: settings?.maximumStopLoss,
    stopLossAtr: settings?.stopLossAtr,
    rewardRisk: settings?.rewardRisk,
  })

  if (Object.keys(levels).length === 0) {
    return version
  }

  return `${version}+${hashString(JSON.stringify(levels)).slice(0, SETTINGS_FINGERPRINT_LENGTH)}`
}

function everyHorizon(value: number): LevelPolicy['stopVolatilityMultiplier'] {
  return Object.freeze({ short: value, long: value })
}
