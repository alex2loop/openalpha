import type { MacroSeriesId } from '@/trading/kernel/market/macro-series'
import type { SectorStrength } from '@/trading/kernel/market/market-capability'
import type { FlowSnapshot } from '@/trading/kernel/market/market-data'
import type { MacroRiskDriver } from '@/trading/kernel/market/market-macro'
import type {
  BriefDirection,
  BriefSectionResult,
  BriefSectionRow,
} from '@/trading/kernel/operator/brief-section'
import type { BriefContext } from '@/trading/markets/equity-vn/brief/context'
import type { NameEvidence } from '@/trading/markets/equity-vn/factors/factors'
import { MACRO_SERIES_FIELDS } from '@/trading/kernel/market/macro-series'
import { dedupeProvenance } from '@/trading/kernel/source/source-result'
import {
  absent,
  omitted,
  ready,
  toHeadlineSection,
} from '@/trading/markets/equity-vn/brief/sections'
import { latestNameSession, toSectorMember } from '@/trading/markets/equity-vn/factors/factors'
import { sectorCoveragePct } from '@/trading/markets/equity-vn/factors/sectors'
import {
  FLOW_DEVIATION_SESSIONS,
  MINIMUM_SECTOR_COVERAGE_FRACTION,
  VN_FX_PAIR,
  VN_MARKET_REGION,
} from '@/trading/markets/equity-vn/policy'
import { staleIndexCaveats, toBreadth } from '@/trading/markets/equity-vn/tape/breadth'
import { netFlowValue, proprietaryFlowValue } from '@/trading/markets/equity-vn/tape/flows'
import { groupByBoard, toBoards } from '@/trading/markets/equity-vn/tape/overview'
import {
  sessionTurnoverTotal,
  toTurnoverRatio,
  toTurnoverReference,
} from '@/trading/markets/equity-vn/tape/session-totals'
import { NEWS_ITEMS_PER_SECTION } from '@/trading/markets/news'
import { boardRows, breadthRows, MAXIMUM_NAMES_PER_LIST } from '@/trading/markets/overview-rollups'
import { apportion, SCORE_QUANTUM } from '@/trading/render/number'
import { quoteBoardMoveOf } from '@/trading/render/price-pair'

// The market-wide half of the brief: sections that describe the exchange rather than the user.
// Split from the user-scoped half purely for size — both families share the result constructors
// and the one loaded context, and neither owns a rule the other re-derives.

const PERCENT_PER_UNIT = 100
/** What `/rebalance` tells an operator who has not read a macro block. The brief prints one two
 *  sections above, so carrying this too would state one fact three times over. */
const REGIME_SCALE_CAVEAT = 'portfolio.regime-risk'
/** Every flow section sums the same declared window, so one title parameter states it for all four
 *  and no two of them can drift to different spans. */
const FLOW_WINDOW = Object.freeze({ sessions: FLOW_DEVIATION_SESSIONS })

export function buildRegimeShift(context: BriefContext): Promise<BriefSectionResult> {
  const { macro, previousMacro } = context

  if (macro === null) {
    return Promise.resolve(absent('regime-shift', [{ code: 'macro.inputs-missing' }]))
  }

  if (previousMacro === null || previousMacro.view.regime === macro.view.regime) {
    return Promise.resolve(omitted('regime-shift'))
  }

  return Promise.resolve(
    ready(
      'regime-shift',
      [{ previousRegime: previousMacro.view.regime, currentRegime: macro.view.regime }],
      {
        asOf: macro.view.asOf,
        caveats: macro.view.caveats,
        provenance: dedupeProvenance([...macro.provenance, ...previousMacro.provenance]),
      }
    )
  )
}

/** Contributions rounded across the set rather than one row at a time, so the column adds up to the
 *  composite printed above it. */
function driverRows(drivers: readonly MacroRiskDriver[]): readonly BriefSectionRow[] {
  const contributions = apportion(
    drivers.map((driver) => driver.contribution),
    SCORE_QUANTUM
  )

  return drivers.map((driver, index) => ({
    driver: driver.id,
    at: driver.asOf,
    ...toDriverValue(driver.id, driver.value),
    contribution: contributions[index] ?? driver.contribution,
  }))
}

/** Each driver states the day it was observed: the block's `asOf` is the session the composite was
 *  struck for, and a Treasury yield lags it by a day while a CPI print lags it by a month. The
 *  drivers that did not vote are named beside the coverage they cost, because a composite
 *  renormalized over the rest reads exactly like a whole one otherwise. The deployment figure is
 *  the whole book's, blended across funded sleeves, so the per-sleeve regimes that produced it
 *  travel with it — one sleeve's regime cannot explain a number the other sleeves also moved. */
