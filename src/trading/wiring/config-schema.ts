import { z } from 'zod'

import { LOCAL_TIME_RE, MAX_TIMER_MS, parseIsoDay } from '@/core/utils/time'
import { DEBATE_MODES, FEE_ASSETS } from '@/trading/kernel/config'
import { isMarketRefShape, isVenueRefShape } from '@/trading/kernel/instrument'
import { isSourceId } from '@/trading/kernel/source/source-id'

/** Exported so the source registry points a config error at this path without restating the key. */
export const SOURCES_CONFIG_KEY = 'sources'

/** Exported so composition points a config error at this path without restating the key. */
export const MARKETS_CONFIG_KEY = 'markets'

/** Exported so composition points a config error at this path without restating the key. */
export const VENUES_CONFIG_KEY = 'venues'

const ENV_VAR_RE = /^[A-Z_][A-Z0-9_]*$/

// A rate this high is a misplaced decimal, not a fee: 0.15 typed for 0.0015 would print a 30%
// round trip. Nothing real reaches five percent a side.
const MAXIMUM_COST_RATE = 0.05

// The operator's level keys are bounded where a value stops being a choice and becomes a typo: a
// stop under 2% sits inside one ordinary session's swing, past 30% is a loss no plan should budget,
// and past 5 ATRs or 5R the levels are well beyond the widest any shipped market uses (3).
const MAXIMUM_STOP_LOSS_BOUNDS = Object.freeze({ minimum: 0.02, maximum: 0.3 })
const STOP_LOSS_ATR_BOUNDS = Object.freeze({ minimum: 1, maximum: 5 })
const REWARD_RISK_BOUNDS = Object.freeze({ minimum: 1, maximum: 5 })

const localTime = z.string().regex(LOCAL_TIME_RE)
const interval = z.int().positive().max(MAX_TIMER_MS)

const costRate = z.number().min(0).max(MAXIMUM_COST_RATE)
const boundedNumber = (bounds: { readonly minimum: number; readonly maximum: number }) =>
  z.number().min(bounds.minimum).max(bounds.maximum)
const CEILING_TRIM_MARKET = 'equity-vn'

const configMarketRef = z.string().refine(isMarketRefShape, 'must be a market ref')
const configVenueRef = z.string().refine(isVenueRefShape, 'must be a venue ref')
const configDay = z.iso
  .date()
  .refine((value) => parseIsoDay(value) !== undefined, 'must be a calendar day YYYY-MM-DD')

export const tradingConfigPatchSchema = z.strictObject({
  suggestions: z
    .strictObject({
      cooldown_sessions: z.int().nonnegative().optional(),
      debate_mode: z.enum(DEBATE_MODES).optional(),
    })
    .optional(),
  [MARKETS_CONFIG_KEY]: z
    .record(
      configMarketRef,
      z.strictObject({
        holidays: z.array(configDay).optional(),
        maximum_stop_loss: boundedNumber(MAXIMUM_STOP_LOSS_BOUNDS).optional(),
        stop_loss_atr: boundedNumber(STOP_LOSS_ATR_BOUNDS).optional(),
        reward_risk: boundedNumber(REWARD_RISK_BOUNDS).optional(),
        ceiling_trim_sessions: z.int().nonnegative().optional(),
      })
    )
    .refine(
      (markets) =>
        Object.entries(markets).every(
          ([id, settings]) =>
            settings.ceiling_trim_sessions === undefined || id === CEILING_TRIM_MARKET
        ),
      `ceiling_trim_sessions is read only by ${CEILING_TRIM_MARKET}`
    )
    .optional(),
  briefs: z.strictObject({ send_time: localTime.optional() }).optional(),
  intraday: z.strictObject({ send_times: z.array(localTime).optional() }).optional(),
  alerts: z
    .strictObject({
      breakout_range: z.number().positive().optional(),
      breakout_sessions: z.int().positive().optional(),
    })
    .optional(),
  typed_prices: z.strictObject({ confirm_multiple: z.number().gt(1).optional() }).optional(),
  orders: z
    .strictObject({
      maximum_stake_quote: z.number().nonnegative().optional(),
      maximum_open_trades: z.int().nonnegative().optional(),
      maximum_price_drift: z.number().positive().optional(),
      allow_unattended: z.boolean().optional(),
      require_stop_loss: z.boolean().optional(),
    })
    .optional(),
  [VENUES_CONFIG_KEY]: z
    .record(
      configVenueRef,
      z.strictObject({
        default_for: z.array(configMarketRef).optional(),
        markets: z.array(configMarketRef).optional(),
        fees: z
          .strictObject({
            buy: costRate,
            sell: costRate,
            sell_tax: costRate.optional(),
            fee_asset: z.enum(FEE_ASSETS).optional(),
          })
          .optional(),
        simulated: z.boolean().optional(),
        credentials: z
          .record(z.string(), z.string().regex(ENV_VAR_RE, 'must be an environment variable name'))
          .optional(),
      })
    )
    .optional(),
  refresh: z.strictObject({ interval_ms: interval.optional() }).optional(),
  [SOURCES_CONFIG_KEY]: z
    .record(
      z.string().refine(isSourceId, 'must be a source id'),
      z.string().regex(ENV_VAR_RE, 'must be an environment variable name')
    )
    .optional(),
  themes: z.strictObject({ maximum_cost_usd: z.number().positive().optional() }).optional(),
})
