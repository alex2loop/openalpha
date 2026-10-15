import type { Locale } from '@/core/types/locale'
import type { MessageKey } from '@/i18n'
import type { MarketRegime } from '@/trading/kernel/market/market-data'
import type {
  MacroMissingReason,
  MacroRiskDriver,
  MacroRiskView,
  MacroUnit,
  MissingMacroDriver,
} from '@/trading/kernel/market/market-macro'
import type { RenderContext } from '@/trading/render/format'
import { formatDay, t } from '@/i18n'
import { SCORE_LIMIT } from '@/trading/markets/factor-scoring'
import {
  FULL_DEPLOYMENT_SCALE,
  REGIME_SCALE,
  RISK_OFF_AT,
  RISK_ON_AT,
} from '@/trading/markets/macro-risk'
import { CHART_CELLS, LADDER_MARKS, renderLadder } from '@/trading/render/chart'
import { toFoldLines } from '@/trading/render/fold'
import {
  formatFixedAmount,
  formatFixedPercent,
  formatFraction,
  formatScoreValue,
  formatWholeFraction,
  renderDeclaredValue,
  SECTION_ICONS,
} from '@/trading/render/format'
import { INDENT, renderProvenanceLine } from '@/trading/render/layout'
import { apportion, SCORE_QUANTUM, WEIGHT_QUANTUM } from '@/trading/render/number'

/** The region and the regime it is in, which is what a reader wants before any of the arithmetic.
 *  `/overview` heads its macro block with it. */
export function renderMacroHeading(locale: Locale, view: MacroRiskView): string {
  return t(locale, 'trading.render.macro.title', {
    region: renderDeclaredValue(locale, `trading.region.${view.region}`),
    regime: renderDeclaredValue(locale, `trading.regime.${view.regime}`),
  })
}

interface MacroSectionsInput {
  readonly view: MacroRiskView
  readonly context: RenderContext
  /** False for a market no venue holds: its read sizes no buy, so the deployment line is left out. */
  readonly held: boolean
}

/** The composite and what produced it. The heading does not belong here: the surface decides how
 *  it heads the read. */
export function renderMacroSections(
  locale: Locale,
  input: MacroSectionsInput
): readonly (readonly string[])[] {
  const { view, context } = input

  return [
    [
      ...scoreLines(locale, view.score, context),
      ...renderLoweredLine(locale, view),
      ...(input.held ? deploymentLine(locale, view.regime) : []),
    ],
    toFoldLines(`${SECTION_ICONS.factors} ${t(locale, 'trading.render.macro.drivers')}`, [
      ...(context.charts
        ? [t(locale, 'trading.render.macro.ladderLegend', { at: LADDER_MARKS.at })]
        : []),
      ...roundedDrivers(view.drivers).flatMap((driver) => renderDriver(locale, driver, context)),
      ...view.missing.map((entry) => renderMissing(locale, entry)),
      t(locale, 'trading.render.macro.coverage', {
        coverage: formatWholeFraction(locale, view.coverage),
        version: view.formulaVersion,
      }),
      ...renderProvenanceLine(locale, view.provenance, context.timezone),
    ]),
  ]
}

/** The gauge says where the score sits better than the sentence spelling out the thresholds, so
 *  the sentence shortens wherever the gauge is drawn. */