export async function buildMacro(context: BriefContext): Promise<BriefSectionResult> {
  const { macro } = context

  if (macro === null) {
    return absent('macro', [{ code: 'macro.inputs-missing' }])
  }

  const advice = await context.rebalance()
  const deployment = advice.kind === 'ready' ? advice.policy.deploymentScale : undefined

  return ready(
    'macro',
    [
      { regime: macro.view.regime },
      { compositeScore: macro.view.score },
      ...driverRows(macro.view.drivers),
      ...macro.view.missing.map((entry) => ({ driverMissing: entry.id })),
      { coverage: macro.view.coverage, formulaVersion: macro.view.formulaVersion },
      ...(deployment === undefined ? [] : [{ deploymentScale: deployment }]),
    ],
    {
      asOf: macro.view.asOf,
      caveats: [
        ...macro.view.caveats,
        ...advice.caveats.filter((caveat) => caveat.code === REGIME_SCALE_CAVEAT),
      ],
      provenance: macro.provenance,
    }
  )
}

/** Percent-unit series render as fractions like every other rate in the brief; the rest keep
 *  their native scale. */
function toDriverValue(id: MacroSeriesId, value: number): BriefSectionRow {
  const field = MACRO_SERIES_FIELDS[id]

  return field === 'valuePct' ? { valuePct: value / PERCENT_PER_UNIT } : { [field]: value }
}

/** Posture only, and only when the regime is defensive: percentages and the published rate, never
 *  an amount and never a bank. */
export async function buildDepositRate(context: BriefContext): Promise<BriefSectionResult> {
  if (context.macro === null || context.macro.view.regime === 'risk-on') {
    return omitted('deposit-rate')
  }

  const [snapshot, advice] = await Promise.all([
    context.deps.marketDataStore.findLatestMacroRisk({
      region: VN_MARKET_REGION,
      formulaVersion: context.macro.view.formulaVersion,
      signal: context.request.signal,
    }),
    context.rebalance(),
  ])
  const rate = snapshot?.values['deposit-rate-12m']

  if (advice.kind === 'unavailable') {
    return absent('deposit-rate', advice.caveats)
  }

  return ready(
    'deposit-rate',
    [
      {
        posture: advice.cashSleeve.posture,
        cashAfterPlanPctNav: advice.cashSleeve.cashPctNav,
        liquidReservePctNav: advice.cashSleeve.liquidReservePctNav,
        termDepositEligiblePctNav: advice.cashSleeve.termDepositEligiblePctNav,
        // Macro series carry percent units; the rest of this payload is fractions, and so is the
        // renderer that prints them.
        ...(rate === undefined ? {} : { depositRate12m: rate / PERCENT_PER_UNIT }),
      },
    ],
    {
      asOf: context.macro.view.asOf,
      caveats: [
        ...advice.caveats.filter((caveat) => caveat.code !== REGIME_SCALE_CAVEAT),
        ...(rate === undefined ? [{ code: 'macro.inputs-missing' as const }] : []),
      ],
    }
  )
}

export async function buildMacroHeadlines(context: BriefContext): Promise<BriefSectionResult> {
  const result = await context.services.macroNews({
    now: context.request.now,
    limit: NEWS_ITEMS_PER_SECTION,
    signal: context.request.signal,
  })

  return toHeadlineSection('macro-headlines', result)
}

/** What the session traded, and how that compares with a normal one. Not the index level or its
 *  move: the price block above states both, and the regime line at the top of the brief states the
 *  regime — repeating either here prints one fact three times. */
export function buildTape(context: BriefContext): Promise<BriefSectionResult> {
  const names = context.cross?.names ?? []
  const session = latestNameSession(names) ?? context.request.asOf
  const turnover = sessionTurnoverTotal(names, session)

  if (turnover === undefined) {
    return Promise.resolve(absent('tape', [{ code: 'market-data.no-coverage' }]))
  }

  const reference = toTurnoverReference(names, session)
  const turnoverRatio = toTurnoverRatio(turnover, reference)

  return Promise.resolve(
    ready('tape', [
      {
        turnover,
        ...(turnoverRatio === undefined || reference === undefined
          ? {}
          : { turnoverRatio, sessions: reference.sessions }),
      },
    ])
  )
}

