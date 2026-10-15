import type { EvidenceReduceReasonCode } from '@/trading/kernel/caveat'
import type { CryptoFactorId } from '@/trading/kernel/factor'
import type { CryptoAssetEvidence } from '@/trading/markets/crypto/factors'
import type { FactorInput } from '@/trading/markets/factor-scoring'
import { fundingDailyOf } from '@/trading/markets/crypto/funding'
import {
  CROWDED_FUNDING_DAILY_PCT,
  CRYPTO_INVALIDATION_SESSIONS,
} from '@/trading/markets/crypto/policy'
import { trailingLow } from '@/trading/markets/timeseries'

/** A close below the low of the sessions before it is the breakout failing, whatever else the
 *  board says; longs paying crowded funding while the name is held is the tranche to take. The
 *  first outranks the second, and neither is read on a name with no series. */
export function cryptoReduceSignal(
  evidence: CryptoAssetEvidence,
  inputs: readonly FactorInput<CryptoFactorId>[]
): EvidenceReduceReasonCode | undefined {
  const closes = evidence.candles.map((candle) => candle.close)
  const last = closes[closes.length - 1]
  const low = trailingLow(closes.slice(0, -1), CRYPTO_INVALIDATION_SESSIONS)

  if (last !== undefined && low !== undefined && last < low) {
    return 'structure-broken'
  }

  const rate = fundingDailyOf(inputs)

  return rate !== undefined && rate >= CROWDED_FUNDING_DAILY_PCT ? 'overheated' : undefined
}