function scoreLines(locale: Locale, score: number, context: RenderContext): readonly string[] {
  const gauge = renderLadder(
    {
      from: -SCORE_LIMIT,
      to: SCORE_LIMIT,
      at: score,
      fromLabel: t(locale, 'trading.render.macro.gaugeLow'),
      toLabel: t(locale, 'trading.render.macro.gaugeHigh'),
      ticks: [RISK_OFF_AT, RISK_ON_AT],
    },
    CHART_CELLS.line,
    context
  )
  const formatted = formatScoreValue(locale, score)

  if (gauge === undefined) {
    return [
      `${INDENT[1]}${t(locale, 'trading.render.macro.score', {
        score: formatted,
        riskOnAt: formatScoreValue(locale, RISK_ON_AT),
        riskOffAt: formatScoreValue(locale, RISK_OFF_AT),
      })}`,
    ]
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.render.macro.scoreGauge', {
      score: formatted,
      tick: LADDER_MARKS.tick,
    })}`,
    `${INDENT[1]}${gauge}`,
  ]
}

/** Weights and contributions rounded across the whole set rather than one row at a time: shares
 *  that each round on their own print a column summing to 99%, beside a score its own parts no
 *  longer add to. */
function roundedDrivers(drivers: readonly MacroRiskDriver[]): readonly MacroRiskDriver[] {
  const weights = apportion(
    drivers.map((driver) => driver.weight),
    WEIGHT_QUANTUM
  )
  const contributions = apportion(
    drivers.map((driver) => driver.contribution),
    SCORE_QUANTUM
  )

  return drivers.map((driver, index) => ({
    ...driver,
    weight: weights[index] ?? driver.weight,
    contribution: contributions[index] ?? driver.contribution,
  }))
}

/** The reading on its own line and its anchors under it: the row repeats once per series, and a
 *  value identified only by sitting after the date arrives on a phone under whatever the wrap left
 *  above it. Both lines label everything they carry. */
function renderDriver(
  locale: Locale,
  driver: MacroRiskDriver,
  context: RenderContext
): readonly string[] {
  const format = formatterFor(locale, driver.unit)

  return [
    `${INDENT[1]}${t(locale, 'trading.render.macro.driver', {
      series: renderDeclaredValue(locale, `trading.macro.series.${driver.id}`),
      observedAt: formatDay(locale, driver.asOf),
      value: format(driver.value),
    })}`,
    `${INDENT[2]}${driverDetail(locale, driver, context)}`,
  ]
}

/** The anchors as a ladder where one can be drawn: the bearish end on the left even where it is the
 *  larger number, which is the flip a reader would otherwise do in their head for a rate. */
function driverDetail(locale: Locale, driver: MacroRiskDriver, context: RenderContext): string {
  const format = formatterFor(locale, driver.unit)
  const shared = {
    weight: formatWholeFraction(locale, driver.weight),
    contribution: formatScoreValue(locale, driver.contribution),
  }
  const ladder = renderLadder(
    {
      from: driver.bearishAt,
      to: driver.bullishAt,
      at: driver.value,
      fromLabel: format(driver.bearishAt),
      toLabel: format(driver.bullishAt),
    },
    CHART_CELLS.fact,
    context
  )

  return ladder === undefined
    ? t(locale, 'trading.render.macro.driverDetail', {
        ...shared,
        bullishAt: format(driver.bullishAt),
        bearishAt: format(driver.bearishAt),
      })
    : t(locale, 'trading.render.macro.driverLadder', { ...shared, ladder })
}

/** One formatter per row, so a reading and the anchors that bound it can never print in different
 *  units. A level is fixed because the driver rows stack and `/brief` already prints these same
 *  two series fixed — one VIX reading rendered `17,1` here and `17,10` there. A percent is not:
 *  this formatter also prints that row's bullish and bearish anchors, which are round by
 *  construction, and `0,00%` claims a resolution the threshold does not have. */
function formatterFor(locale: Locale, unit: MacroUnit): (value: number) => string {
  return unit === 'level'
    ? (value) => formatFixedAmount(locale, value)
    : (value) => formatFixedPercent(locale, value)
}

/** The missing row answers a different question per reason: a holiday is not the same event as a
 *  failed fetch, and a series that published yesterday reads differently from one that never has. */
function renderMissing(locale: Locale, entry: MissingMacroDriver): string {
  const series = renderDeclaredValue(locale, `trading.macro.series.${entry.id}`)

  if (entry.reason === 'observation-only' && entry.lastObservationAt !== undefined) {
    return t(locale, 'trading.render.macro.driverMissingLastObservation', {
      series,
      observedAt: formatDay(locale, entry.lastObservationAt),
    })
  }

  return t(locale, missingKey(entry.reason), { series })
}

function missingKey(reason: MacroMissingReason): MessageKey {
  return reason === 'fetch-error'
    ? 'trading.render.macro.driverMissingFetchError'
    : 'trading.render.macro.driverMissingNoObservation'
}

function renderLoweredLine(locale: Locale, view: MacroRiskView): readonly string[] {
  if (view.regime === view.scoreRegime) {
    return []
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.render.macro.lowered', {
      scoreRegime: renderDeclaredValue(locale, `trading.regime.${view.scoreRegime}`),
    })}`,
  ]
}

/** Absent where macro caps nothing: at full deployment the sentence names a remainder that does
 *  not exist. */
function deploymentLine(locale: Locale, regime: MarketRegime): readonly string[] {
  const scale = REGIME_SCALE[regime]

  if (scale >= FULL_DEPLOYMENT_SCALE) {
    return []
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.render.macro.deployment', {
      deployment: formatFraction(locale, scale),
    })}`,
  ]
}
