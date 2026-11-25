import type { MacroResponse } from '@/app/server/wire/market'
import type { Locale } from '@/core/types/locale'
import type { MacroRiskView, TradingMacroView } from '@/trading/api'
import { toCaveatWires } from '@/app/server/mappers/trading'
import { MACRO_SCORE_RANGE, roundedDrivers } from '@/trading/api'

export function toMacroWire(view: TradingMacroView, locale: Locale): MacroResponse {
  const { result } = view

  if (result.kind === 'unavailable') {
    return {
      region: view.region,
      status: 'unavailable',
      caveats: toCaveatWires(result.caveats, locale),
    }
  }

  const macro = result.value
  const readingsOnly = view.readingsOnly === true

  return {
    region: view.region,
    status: 'ready',
    asOf: macro.asOf,
    ...(macro.provenance.length === 0
      ? {}
      : { readAt: Math.max(...macro.provenance.map((read) => read.fetchedAt)) }),
    ...(readingsOnly ? {} : toMacroVerdictWire(macro)),
    ...(view.lean === undefined ? {} : { lean: view.lean }),
    coverage: macro.coverage,
    readings: macro.readings,
    drivers: readingsOnly
      ? macro.drivers.map((driver) => toMacroReadingWire(driver, view.labels))
      : roundedDrivers(macro.drivers).map((driver) => toMacroDriverWire(driver, view.labels)),
    missing: macro.missing.map((driver) => ({
      id: driver.id,
      label: view.labels[driver.id] ?? driver.id,
      reason: driver.reason,
    })),
    caveats: toCaveatWires([...macro.caveats, ...result.caveats], locale),
  }
}

function toMacroVerdictWire(macro: MacroRiskView) {
  return {
    regime: macro.regime,
    scoreRegime: macro.scoreRegime,
    score: macro.score,
    scoreRange: { ...MACRO_SCORE_RANGE },
  }
}

function toMacroDriverWire(
  driver: MacroRiskView['drivers'][number],
  labels: TradingMacroView['labels']
) {
  return {
    ...toMacroReadingWire(driver, labels),
    weight: driver.weight,
    bearishAt: driver.bearishAt,
    bullishAt: driver.bullishAt,
    contribution: driver.contribution,
  }
}

function toMacroReadingWire(
  driver: MacroRiskView['drivers'][number],
  labels: TradingMacroView['labels']
) {
  return {
    id: driver.id,
    label: labels[driver.id] ?? driver.id,
    unit: driver.unit,
    value: driver.value,
    asOf: driver.asOf,
  }
}
