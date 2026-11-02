import type { SectorStrength } from '@/trading/kernel/market/market-capability'
import type { FlowSnapshot } from '@/trading/kernel/market/market-data'
import type {
  BriefDirection,
  BriefSectionResult,
  BriefSectionRow,
} from '@/trading/kernel/operator/brief-section'
import type { VnBriefContext } from '@/trading/markets/equity-vn/brief/vn-context'
import type { NameEvidence } from '@/trading/markets/equity-vn/factors/factors'
import { toHeadlineSection } from '@/trading/markets/brief-headlines'
import { REGIME_SCALE_CAVEAT } from '@/trading/markets/brief-macro'
import { absent, omitted, ready } from '@/trading/markets/brief-sections'
import { latestNameSession, toSectorMember } from '@/trading/markets/equity-vn/factors/factors'
import {
  FLOW_DEVIATION_SESSIONS,
  VN_FX_PAIR,
  VN_MARKET_REGION,
  VN_SECTOR_POLICY,
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
import { sectorCoveragePct } from '@/trading/markets/sector-strength'
import { PERCENT_PER_UNIT } from '@/trading/sources/rows/normalization'

// The market-wide half of the brief: sections that describe the exchange rather than the user.
// Split from the user-scoped half purely for size — both families share the result constructors
// and the one loaded context, and neither owns a rule the other re-derives.

/** Every flow section sums the same declared window, so one title parameter states it for all four
 *  and no two of them can drift to different spans. */
const FLOW_WINDOW = Object.freeze({ sessions: FLOW_DEVIATION_SESSIONS })

/** Posture only, and only when the regime is defensive: percentages and the published rate, never
 *  an amount and never a bank. */
export async function buildDepositRate(context: VnBriefContext): Promise<BriefSectionResult> {
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
    // No book yet: the plan has nothing to reserve, and a title over two regime warnings reads as a
    // broken block rather than an empty one.
    return advice.reason === 'zero-nav'
      ? omitted('deposit-rate')
      : absent('deposit-rate', advice.caveats)
  }

  return ready(
    'deposit-rate',
    [
      {
        posture: advice.cashSegment.posture,
        cashAfterPlanPctNav: advice.cashSegment.cashPctNav,
        liquidReservePctNav: advice.cashSegment.liquidReservePctNav,
        termDepositEligiblePctNav: advice.cashSegment.termDepositEligiblePctNav,
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

export async function buildMacroHeadlines(context: VnBriefContext): Promise<BriefSectionResult> {
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
export function buildTape(context: VnBriefContext): Promise<BriefSectionResult> {
  const names = context.board?.names ?? []
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
export function buildBreadth(context: VnBriefContext): Promise<BriefSectionResult> {
  const names = context.board?.names ?? []
  const session = latestNameSession(names) ?? context.request.asOf
  const indexBars = context.board?.indexBars
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

export function buildSectorRotation(context: VnBriefContext): Promise<BriefSectionResult> {
  const coverage = sectorCoverage(context)

  if (context.sectors.length === 0 || coverage < VN_SECTOR_POLICY.minimumCoverage) {
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
export function buildForeignDeskFlow(context: VnBriefContext): Promise<BriefSectionResult> {
  const names = context.board?.names ?? []

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

export function buildProprietaryFlow(context: VnBriefContext): Promise<BriefSectionResult> {
  const names = context.board?.names ?? []

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
function foreignSectorRows(context: VnBriefContext): readonly BriefSectionRow[] {
  if (sectorCoverage(context) < VN_SECTOR_POLICY.minimumCoverage) {
    return []
  }

  return context.sectors.slice(0, MAXIMUM_NAMES_PER_LIST).map((row) => ({
    sector: row.sector,
    ...(row.foreignNetBase === undefined ? {} : { foreignNetBase: row.foreignNetBase }),
  }))
}

export async function buildFx(context: VnBriefContext): Promise<BriefSectionResult> {
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

/** The VN30 future against spot: a discount is the derivatives desk voting bearish. */
export async function buildBasis(context: VnBriefContext): Promise<BriefSectionResult> {
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

function sectorCoverage(context: VnBriefContext): number {
  return sectorCoveragePct((context.board?.names ?? []).map(toSectorMember))
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
