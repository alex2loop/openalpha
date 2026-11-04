import type { Locale } from '@/core/types/locale'
import type { AnalysisFailure, AnalysisRecord } from '@/trading/features/suggestion/analysis/types'
import type { ArguingRole } from '@/trading/features/suggestion/debate/claims'
import type { AnalysisCase } from '@/trading/features/suggestion/debate/types'
import type { FactorMetricId } from '@/trading/kernel/factor-metric'
import { LLM_ERROR_CODES } from '@/core/llm'
import { formatDay, type MessageKey, renderAiLabel, t } from '@/i18n'
import { isClaimBy, isUnsupportedRole } from '@/trading/features/suggestion/debate/claims'
import { claimIdsWithVerdict } from '@/trading/features/suggestion/debate/types'
import { unsupported } from '@/trading/features/suggestion/pipeline/unsupported'
import { stripStance } from '@/trading/features/suggestion/render/debate'
import { renderCitationLines } from '@/trading/features/suggestion/render/sections'
import { renderUnsupportedReason } from '@/trading/features/suggestion/render/verdict'
import { renderCaveatLines } from '@/trading/render/caveat'
import { formatCount, renderDeclaredValue, SECTION_ICONS } from '@/trading/render/format'
import { INDENT, INLINE_SEPARATOR, joinSections, renderSectionTitle } from '@/trading/render/layout'
import { metricFacts } from '@/trading/render/metric'
import { renderBoardScaleNotes } from '@/trading/render/money'

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

/** The ceilings a call is refused at before it is sent, when its estimated cost would cross one: a
 *  single call above the run's ceiling, which a cheaper model fixes, or a period already spent. */
const SPEND_CAP_KEYS = new Map<unknown, MessageKey>([
  ['run_budget', 'trading.analysis.over-cap'],
  ['daily_cap', 'trading.analysis.cap-spent'],
  ['monthly_cap', 'trading.analysis.cap-spent'],
  ['agent_daily_cap', 'trading.analysis.cap-spent'],
])

type FigureGroup = 'valuation' | 'growth' | 'quality' | 'price' | 'flows'

/** The figure groups in the order they print. */
const FIGURE_GROUP_TITLES = {
  valuation: 'trading.analysis.figures-valuation',
  growth: 'trading.analysis.figures-growth',
  quality: 'trading.analysis.figures-quality',
  price: 'trading.analysis.figures-price',
  flows: 'trading.analysis.figures-flows',
} as const satisfies Record<FigureGroup, MessageKey>

const FIGURE_GROUPS = Object.freeze(Object.keys(FIGURE_GROUP_TITLES) as FigureGroup[])

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
  'relative-volume': 'flows',
  'funding-daily': 'flows',
  'foreign-net-flow': 'flows',
  'ranked-peers': undefined,
  'breakout-trigger': undefined,
  'trailing-low': undefined,
} as const satisfies Readonly<Record<FactorMetricId, FigureGroup | undefined>>)

/** Both sides, what the evidence refuted, and what would make each wrong, in the reader's language.
 *  There is no verdict to print: none was produced, and nothing here weighs one side over the
 *  other. The AI label opens it and the install line closes it, both fixed and never conditional,
 *  so no view of an analysis can omit them. */
export function renderAnalysisText(locale: Locale, record: AnalysisRecord): string {
  const { result } = record
  const cases = { 'bull-researcher': result.bull, 'bear-researcher': result.bear }

  return joinSections([
    [renderAiLabel(locale, result.models)],
    ...SIDE_ORDER.map((side) =>
      renderCaseLines(locale, { side, record, analysisCase: cases[side] })
    ),
    renderRefutedLines(locale, record),
    ...SIDE_ORDER.map((side) => renderWrongLines(locale, side, cases[side])),
    renderFigureLines(locale, record),
    renderCitationLines(locale, {
      citations: [...record.citations, ...record.headlines],
      title: t(locale, 'trading.analysis.sources'),
      detail: 'compact',
    }),
    renderCaveatLines(locale, record.caveats),
    closingLines(locale, record),
  ])
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
  const { boardScale, figures } = record
  const groups = FIGURE_GROUPS.flatMap((group) => {
    const rows = metricFacts(
      locale,
      figures.filter((metric) => FIGURE_GROUP_OF[metric.id] === group),
      {
        canonical: true,
        row: true,
        ...(boardScale === undefined ? {} : { quote: { display: boardScale.display } }),
      }
    )

    return rows.length === 0
      ? []
      : [
          `${INDENT[1]}${t(locale, FIGURE_GROUP_TITLES[group])}`,
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

/** A board-scaled market's prices read bare, so the scale is said once above them. */
function renderScaleNotes(locale: Locale, record: AnalysisRecord): readonly string[] {
  const { boardScale, instrument } = record

  return boardScale === undefined
    ? []
    : renderBoardScaleNotes(locale, [{ market: instrument.market, ...boardScale }]).map(
        (note) => `${INDENT[1]}${note}`
      )
}

function closingLines(locale: Locale, record: AnalysisRecord): readonly string[] {
  const { evidenceThrough } = record

  return [
    ...(evidenceThrough === undefined
      ? []
      : [
          t(locale, 'trading.render.suggestion.evidenceThrough', {
            day: formatDay(locale, evidenceThrough),
          }),
        ]),
    t(locale, 'trading.analysis.web-scope'),
  ]
}

/** Why a run stored nothing, in the reader's language: the name it could not resolve, or why a role
 *  did not answer, with the provider's own words where it gave them. */
export function renderAnalysisFailure(locale: Locale, failure: AnalysisFailure): string {
  if (failure.kind === 'unresolved') {
    return renderUnsupportedReason(locale, unsupported(failure.resolution))
  }

  const { cause, reason } = failure.caveat.detail ?? {}
  const wording = t(locale, reasonKeyOf(cause))

  return t(locale, 'trading.analysis.not-finished', {
    reason: typeof reason === 'string' ? `${wording}${INLINE_SEPARATOR}${reason}` : wording,
  })
}

function reasonKeyOf(cause: unknown): MessageKey {
  const capKey = SPEND_CAP_KEYS.get(cause)

  if (capKey !== undefined) {
    return capKey
  }

  const known = LLM_ERROR_CODES.find((code) => code === cause)

  return known === undefined ? 'llmErrors.fatal' : `llmErrors.${known}`
}
