import type { Locale } from '@/core/types/locale'
import type { FactorId, FactorResult } from '@/trading/kernel/factor'
import type { FactorMetric, FactorMetricId } from '@/trading/kernel/factor-metric'
import type { RenderContext } from '@/trading/render/format'
import type { QuotedIn } from '@/trading/render/money'
import { t } from '@/i18n'
import { scoreBand } from '@/trading/markets/factor-scoring'
import { renderDeclaredValue, scoreBar } from '@/trading/render/format'
import { INDENT, INLINE_SEPARATOR, toFactLines } from '@/trading/render/layout'
import { metricFacts } from '@/trading/render/metric'
import { ABSENT_CELL } from '@/trading/render/number'
import { toTable } from '@/trading/render/table'

/** Which side of the call a row sits on. A row naming no factor, or one reading near zero, is
 *  context rather than evidence. */
const CHECKLIST_GROUPS = Object.freeze(['Up', 'Down', 'Neutral'] as const)

type ChecklistGroup = (typeof CHECKLIST_GROUPS)[number]

type ChecklistRow =
  | {
      readonly factor: FactorId
      /** Where the row shows one part of what the factor scores rather than the whole of it. */
      readonly label?: `trading.${string}`
      readonly metrics: readonly FactorMetricId[]
    }
  | {
      readonly factor?: undefined
      readonly label: `trading.${string}`
      readonly metrics: readonly FactorMetricId[]
    }

/** The order an analyst reads a VN stock in: the business, what it costs, then the tape. Growth has
 *  no factor of its own, so it carries numbers and no mark. A bank publishes no gross margin or
 *  debt/equity and the other names no bad debt or CAR, so each row shows whichever of its readings
 *  the name has. */
const CHECKLIST_ROWS: readonly ChecklistRow[] = Object.freeze([
  {
    label: 'trading.render.suggestion.checklistGrowth',
    metrics: ['revenue-growth', 'earnings-growth'],
  },
  {
    factor: 'quality',
    label: 'trading.render.suggestion.checklistProfit',
    metrics: ['gross-margin', 'net-interest-to-assets', 'return-on-equity', 'return-on-assets'],
  },
  {
    factor: 'quality',
    label: 'trading.render.suggestion.checklistHealth',
    metrics: [
      'accounts-score',
      'debt-to-equity',
      'bad-debt-ratio',
      'capital-adequacy',
      'casa-share',
    ],
  },
  { factor: 'value', metrics: ['pe', 'pb', 'value-percentile'] },
  { factor: 'trend', metrics: ['trend-average'] },
  { factor: 'high-proximity', metrics: ['year-high'] },
  { factor: 'foreign-flow', metrics: [] },
  { factor: 'proprietary-flow', metrics: [] },
  { factor: 'speculative-turnover', metrics: [] },
])

const CHECKLIST_FACTORS: ReadonlySet<FactorId> = new Set(
  CHECKLIST_ROWS.flatMap((row) => (row.factor === undefined ? [] : [row.factor]))
)

/** The readings the rows print, so the fold below them states only the rest. */
export const CHECKLIST_METRICS: ReadonlySet<FactorMetricId> = new Set(
  CHECKLIST_ROWS.flatMap((row) => row.metrics)
)

interface ChecklistInput {
  readonly locale: Locale
  readonly factors: readonly FactorResult[]
  readonly quote?: Partial<QuotedIn>
  readonly context: RenderContext
}

interface Checklist {
  readonly title: string
  readonly lines: readonly string[]
}

interface ChecklistCell {
  readonly factor?: FactorResult
  readonly label: string
  readonly facts: readonly string[]
}

interface PlacedCell {
  /** Blank where the row above reads the same factor: two marks would count one score twice. */
  readonly mark: string
  readonly label: string
  readonly facts: readonly string[]
}

function metricsById(factors: readonly FactorResult[]): ReadonlyMap<FactorMetricId, FactorMetric> {
  return new Map(
    factors.flatMap((factor) => factor.metrics ?? []).map((metric) => [metric.id, metric])
  )
}

/** The factor table's own gauge, so a row reads as strongly as its score does in either shape. */
function markOf(locale: Locale, factor: FactorResult | undefined): string {
  if (factor === undefined) {
    return ''
  }

  return factor.score === 0 ? ABSENT_CELL : scoreBar(locale, factor.score)
}

function groupOf(factor: FactorResult | undefined): ChecklistGroup {
  if (factor === undefined || scoreBand(factor.score) === 'neutral') {
    return 'Neutral'
  }

  return factor.score > 0 ? 'Up' : 'Down'
}

