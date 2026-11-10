import { canonicalJson, hashString } from '@/core/utils/hash'
import {
  DAILY_BAND_BY_EXCHANGE,
  LIMIT_HIT_LOOKBACK_SESSIONS,
  LIMIT_HIT_MAXIMUM,
  LIQUIDITY_SESSIONS,
  MAXIMUM_DAILY_VOLATILITY,
  MINIMUM_ETF_MEDIAN_TURNOVER_VND,
  MINIMUM_FREE_FLOAT_PCT,
  MINIMUM_HISTORY_SESSIONS,
  MINIMUM_MARKET_CAP_VND,
  MINIMUM_MEDIAN_TURNOVER_VND,
  MINIMUM_TRADING_FREQUENCY_FRACTION,
  TRADING_FREQUENCY_SESSIONS,
  VN_EVIDENCE_SESSIONS,
  VN_MAX_EVIDENCE_LAG_SESSIONS,
  VOLATILITY_SESSIONS,
} from '@/trading/markets/equity-vn/policy'
import { SCREEN_GATE_BASIS } from '@/trading/markets/equity-vn/screen'

/** What a stored screen was judged by: the gates, the thresholds and the evidence windows they
 *  read. Derived from those values themselves, so no number is kept by hand and one is never
 *  reused across a change to any of them. */
export const SCREEN_POLICY_DIGEST = hashString(
  canonicalJson({
    basis: SCREEN_GATE_BASIS,
    bands: DAILY_BAND_BY_EXCHANGE,
    limits: [
      LIMIT_HIT_LOOKBACK_SESSIONS,
      LIMIT_HIT_MAXIMUM,
      LIQUIDITY_SESSIONS,
      MAXIMUM_DAILY_VOLATILITY,
      MINIMUM_ETF_MEDIAN_TURNOVER_VND,
      MINIMUM_FREE_FLOAT_PCT,
      MINIMUM_HISTORY_SESSIONS,
      MINIMUM_MARKET_CAP_VND,
      MINIMUM_MEDIAN_TURNOVER_VND,
      MINIMUM_TRADING_FREQUENCY_FRACTION,
      TRADING_FREQUENCY_SESSIONS,
      VOLATILITY_SESSIONS,
      VN_EVIDENCE_SESSIONS,
      VN_MAX_EVIDENCE_LAG_SESSIONS,
    ],
  })
)
