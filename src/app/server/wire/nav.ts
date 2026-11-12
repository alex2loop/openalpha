// Additive-only within v1. camelCase keys, no snake_case on the wire, no field renames.

import type { InstrumentRefWire } from '@/app/server/wire/trading'
import type { NavWindow } from '@/app/server/wire/vocab'

interface NavPointWire {
  readonly day: string
  readonly nav: number
  readonly index: number
}

export interface NavBenchmarkWire {
  readonly legs: readonly {
    readonly segment: string
    /** A share of 0 to 1, rounded across the legs to whole percents that still sum as the chat
     *  prints them. */
    readonly weight: number
    readonly instrument?: InstrumentRefWire
  }[]
  readonly points: readonly { readonly day: string; readonly index: number }[]
  readonly periodReturn: number
}

export interface TradingNavResponse {
  readonly window: NavWindow
  readonly baseCurrency: string
  readonly firstDay?: string
  readonly recordedCount: number
  readonly points: readonly NavPointWire[]
  readonly periodReturn?: number
  readonly maximumDrawdown?: number
  readonly currentDrawdown?: number
  readonly benchmark?: NavBenchmarkWire
  readonly benchmarkGap?: string
}
