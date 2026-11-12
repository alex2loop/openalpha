import type { Locale } from '@/core/types/locale'
import type { AnalysisRecord } from '@/trading/features/suggestion/analysis/types'
import type { ArguingRole } from '@/trading/features/suggestion/debate/claims'
import type { AnalysisCase } from '@/trading/features/suggestion/debate/types'
import type { FactorMetricId, FactorMetricUnit } from '@/trading/kernel/factor-metric'
import type { MacroUnit } from '@/trading/kernel/market/market-macro'
import { formatDay, type MessageKey, renderAiLabel, t } from '@/i18n'
import { isClaimBy, isUnsupportedRole } from '@/trading/features/suggestion/debate/claims'
import { claimIdsWithVerdict } from '@/trading/features/suggestion/debate/types'
import { stripStance } from '@/trading/features/suggestion/render/debate'
import { renderCitationLines } from '@/trading/features/suggestion/render/sections'
import { renderCaveatLines } from '@/trading/render/caveat'
import { describeEvent } from '@/trading/render/event'
import {
  formatCount,
  formatSignedFixedPercent,
  renderDeclaredValue,
  renderProvidedValue,
  SECTION_ICONS,
} from '@/trading/render/format'
import { INDENT, INLINE_SEPARATOR, joinSections, renderSectionTitle } from '@/trading/render/layout'
import { formatUnitValue, metricFacts, renderMetricLine } from '@/trading/render/metric'
import { formatPriceIn, renderBoardScaleNotes } from '@/trading/render/money'

type AnalysisSide = Extract<ArguingRole, 'bull-researcher' | 'bear-researcher'>

/** Per side, the catalog words for the case, for what would make it wrong, and for its stance. */
const SIDES = {
  'bull-researcher': {
    case: 'trading.analysis.case-bull',
    wrong: 'trading.analysis.wrong-bull',
    stance: 'trading.debate.stance.bullish',
  },
  'bear-researcher': {
    case: 'trading.analysis.case-bear',
    wrong: 'trading.analysis.wrong-bear',
    stance: 'trading.debate.stance.bearish',
  },
} as const satisfies Record<AnalysisSide, unknown>

const SIDE_ORDER = Object.freeze(['bull-researcher', 'bear-researcher'] as const)

const PERCENT_PER_UNIT = 100

type MetricGroup =
  | 'valuation'
  | 'growth'
  | 'quality'
  | 'price'
  | 'flows'
  | 'positioning'
  | 'premium'

/** The groups with no metric of their own: the sector's medians, the name's dated events and the
 *  market's backdrop are read off their own fields. */
type FigureGroup = MetricGroup | 'sector' | 'events' | 'market'

/** The figure groups in the order they print: the name's own accounts, then the sector it sits in,
 *  how it trades, what its market adds, what is coming and where the market stands. */
const FIGURE_GROUP_TITLES = {
  valuation: 'trading.analysis.figures-valuation',
  growth: 'trading.analysis.figures-growth',
  quality: 'trading.analysis.figures-quality',
  sector: 'trading.analysis.figures-sector',
  price: 'trading.analysis.figures-price',
  flows: 'trading.analysis.figures-flows',
  positioning: 'trading.analysis.figures-positioning',
  premium: 'trading.analysis.figures-premium',
  events: 'trading.analysis.figures-events',
  market: 'trading.analysis.figures-market',
} as const satisfies Record<FigureGroup, MessageKey>

const FIGURE_GROUPS = Object.freeze(Object.keys(FIGURE_GROUP_TITLES) as FigureGroup[])

/** A macro series' unit as the unit its value is printed in: a rate is already a percent, and an
 *  index is a level against its own base. */
const MACRO_METRIC_UNITS = Object.freeze({
  percent: 'percent',
  level: 'ratio',
} as const satisfies Record<MacroUnit, FactorMetricUnit>)

/** Where each reading is listed. One with no group is no figure: a trigger or a stop reference,
 *  which the reader is never shown as a level, and the count of peers a rank was taken among, a
 *  ranking word and no reading of the name. */