/** The same rows `/overview` renders from a market's own read, so one session's breadth reads
 *  identically wherever the operator meets it. */
export function buildBreadth(context: BriefContext): Promise<BriefSectionResult> {
  const names = context.cross?.names ?? []
  const session = latestNameSession(names) ?? context.request.asOf
  const indexBars = context.cross?.indexBars
  const breadth = toBreadth(names, session, indexBars)

  if (breadth === undefined) {
    return Promise.resolve(absent('breadth', [{ code: 'market-data.no-coverage' }]))
  }

  return Promise.resolve(
    ready(
      'breadth',
      [...breadthRows(breadth), ...boardRows(toBoards(groupByBoard(names), session))],
      { caveats: staleIndexCaveats(indexBars, session) }
    )
  )
}

export function buildSectorRotation(context: BriefContext): Promise<BriefSectionResult> {
  const coverage = sectorCoverage(context)

  if (context.sectors.length === 0 || coverage < MINIMUM_SECTOR_COVERAGE_FRACTION) {
    return Promise.resolve(
      absent('sector-rotation', [{ code: 'market-data.no-coverage', detail: { coverage } }])
    )
  }

  const ranked = context.sectors.filter(hasLeadership)

  // Leadership is measured against the market's index; without it the sectors still roll up, but
  // nothing here can say which of them led.
  if (ranked.length === 0) {
    return Promise.resolve(
      absent('sector-rotation', [{ code: 'market-data.benchmark-unavailable' }])
    )
  }

  const over = ranked.slice(0, MAXIMUM_NAMES_PER_LIST)
  // Starts after the leaders: a short board must not list one sector as both.
  const under = ranked.slice(over.length).slice(-MAXIMUM_NAMES_PER_LIST).reverse()

  return Promise.resolve(
    ready('sector-rotation', [
      ...over.map((row) => toRotationRow('over', row)),
      ...under.map((row) => toRotationRow('under', row)),
    ])
  )
}

function toRotationRow(
  direction: BriefDirection,
  row: SectorStrength & { readonly score: number }
): { readonly direction: BriefDirection; readonly sector: string; readonly strength: number } {
  return { direction, sector: row.sector, strength: row.score }
}

function hasLeadership(row: SectorStrength): row is SectorStrength & { readonly score: number } {
  return row.score !== undefined
}

/** One section, three readings of the same window: what the desks did in total, which names they
 *  did it in, and which sectors those names sat in. Three headings said "20 sessions" three times
 *  over one story. */
export function buildForeignDeskFlow(context: BriefContext): Promise<BriefSectionResult> {
  const names = context.cross?.names ?? []

  if (names.length === 0) {
    return Promise.resolve(absent('foreign-desk-flow', [{ code: 'market-data.no-coverage' }]))
  }

  const rows = [
    ...totalRow(names, 'foreign-desk-flow'),
    ...foreignNameRows(names),
    ...foreignSectorRows(context),
  ]

  return Promise.resolve(
    rows.length === 0
      ? omitted('foreign-desk-flow')
      : ready('foreign-desk-flow', rows, { titleParams: FLOW_WINDOW })
  )
}

export function buildProprietaryFlow(context: BriefContext): Promise<BriefSectionResult> {
  const names = context.cross?.names ?? []

  if (names.length === 0) {
    return Promise.resolve(absent('proprietary-flow', [{ code: 'market-data.no-coverage' }]))
  }

  const rows = totalRow(names, 'proprietary-flow')

  return Promise.resolve(
    rows.length === 0
      ? omitted('proprietary-flow')
      : ready('proprietary-flow', rows, { titleParams: FLOW_WINDOW })
  )
}

/** Top net buys and net sells by magnitude; a name with no flow at all is not news. */
function foreignNameRows(names: readonly NameEvidence[]): readonly BriefSectionRow[] {
  const flows = names
    .map((name) => ({
      ticker: name.record.instrument.ticker,
      net: netFlowValue(name.flows, FLOW_DEVIATION_SESSIONS),
    }))
    .filter((row) => row.net !== 0)
  const sorted = [...flows].sort((left, right) => right.net - left.net)

  return [
    ...sorted
      .slice(0, MAXIMUM_NAMES_PER_LIST)
      .filter((row) => row.net > 0)
      .map((row) => ({ direction: 'buy' satisfies BriefDirection, ...row })),
    ...sorted
      .slice(-MAXIMUM_NAMES_PER_LIST)
      .reverse()
      .filter((row) => row.net < 0)
      .map((row) => ({ direction: 'sell' satisfies BriefDirection, ...row })),
  ]
}