/** A factor that publishes no readings still says which way it leans, in words rather than a bare
 *  mark. A row with neither says so instead of printing nothing. */
function fallbackFact(locale: Locale, factor: FactorResult | undefined): string {
  return factor === undefined || factor.score === 0
    ? t(locale, 'trading.render.suggestion.checklistNoReading')
    : renderDeclaredValue(locale, `trading.factor.band.${scoreBand(factor.score)}`)
}

function cellOf(
  input: ChecklistInput,
  metrics: ReadonlyMap<FactorMetricId, FactorMetric>,
  row: ChecklistRow
): ChecklistCell {
  const { locale } = input
  const factor = input.factors.find((candidate) => candidate.id === row.factor)
  const readings = metricFacts(
    locale,
    row.metrics.flatMap((id) => metrics.get(id) ?? []),
    { labels: 'short', ...(input.quote === undefined ? {} : { quote: input.quote }) }
  )

  return {
    ...(factor === undefined ? {} : { factor }),
    label: renderDeclaredValue(locale, row.label ?? `trading.factor.${row.factor}`),
    facts: readings.length === 0 ? [fallbackFact(locale, factor)] : readings,
  }
}

/** Strongest first within a group. The sort is stable, so two rows reading one factor stay
 *  adjacent and the second leaves its mark blank. */
function placedCells(locale: Locale, cells: readonly ChecklistCell[]): readonly PlacedCell[] {
  const ranked = cells.toSorted(
    (left, right) => Math.abs(right.factor?.score ?? 0) - Math.abs(left.factor?.score ?? 0)
  )

  return ranked.map((cell, index) => ({
    mark:
      cell.factor !== undefined && ranked[index - 1]?.factor?.id === cell.factor.id
        ? ''
        : markOf(locale, cell.factor),
    label: cell.label,
    facts: cell.facts,
  }))
}

/** One table across every group, so the columns line up from the first group to the last. */
function gridGroups(groups: readonly (readonly PlacedCell[])[]): readonly (readonly string[])[] {
  const table = toTable(
    groups.flat().map((cell) => [cell.mark, cell.label, cell.facts.join(INLINE_SEPARATOR)]),
    ['left', 'left', 'left']
  )

  return groups.map((group, index) => {
    const start = groups.slice(0, index).reduce((count, earlier) => count + earlier.length, 0)

    return table.slice(start, start + group.length).map((line) => `${INDENT[2]}${line}`)
  })
}

/** One line per row where it fits the phone; otherwise the readings drop under the row's name,
 *  because a wrapped continuation at the row's own depth reads as the next row. */
function stackedLines(cells: readonly PlacedCell[], context: RenderContext): readonly string[] {
  return cells.flatMap((cell) => {
    const head = cell.mark === '' ? cell.label : `${cell.mark} ${cell.label}`
    const single = toFactLines([head, ...cell.facts], context, 2)

    return single.length <= 1
      ? single
      : [`${INDENT[2]}${head}`, ...toFactLines(cell.facts, context, 3)]
  })
}

/** Where every factor the name was scored on has a row, so no factor that moved the composite can
 *  drop out of sight; `undefined` for a market scoring other factors, which keeps the factor table.
 *  Rows group by side - in favour, against, then context - so the evidence reads apart from the
 *  numbers that only frame it. */
export function renderChecklist(input: ChecklistInput): Checklist | undefined {
  const { factors, locale, context } = input

  if (factors.length === 0 || !factors.every((factor) => CHECKLIST_FACTORS.has(factor.id))) {
    return undefined
  }

  const metrics = metricsById(factors)
  const cells = CHECKLIST_ROWS.filter(
    (row) => row.factor === undefined || factors.some((factor) => factor.id === row.factor)
  ).map((row) => cellOf(input, metrics, row))
  const groups = CHECKLIST_GROUPS.map((group) => ({
    group,
    cells: placedCells(
      locale,
      cells.filter((cell) => groupOf(cell.factor) === group)
    ),
  })).filter((entry) => entry.cells.length > 0)
  const bodies =
    context.layout === 'table'
      ? gridGroups(groups.map((entry) => entry.cells))
      : groups.map((entry) => stackedLines(entry.cells, context))

  return {
    title: t(locale, 'trading.render.suggestion.checklist'),
    lines: groups.flatMap((entry, index) => [
      `${INDENT[1]}${t(locale, `trading.render.suggestion.checklist${entry.group}`)}`,
      ...(bodies[index] ?? []),
    ]),
  }
}