const FIGURE_GROUP_OF = Object.freeze({
  pe: 'valuation',
  'average-profit-pe': 'valuation',
  pb: 'valuation',
  'value-percentile': 'valuation',
  'earnings-growth': 'growth',
  'revenue-growth': 'growth',
  'return-on-equity': 'quality',
  'return-on-assets': 'quality',
  'debt-to-equity': 'quality',
  'gross-margin': 'quality',
  'quality-percentile': 'quality',
  'accounts-score': 'quality',
  'return-on-invested-capital': 'quality',
  'interest-cover': 'quality',
  'net-debt-to-ebitda': 'quality',
  'bad-debt-ratio': 'quality',
  'watch-list-ratio': 'quality',
  'provision-cover': 'quality',
  'casa-share': 'quality',
  'cost-to-income': 'quality',
  'capital-adequacy': 'quality',
  'net-interest-to-assets': 'quality',
  'trend-average': 'price',
  'year-high': 'price',
  'distance-from-high': 'price',
  'distance-from-low': 'price',
  'average-range': 'price',
  'relative-return': 'price',
  'median-turnover': 'flows',
  'relative-volume': 'flows',
  'foreign-net-flow': 'flows',
  'foreign-room-left': 'flows',
  'proprietary-net-flow': 'flows',
  'volume-to-market-cap': 'flows',
  'market-cap': 'flows',
  'volume-24h': 'flows',
  'price-change': 'price',
  'daily-volatility': 'price',
  'funding-daily': 'positioning',
  'open-interest-change': 'positioning',
  'long-short-ratio': 'positioning',
  'world-gold-premium': 'premium',
  'ranked-peers': undefined,
  'sector-pe': undefined,
  'breakout-trigger': undefined,
  'trailing-low': undefined,
} as const satisfies Readonly<Record<FactorMetricId, MetricGroup | undefined>>)

interface AnalysisTextOptions {
  /** The name's price now, in the same units as the close the run stood on, for a view that has
   *  read one. */
  readonly last?: number
  /** The page lays out the conditions and says what the web edition does not do itself, so the text
   *  leaves out both. */
  readonly pageFrames?: true
}

/** The analysis under the AI label, for a view with no chat around it: the Analyses list, stored text. */
export function renderAnalysisText(
  locale: Locale,
  record: AnalysisRecord,
  options: AnalysisTextOptions = {}
): string {
  return joinSections([[renderAiLabel(locale)], [renderAnalysisBody(locale, record, options)]])
}

/** Both sides, what would make each wrong, what the evidence refuted and the figures, in the
 *  reader's language, with no verdict (none was produced) and no AI label: a chat shows its own.
 *  The conditions follow the two cases, ahead of the evidence audit, so the reader meets what to
 *  watch for before the detail; the web card lists the same conditions first. */
export function renderAnalysisBody(
  locale: Locale,
  record: AnalysisRecord,
  options: AnalysisTextOptions = {}
): string {
  const { result } = record
  const cases = { 'bull-researcher': result.bull, 'bear-researcher': result.bear }
  const isFramed = options.pageFrames === true

  return joinSections([
    renderPriceLines(locale, record, options.last),
    ...SIDE_ORDER.map((side) =>
      renderCaseLines(locale, { side, record, analysisCase: cases[side] })
    ),
    ...(isFramed ? [] : SIDE_ORDER.map((side) => renderWrongLines(locale, side, cases[side]))),
    renderRefutedLines(locale, record),
    renderFigureLines(locale, record),
    renderCitationLines(locale, {
      citations: [...record.citations, ...record.headlines],
      title: t(locale, 'trading.analysis.sources'),
      detail: 'compact',
    }),
    renderCaveatLines(locale, record.caveats),
    closingLines(locale, record, options),
  ])
}

/** The price the run stood on and, where a quote was read, the price now and how far it moved
 *  since: a plain price change, not a call. A row stored before the close was kept states neither. */