/** The same names grouped by sector. Absent below the coverage floor rather than reported thin:
 *  `sector-rotation` already says the mapping is too sparse to read. */
function foreignSectorRows(context: BriefContext): readonly BriefSectionRow[] {
  if (sectorCoverage(context) < MINIMUM_SECTOR_COVERAGE_FRACTION) {
    return []
  }

  return context.sectors
    .slice(0, MAXIMUM_NAMES_PER_LIST)
    .map((row) => ({ sector: row.sector, foreignNetBase: row.foreignNetBase }))
}

export async function buildFx(context: BriefContext): Promise<BriefSectionResult> {
  const result = await context.deps.fx.convert({
    ...VN_FX_PAIR,
    asOf: context.request.asOf,
    signal: context.request.signal,
  })

  if (result.kind === 'unavailable') {
    return absent('fx', result.caveats)
  }

  const { fromCurrency, toCurrency, rate } = result.value

  return ready('fx', [{ ticker: `${fromCurrency}/${toCurrency}`, rate }], {
    caveats: result.caveats,
    provenance: result.provenance,
  })
}

/** One instrument failing omits its row, not the section; every instrument failing is the only case
 *  that makes the section unavailable. With nothing watchlisted the section is omitted: every market
 *  now carries its own block, so a brief is never silent about gold or crypto. */
export async function buildCrossAssetPulse(context: BriefContext): Promise<BriefSectionResult> {
  const { names, caveats: capped } = context.crossAssetNames

  if (names.length === 0) {
    return omitted('cross-asset-pulse')
  }

  const quoteBoard = await context.services.quoteBoard({
    instruments: names,
    signal: context.request.signal,
  })
  const caveats = [...capped, ...quoteBoard.caveats]

  return quoteBoard.items.length === 0
    ? absent('cross-asset-pulse', caveats)
    : ready(
        'cross-asset-pulse',
        // The one section whose rows come from different markets, so each carries the market it
        // belongs to and the currency its price is in - USD/oz, VND/lượng and USD/coin otherwise
        // read as one column of comparable numbers.
        quoteBoard.items.map((item) => {
          const changePct = quoteBoardMoveOf(item)

          return {
            ticker: item.ticker,
            market: item.market,
            last: item.last,
            currency: item.currency,
            ...(changePct === undefined ? {} : { changePct }),
          }
        }),
        { caveats }
      )
}

/** The VN30 future against spot: a discount is the derivatives desk voting bearish. */
export async function buildBasis(context: BriefContext): Promise<BriefSectionResult> {
  const { asOf, now, signal } = context.request
  const result = await context.services.basis({ fromDay: asOf, toDay: asOf, now, signal })

  if (result.kind === 'unavailable') {
    return absent('basis', result.caveats)
  }

  const basis = result.value

  return ready(
    'basis',
    [
      {
        ticker: basis.contractCode,
        level: basis.future,
        basisPct: basis.basisPct,
        // The pair's newest common session, stated only when the block's own day is not it: the
        // spot leg settles a session behind through every evening, and an undated row reads as
        // today's basis. On the row rather than the section, because a section's own `asOf` stamps
        // the whole block.
        ...(basis.asOf === asOf ? {} : { closedOn: basis.asOf }),
      },
    ],
    { caveats: result.caveats, provenance: result.provenance }
  )
}

function sectorCoverage(context: BriefContext): number {
  return sectorCoveragePct((context.cross?.names ?? []).map(toSectorMember))
}

const DESK_FLOWS = Object.freeze({
  'foreign-desk-flow': (flows: readonly FlowSnapshot[]) =>
    netFlowValue(flows, FLOW_DEVIATION_SESSIONS),
  'proprietary-flow': (flows: readonly FlowSnapshot[]) =>
    proprietaryFlowValue(flows, FLOW_DEVIATION_SESSIONS),
})

type DeskFlowKind = keyof typeof DESK_FLOWS

/** Empty where no name reported to this desk: a desk that filed nothing did not trade nothing. */
function totalRow(names: readonly NameEvidence[], kind: DeskFlowKind): readonly BriefSectionRow[] {
  const desk = DESK_FLOWS[kind]
  const reported = names.map((name) => desk(name.flows)).filter((value) => value !== null)

  return reported.length === 0 ? [] : [{ net: reported.reduce((sum, value) => sum + value, 0) }]
}
