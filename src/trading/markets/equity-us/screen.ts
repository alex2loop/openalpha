import type { BarRecord, InstrumentRecord } from '@/trading/kernel/market/market-data'
import type { ScreenGateCode } from '@/trading/kernel/screen-codes'
import type { ScreenGateVerdict } from '@/trading/markets/screen-partition'
import {
  US_LIQUIDITY_SESSIONS,
  US_MAXIMUM_VOLATILITY,
  US_MINIMUM_HISTORY_SESSIONS,
  US_MINIMUM_TRADED_VALUE_USD,
  US_VOLATILITY_SESSIONS,
} from '@/trading/markets/equity-us/policy'
import { realizedVolatility } from '@/trading/markets/timeseries'
import { medianTurnover } from '@/trading/markets/turnover'

/** What a gate reads: the name's record, its settled series and whether the board holds it. */
interface UsScreenInput {
  readonly record: InstrumentRecord
  readonly bars: readonly BarRecord[]
  readonly onBoard: boolean
}

interface ScreenGate {
  readonly code: ScreenGateCode
  /** True when the name clears it. */
  readonly test: (input: UsScreenInput) => boolean
}

/** Cheapest and most fundamental first, so the recorded rejection is the most informative one. A
 *  reading that could not be measured clears its gate: absent is not a failure. */
const US_SCREEN_GATES: readonly ScreenGate[] = Object.freeze([
  { code: 'no-price-history', test: (input) => usAdjustedCloses(input.bars).length > 0 },
  {
    code: 'insufficient-history',
    test: (input) => usAdjustedCloses(input.bars).length >= US_MINIMUM_HISTORY_SESSIONS,
  },
  { code: 'below-minimum-turnover', test: hasMinimumTurnover },
  { code: 'below-minimum-market-cap', test: isBoardMember },
  { code: 'volatility-above-maximum', test: isWithinVolatility },
])

export function usAdjustedCloses(bars: readonly BarRecord[]): readonly number[] {
  return bars
    .filter((bar) => bar.candle.adjustment === 'adjusted' && bar.candle.close > 0)
    .map((bar) => bar.candle.close)
}

export function screenUsCandidate(input: UsScreenInput): ScreenGateVerdict {
  const failed = usFailedGates(input)[0]

  return failed === undefined ? { kind: 'accepted' } : { kind: 'rejected', code: failed }
}

export function usFailedGates(input: UsScreenInput): readonly ScreenGateCode[] {
  return US_SCREEN_GATES.filter((gate) => !gate.test(input)).map((gate) => gate.code)
}

function hasMinimumTurnover(input: UsScreenInput): boolean {
  const traded = medianTurnover(input.bars, US_LIQUIDITY_SESSIONS)

  return traded === undefined || traded >= US_MINIMUM_TRADED_VALUE_USD
}

/** A fund has no capitalization to rank; an equity is on the board because its capitalization
 *  ranked, so being off it is being small. */
function isBoardMember(input: UsScreenInput): boolean {
  return input.record.kind !== 'equity' || input.onBoard
}

function isWithinVolatility(input: UsScreenInput): boolean {
  const volatility = realizedVolatility(usAdjustedCloses(input.bars), US_VOLATILITY_SESSIONS)

  return volatility === undefined || volatility <= US_MAXIMUM_VOLATILITY
}
