import type { Locale } from '@/core/types/locale'
import type { FactorId, FactorResult } from '@/trading/kernel/factor'
import type { FactorMetric, FactorMetricId } from '@/trading/kernel/factor-metric'
import type { RenderContext } from '@/trading/render/format'
import type { QuotedIn } from '@/trading/render/money'
import { t } from '@/i18n'
import { scoreBand } from '@/trading/markets/factor-scoring'
import {
  DIRECTION_MARKS,
  formatScoreValue,
  renderDeclaredValue,
  scoreBar,
} from '@/trading/render/format'
import { INDENT, INLINE_SEPARATOR, toFactLines } from '@/trading/render/layout'
import { metricFacts } from '@/trading/render/metric'
import { ABSENT_CELL } from '@/trading/render/number'
import { toTable } from '@/trading/render/table'

/** A row reading the same score as the row above it: two marks would count one score twice. */
const SAME_MARK = '"'

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
  /** Each fired factor's printed share of the composite, at `full` detail only. */
  readonly contributions?: ReadonlyMap<FactorId, number>
  readonly quote?: Partial<QuotedIn>
  readonly context: RenderContext
}

interface Checklist {
  readonly title: string
  readonly lines: readonly string[]
}

interface PlacedRow {
  readonly row: ChecklistRow
  /** The row above reads the same factor, so this one repeats its score rather than adding one. */
  readonly sharesAbove: boolean
}

interface ChecklistCell {
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
function markOf(locale: Locale, factor: FactorResult | undefined, sharesAbove: boolean): string {
  if (factor === undefined) {
    return ''
  }
  if (factor.score === 0) {
    return ABSENT_CELL
  }

  return sharesAbove ? SAME_MARK : scoreBar(locale, factor.score)
}

/** A factor that publishes no readings still says which way it leans, in words rather than a bare
 *  mark. A row with neither says so instead of printing nothing. */
function fallbackFact(locale: Locale, factor: FactorResult | undefined): string {
  return factor === undefined || factor.score === 0
    ? t(locale, 'trading.render.suggestion.checklistNoReading')
    : renderDeclaredValue(locale, `trading.factor.band.${scoreBand(factor.score)}`)
}

function contributionFact(input: ChecklistInput, factor: FactorResult): readonly string[] {
  const contribution = input.contributions?.get(factor.id)

  return contribution === undefined
    ? []
    : [
        t(input.locale, 'trading.render.suggestion.factorContribution', {
          value: formatScoreValue(input.locale, contribution),
        }),
      ]
}

function cellOf(
  input: ChecklistInput,
  metrics: ReadonlyMap<FactorMetricId, FactorMetric>,
  placed: PlacedRow
): ChecklistCell {
  const { locale } = input
  const { row, sharesAbove } = placed
  const factor = input.factors.find((candidate) => candidate.id === row.factor)
  const readings = metricFacts(
    locale,
    row.metrics.flatMap((id) => metrics.get(id) ?? []),
    { labels: 'short', ...(input.quote === undefined ? {} : { quote: input.quote }) }
  )

  return {
    mark: markOf(locale, factor, sharesAbove),
    label: renderDeclaredValue(locale, row.label ?? `trading.factor.${row.factor}`),
    facts: [
      ...(readings.length === 0 ? [fallbackFact(locale, factor)] : readings),
      ...(factor === undefined || sharesAbove ? [] : contributionFact(input, factor)),
    ],
  }
}

function gridLines(cells: readonly ChecklistCell[]): readonly string[] {
  const rows = cells.map((cell) => [cell.mark, cell.label, cell.facts.join(INLINE_SEPARATOR)])

  return toTable(rows, ['left', 'left', 'left']).map((line) => `${INDENT[1]}${line}`)
}

/** One line per row where it fits the phone; otherwise the readings drop under the row's name,
 *  because a wrapped continuation at the row's own depth reads as the next row. */
function stackedLines(cells: readonly ChecklistCell[], context: RenderContext): readonly string[] {
  return cells.flatMap((cell) => {
    const head = cell.mark === '' ? cell.label : `${cell.mark} ${cell.label}`
    const single = toFactLines([head, ...cell.facts], context, 1)

    return single.length <= 1
      ? single
      : [`${INDENT[1]}${head}`, ...toFactLines(cell.facts, context, 2)]
  })
}

/** Where every factor the name was scored on has a row, so no factor that moved the composite can
 *  drop out of sight; `undefined` for a market scoring other factors, which keeps the factor table. */
export function renderChecklist(input: ChecklistInput): Checklist | undefined {
  const { factors, locale } = input

  if (factors.length === 0 || !factors.every((factor) => CHECKLIST_FACTORS.has(factor.id))) {
    return undefined
  }

  const metrics = metricsById(factors)
  const cells = CHECKLIST_ROWS.flatMap((row, index) =>
    row.factor !== undefined && !factors.some((factor) => factor.id === row.factor)
      ? []
      : [
          cellOf(input, metrics, {
            row,
            sharesAbove:
              row.factor !== undefined && CHECKLIST_ROWS[index - 1]?.factor === row.factor,
          }),
        ]
  )

  return {
    title: t(locale, 'trading.render.suggestion.checklist', DIRECTION_MARKS),
    lines: input.context.layout === 'table' ? gridLines(cells) : stackedLines(cells, input.context),
  }
}