function renderPriceLines(
  locale: Locale,
  record: AnalysisRecord,
  last: number | undefined
): readonly string[] {
  const { evidenceClose: close, boardScale, currency, quoteUnit } = record

  if (close === undefined || !(close > 0)) {
    return []
  }

  const quote = {
    ...(currency === undefined ? {} : { currency }),
    ...(quoteUnit === undefined ? {} : { unit: quoteUnit }),
    ...(boardScale === undefined ? {} : { display: boardScale.display }),
  }
  const parts = [
    t(locale, 'trading.analysis.price-run', { price: formatPriceIn(locale, close, quote) }),
  ]

  if (last !== undefined && Number.isFinite(last)) {
    parts.push(
      t(locale, 'trading.analysis.price-now', {
        price: formatPriceIn(locale, last, quote),
        change: formatSignedFixedPercent(locale, (last / close - 1) * PERCENT_PER_UNIT),
      })
    )
  }

  return [parts.join(INLINE_SEPARATOR), ...renderScaleNotes(locale, record)]
}

interface CaseView {
  readonly side: AnalysisSide
  readonly record: AnalysisRecord
  readonly analysisCase: AnalysisCase
}

/** A case whose every claim the evidence refuted is not repeated: its prose argued something the
 *  evidence contradicts, the same rule the debate's own role output follows. */
function renderCaseLines(locale: Locale, view: CaseView): readonly string[] {
  const { side, record } = view
  const { claims } = record.result
  const body = isUnsupportedRole(side, claims, refutedIdsOf(record))
    ? t(locale, 'trading.analysis.case-unsupported')
    : stripStance(view.analysisCase.summary)

  return [
    renderSectionTitle(
      SECTION_ICONS.debate,
      t(locale, SIDES[side].case, { ticker: record.instrument.ticker })
    ),
    `${INDENT[1]}${body}`,
  ]
}

function renderRefutedLines(locale: Locale, record: AnalysisRecord): readonly string[] {
  const { claims, verification } = record.result
  const refuted = refutedIdsOf(record)
  const rows = SIDE_ORDER.flatMap((side) =>
    claims
      .filter((claim) => refuted.has(claim.id) && isClaimBy(side, claim))
      .map((claim) =>
        t(locale, 'trading.analysis.refuted-claim', {
          side: renderDeclaredValue(locale, SIDES[side].stance),
          claim: stripStance(claim.text),
        })
      )
  )
  const supported = new Set(claimIdsWithVerdict(verification, 'supported'))
  const unchecked = claims.filter(
    (claim) => !(supported.has(claim.id) || refuted.has(claim.id))
  ).length

  return [
    renderSectionTitle(
      SECTION_ICONS.unverified,
      t(locale, 'trading.render.suggestion.unsupportedClaims')
    ),
    ...(rows.length === 0
      ? [`${INDENT[1]}${t(locale, 'trading.analysis.none-refuted')}`]
      : rows.map((row) => `${INDENT[1]}${row}`)),
    ...(unchecked > 0
      ? [
          `${INDENT[1]}${t(locale, 'trading.analysis.unchecked', { count: formatCount(locale, unchecked) })}`,
        ]
      : []),
  ]
}

function refutedIdsOf(record: AnalysisRecord): ReadonlySet<string> {
  return new Set(claimIdsWithVerdict(record.result.verification, 'refuted'))
}

/** What the side itself says would make it wrong, or that it named nothing checkable. */
function renderWrongLines(
  locale: Locale,
  side: AnalysisSide,
  analysisCase: AnalysisCase
): readonly string[] {
  const { invalidators } = analysisCase

  return [
    renderSectionTitle(SECTION_ICONS.invalidators, t(locale, SIDES[side].wrong)),
    ...(invalidators.length === 0
      ? [`${INDENT[1]}${t(locale, 'trading.analysis.wrong-none')}`]
      : invalidators.map((condition) => `${INDENT[1]}${condition}`)),
  ]
}

/** The readings both sides argued from, each under its group as a row of its own: a value, or the
 *  name's place on the board where the reading is one. No factor's score, weight or the composite,
 *  which would weigh one side over the other. */
function renderFigureLines(locale: Locale, record: AnalysisRecord): readonly string[] {
  const groups = FIGURE_GROUPS.flatMap((group) => {
    const rows = figureRows(locale, record, group)

    return rows.length === 0
      ? []
      : [
          `${INDENT[1]}${t(locale, FIGURE_GROUP_TITLES[group], { sector: sectorLabel(locale, record) })}`,
          ...rows.map((row) => `${INDENT[2]}${row}`),
        ]
  })

  return groups.length === 0
    ? []
    : [
        renderSectionTitle(SECTION_ICONS.factors, t(locale, 'trading.analysis.figures')),
        ...renderScaleNotes(locale, record),
        ...groups,
      ]
}

