import type { NavBenchmarkWire, TradingNavResponse } from '@/app/server/wire/nav'
import type { NavBenchmark, NavHistory } from '@/trading/api'
import { toInstrumentWire } from '@/app/server/mappers/trading'
import { apportionedBenchmarkLegs } from '@/trading/api'

function toNavBenchmarkWire(benchmark: NavBenchmark): NavBenchmarkWire {
  return {
    legs: apportionedBenchmarkLegs(benchmark).map((leg) => ({
      segment: leg.segment,
      weight: leg.weight,
      ...(leg.instrument === undefined ? {} : { instrument: toInstrumentWire(leg.instrument) }),
    })),
    points: benchmark.points.map((point) => ({ day: point.day, index: point.index })),
    periodReturn: benchmark.periodReturn,
  }
}

/** Absent figures stay absent: a history too thin to measure sends no return and no drawdown at
 *  all rather than a zero a client would draw as a flat line. */
export function toNavWire(history: NavHistory): TradingNavResponse {
  return {
    window: history.window,
    baseCurrency: history.baseCurrency,
    ...(history.firstDay === undefined ? {} : { firstDay: history.firstDay }),
    recordedCount: history.recordedCount,
    points: history.points.map((point) => ({
      day: point.day,
      nav: point.navBase,
      index: point.index,
    })),
    ...(history.periodReturn === undefined ? {} : { periodReturn: history.periodReturn }),
    ...(history.maximumDrawdown === undefined ? {} : { maximumDrawdown: history.maximumDrawdown }),
    ...(history.currentDrawdown === undefined ? {} : { currentDrawdown: history.currentDrawdown }),
    ...(history.benchmark === undefined
      ? {}
      : { benchmark: toNavBenchmarkWire(history.benchmark) }),
    ...(history.benchmarkGap === undefined ? {} : { benchmarkGap: history.benchmarkGap }),
  }
}
