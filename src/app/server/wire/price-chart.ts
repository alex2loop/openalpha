import type {
  TradingCandleWire,
  TradingWireCaveat,
  TradingWireProvenance,
} from '@/app/server/wire/trading'
import type { PriceWindow } from '@/app/server/wire/vocab'

/** A moving average of the close over `sessions` sessions, one value per bar of the response,
 *  `null` where fewer than `sessions` closes stand behind it. */
interface TradingPriceAverageWire {
  readonly sessions: number
  readonly values: readonly (number | null)[]
}

/** The latest session's `volume` against the mean of the `sessions` before it: `ratio` 1.5 is half
 *  as much again as usual. Absent for a name that did not trade that session. */
interface TradingRelativeVolumeWire {
  readonly day: string
  readonly volume: number
  readonly sessions: number
  readonly ratio: number
}

/** One name's settled bars over `window` with the averages a chart draws over them. A market with
 *  no price history of its own answers unavailable instead. */
export interface TradingPriceChartResponse {
  readonly market: string
  readonly ticker: string
  /** The sector slug the market files the name under; absent where it files none. */
  readonly sector?: string
  readonly window: PriceWindow
  readonly bars: readonly TradingCandleWire[]
  readonly averages: readonly TradingPriceAverageWire[]
  readonly relativeVolume?: TradingRelativeVolumeWire
  readonly provenance: readonly TradingWireProvenance[]
  readonly caveats: readonly TradingWireCaveat[]
}