function figureRows(locale: Locale, record: AnalysisRecord, group: FigureGroup): readonly string[] {
  switch (group) {
    case 'sector':
      return sectorRows(locale, record)
    case 'events':
      return eventRows(locale, record)
    case 'market':
      return backdropRows(locale, record)
    default:
      return metricRows(locale, record, group)
  }
}

/** The money readings carry their currency, which the market's price scale never does: a price on
 *  a board prints bare under the scale note, and a traded value does not. */
function metricRows(locale: Locale, record: AnalysisRecord, group: MetricGroup): readonly string[] {
  const { boardScale, currency } = record

  return metricFacts(
    locale,
    record.figures.filter((metric) => FIGURE_GROUP_OF[metric.id] === group),
    {
      canonical: true,
      row: true,
      plain: true,
      quote: {
        ...(group === 'flows' && currency !== undefined ? { currency } : {}),
        ...(boardScale === undefined ? {} : { display: boardScale.display }),
      },
    }
  )
}

/** The medians as one line: they sit beside the readings of the name above, which carry the
 *  name's own side of each pair. */
function sectorRows(locale: Locale, record: AnalysisRecord): readonly string[] {
  const line = renderMetricLine(locale, record.sector?.medians, {
    canonical: true,
    labels: 'short',
  })

  return line === undefined ? [] : [line]
}

function sectorLabel(locale: Locale, record: AnalysisRecord): string {
  const code = record.sector?.code

  return code === undefined ? '' : renderProvidedValue(locale, `trading.sector.${code}`, code)
}

function eventRows(locale: Locale, record: AnalysisRecord): readonly string[] {
  return (record.upcoming ?? []).map((event) => {
    const { title, detail } = describeEvent(locale, event)

    return t(locale, 'trading.render.metric.row', {
      label: formatDay(locale, event.at),
      value: detail === undefined ? title : `${title}${INLINE_SEPARATOR}${detail}`,
    })
  })
}

/** The market's heaviest series and the session's breadth, as numbers with their names. */
function backdropRows(locale: Locale, record: AnalysisRecord): readonly string[] {
  const { backdrop } = record

  if (backdrop === undefined) {
    return []
  }

  const macro = backdrop.macro.map((reading) =>
    t(locale, 'trading.render.metric.row', {
      label: renderDeclaredValue(locale, `trading.macro.series.${reading.id}`),
      value: formatUnitValue(locale, {
        unit: MACRO_METRIC_UNITS[reading.unit],
        value: reading.value,
      }),
    })
  )
  const { breadth } = backdrop

  return [
    ...(macro.length === 0 ? [] : [macro.join(INLINE_SEPARATOR)]),
    ...(breadth === undefined
      ? []
      : [
          t(locale, 'trading.analysis.breadth', {
            advancers: formatCount(locale, breadth.advancers),
            decliners: formatCount(locale, breadth.decliners),
          }),
        ]),
  ]
}

/** A board-scaled market's prices read bare, so the scale is said once above them. */
function renderScaleNotes(locale: Locale, record: AnalysisRecord): readonly string[] {
  const { boardScale, instrument } = record

  return boardScale === undefined
    ? []
    : renderBoardScaleNotes(locale, [{ market: instrument.market, ...boardScale }]).map(
        (note) => `${INDENT[1]}${note}`
      )
}

function closingLines(
  locale: Locale,
  record: AnalysisRecord,
  options: AnalysisTextOptions
): readonly string[] {
  const { evidenceThrough } = record

  return [
    ...(evidenceThrough === undefined
      ? []
      : [
          t(locale, 'trading.render.suggestion.evidenceThrough', {
            day: formatDay(locale, evidenceThrough),
          }),
        ]),
    ...(options.pageFrames === true ? [] : [t(locale, 'trading.analysis.web-scope')]),
  ]
}
