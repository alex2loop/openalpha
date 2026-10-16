import type { Locale } from '@/core/types/locale'
import type { SuggestionDetail } from '@/trading/features/suggestion/render/debate'
import type { StoredSuggestion } from '@/trading/features/suggestion/types'
import type { FactorAttribution, FactorComposite, FactorResult } from '@/trading/kernel/factor'
import type { FactorMetric, FactorMetricId } from '@/trading/kernel/factor-metric'
import type { RenderContext } from '@/trading/render/format'
import type { QuotedIn } from '@/trading/render/money'
import { t } from '@/i18n'
import { CHECKLIST_METRICS, renderChecklist } from '@/trading/features/suggestion/render/checklist'
import { framedDirectionOf } from '@/trading/features/suggestion/types'
import { dedupeProvenance } from '@/trading/kernel/source/source-result'
import { scoreBand } from '@/trading/markets/factor-scoring'
import { toFoldLines } from '@/trading/render/fold'
import {
  formatCount,
  formatFraction,
  formatScore,
  formatScoreValue,
  formatWholeFraction,
  renderDeclaredValue,
  SECTION_ICONS,
  scoreBar,
} from '@/trading/render/format'
import {
  INDENT,
  INLINE_SEPARATOR,
  renderProvenanceLine,
  renderSectionTitle,
} from '@/trading/render/layout'
import { renderMetricLine } from '@/trading/render/metric'
import { apportion, SCORE_QUANTUM } from '@/trading/render/number'

/** A row reporting what was suppressed rather than what was found. */
const QUIET_MARK = '➖'
const NOTHING_SHOWN: ReadonlySet<FactorMetricId> = new Set()

interface FactorSectionInput {
  readonly locale: Locale
  readonly suggestion: StoredSuggestion
  readonly detail: SuggestionDetail
  /** How each factor has actually resolved, when enough rows have. Read at `full` detail only: one
   *  record row per factor doubles the section, and the operator asking for it has said so. */
  readonly attribution?: readonly FactorAttribution[]
  /** How the market prints a price, so a price-valued metric matches the levels above it and a
   *  money-valued one carries the currency they are quoted in. */
  readonly quote?: Partial<QuotedIn>
  readonly context: RenderContext
}

/** The checklist where every factor the name was scored on has a row, the factor table otherwise.
 *  Either way the composite heads the section and the fold holds what the rows leave out. */
export function renderFactorLines(input: FactorSectionInput): readonly string[] {
  const { locale, suggestion } = input

  if (suggestion.factorScores.length === 0) {
    return []
  }

  const ranked = rankedFactors(suggestion.factorScores)
  const sources = renderProvenanceLine(
    locale,
    dedupeProvenance(ranked.flatMap((entry) => entry.factor.provenance)),
    input.context.timezone
  )
  const checklist = renderChecklist({
    locale,
    factors: suggestion.factorScores,
    context: input.context,
    ...(input.quote === undefined ? {} : { quote: input.quote }),
  })

  if (checklist === undefined) {
    return tableSection(input, { ranked, sources })
  }

  return [
    renderSectionTitle(SECTION_ICONS.factors, checklist.title),
    ...compositeRow(locale, suggestion.composite),
    ...checklist.lines,
    ...factorFold(input, {
      rows: ranked.filter((entry) => entry.factor.score !== 0),
      sources,
      shown: CHECKLIST_METRICS,
    }),
  ]
}

/** Grouped for/against so the table mirrors the debate's structure, ranked within each group by
 *  what each factor moved the composite by, so the evidence that decided the verdict reads first.
 *  Abstained factors score exactly zero and sit in their own tail — an abstention is neither side's
 *  evidence. Compact detail also collapses every factor the domain's own band vocabulary calls
 *  neutral into one count line: six rows of ▲░░░░ +0,08 bury the two that moved it. `full` lists
 *  all, and adds each factor's own record. */
function tableSection(input: FactorSectionInput, section: RankedSection): readonly string[] {
  const { locale, suggestion, detail } = input
  const { ranked, sources } = section
  const scored = ranked.filter((entry) => entry.factor.score !== 0)
  const abstained = ranked.filter((entry) => entry.factor.score === 0)
  const heading = [
    renderSectionTitle(SECTION_ICONS.factors, t(locale, 'trading.render.suggestion.factors')),
    ...compositeRow(locale, suggestion.composite),
  ]

  if (detail === 'full') {
    return [
      ...heading,
      ...groupedFactorRows(input, scored, abstained),
      ...factorFold(input, { rows: scored, sources, shown: NOTHING_SHOWN }),
    ]
  }

  const decisive = scored.filter((entry) => scoreBand(entry.factor.score) !== 'neutral')
  const quietCount = scored.length - decisive.length

  return [
    ...heading,
    ...groupedFactorRows(input, decisive, abstained),
    ...(quietCount > 0
      ? [
          `${INDENT[1]}${QUIET_MARK} ${t(locale, 'trading.render.suggestion.factorsQuiet', {
            count: formatCount(locale, quietCount),
          })}`,
        ]
      : []),
    ...factorFold(input, { rows: decisive, sources, shown: NOTHING_SHOWN }),
  ]
}

/** The fold the rows below were ranked into: the score that chose the direction and the band, the
 *  share of weight that had data behind it, and how far the fired factors leaned the same way.
 *  Agreement needs two fired factors, so a run with one drops that clause rather than the row. */
function compositeRow(locale: Locale, composite: FactorComposite): readonly string[] {
  const shared = {
    score: formatScoreValue(locale, composite.score),
    // Every market's composite sits on its own scale, so the band travels beside the number rather
    // than the cut points that produced it — those mean nothing without naming the market too.
    // Too little data behind it is low confidence, however far the few readings lean.
    band: renderDeclaredValue(
      locale,
      `trading.conviction.${composite.coverageBelowMinimum ? 'low' : composite.band}`
    ),
    coverage: formatWholeFraction(locale, composite.coverage),
  }
  const key = composite.agreement === undefined ? 'factorCompositeSplit' : 'factorComposite'

  return [
    `${INDENT[1]}${t(locale, `trading.render.suggestion.${key}`, {
      ...shared,
      ...(composite.agreement === undefined
        ? {}
        : { agreement: formatWholeFraction(locale, composite.agreement) }),
    })}`,
  ]
}

/** A factor beside the share of the composite it is printed as having moved. */
interface RankedFactor {
  readonly factor: FactorResult
  /** Absent where the factor did not fire: it published no share and moved nothing. */
  readonly contribution?: number
}

/** Ranked by what each factor moved the composite by, not by how extreme it read: a factor carrying
 *  a twentieth of the composite can hold the larger score while a heavier one decided the verdict.
 *  A factor that did not fire moved nothing, so it sorts last.
 *
 *  The shares are rounded together rather than one row at a time, because the composite divides by
 *  the fired weight and every fired factor's share is printed under it — rounded on its own, the
 *  column lands a hundredth away from the score above it. Only the rows that print a share are
 *  apportioned; an abstention prints none, so a rounding unit parked on it would be invisible. */
function rankedFactors(factors: readonly FactorResult[]): readonly RankedFactor[] {
  const ranked = factors.toSorted((left, right) => movedBy(right) - movedBy(left))
  const printed = ranked.filter(isPrinted)
  const shares = apportion(
    printed.map((factor) => factor.score * factor.weight),
    SCORE_QUANTUM
  )
  const byFactor = new Map(printed.map((factor, index) => [factor.id, shares[index]]))

  return ranked.map((factor) => {
    const contribution = byFactor.get(factor.id)

    return contribution === undefined ? { factor } : { factor, contribution }
  })
}

/** Ranked on the unrounded share, so two factors a hundredth apart keep their order even where both
 *  print the same figure. */
function movedBy(factor: FactorResult): number {
  return Math.abs(factor.score) * (factor.weight ?? 0)
}

/** A factor that fired and moved something: the rows that print a share, and the only ones the
 *  apportioning may spend a rounding unit on. */
function isPrinted(factor: FactorResult): factor is FactorResult & { readonly weight: number } {
  return factor.weight !== undefined && movedBy(factor) > 0
}

function groupedFactorRows(
  input: FactorSectionInput,
  scored: readonly RankedFactor[],
  abstained: readonly RankedFactor[]
): readonly string[] {
  const bullish = scored.filter((entry) => entry.factor.score > 0)
  const bearish = scored.filter((entry) => entry.factor.score < 0)
  // Supporters of the framed action lead: on a reduce, the bearish evidence is the case for it.
  const groups =
    framedDirectionOf(input.suggestion) === 'reduce'
      ? ([
          { key: 'factorsForReduce', rows: bearish },
          { key: 'factorsAgainstReduce', rows: bullish },
          { key: 'factorsNeutral', rows: abstained },
        ] as const)
      : ([
          { key: 'factorsFor', rows: bullish },
          { key: 'factorsAgainst', rows: bearish },
          { key: 'factorsNeutral', rows: abstained },
        ] as const)

  return groups
    .filter((group) => group.rows.length > 0)
    .flatMap((group) => [
      `${INDENT[1]}${t(input.locale, `trading.render.suggestion.${group.key}`)}`,
      ...group.rows.flatMap((entry) => factorRows(input, entry)),
    ])
}

function factorRows(input: FactorSectionInput, entry: RankedFactor): readonly string[] {
  return [`${INDENT[2]}${factorLine(input.locale, entry)}`]
}

interface RankedSection {
  readonly ranked: readonly RankedFactor[]
  readonly sources: readonly string[]
}

interface FoldInput {
  readonly rows: readonly RankedFactor[]
  readonly sources: readonly string[]
  /** Readings already printed above the fold, so it states each one once. */
  readonly shown: ReadonlySet<FactorMetricId>
}

/** The measurements behind the rows, in one block the destination may fold away: a reader deciding
 *  on the score reads the rows, and a reader checking it opens this. A score is a decision and
 *  stays on the page; what produced it is detail. */
function factorFold(input: FactorSectionInput, fold: FoldInput): readonly string[] {
  const { locale } = input
  const body = [
    ...foldMetricLines(input, fold),
    ...fold.rows.flatMap((entry) => detailRow(recordLine(input, entry.factor))),
    ...fold.sources,
  ]

  return toFoldLines(t(locale, 'trading.render.suggestion.factorFold'), body)
}

/** Each reading once: two factors scored against the same peer board both carry its size, and the
 *  fold states it on the first row that does. */
function foldMetricLines(input: FactorSectionInput, fold: FoldInput): readonly string[] {
  const seen = new Set<string>()

  return fold.rows.flatMap((entry) => {
    const fresh = (entry.factor.metrics ?? []).filter(
      (metric) => !(fold.shown.has(metric.id) || seen.has(metricKey(metric)))
    )

    for (const metric of fresh) {
      seen.add(metricKey(metric))
    }

    return detailRow(renderMetricLine(input.locale, fresh, input.quote))
  })
}

/** A reading is the same one only at the same value: a peer count on a filtered board is not the
 *  count on the whole one. */
function metricKey(metric: FactorMetric): string {
  return `${metric.id}:${metric.value}:${metric.sessions ?? ''}`
}

function detailRow(text: string | undefined): readonly string[] {
  return text === undefined ? [] : [text]
}

/** What this factor's own reading has been worth, on the side it is reading now: a bullish value
 *  factor is answered by how bullish value readings resolved, never by the factor's whole history.
 *  Silent below the reporting minimum, which upstream enforces by withholding the rate. */
function recordLine(input: FactorSectionInput, factor: FactorResult): string | undefined {
  if (input.detail !== 'full' || factor.score === 0) {
    return undefined
  }

  const reading = factor.score > 0 ? 'bullish' : 'bearish'
  const row = input.attribution?.find(
    (entry) =>
      entry.market === input.suggestion.instrument.market &&
      entry.factorId === factor.id &&
      entry.strategyVersion === input.suggestion.strategyVersion
  )
  const bucket = row?.buckets.find((entry) => entry.reading === reading)

  if (bucket?.hitRate === undefined) {
    return undefined
  }

  return t(input.locale, 'trading.render.suggestion.factorRecord', {
    reading: t(input.locale, `trading.attribution.${reading}`),
    rate: formatFraction(input.locale, bucket.hitRate),
    hits: formatCount(input.locale, bucket.hitCount),
    count: formatCount(input.locale, bucket.resolvedCount),
  })
}

/** An abstention gets its name only: a bar and a "+0.00" beside "no reading" claim a measurement
 *  that never happened. */
function factorLine(locale: Locale, entry: RankedFactor): string {
  const { factor } = entry
  const name = renderDeclaredValue(locale, `trading.factor.${factor.id}`)

  if (factor.score === 0) {
    return name
  }

  const scored = `${scoreBar(locale, factor.score)} ${name}: ${formatScore(locale, factor.score)}`

  if (entry.contribution === undefined) {
    return scored
  }

  return `${scored}${INLINE_SEPARATOR}${t(locale, 'trading.render.suggestion.factorContribution', {
    value: formatScoreValue(locale, entry.contribution),
  })}`
}

/** Compact caps the list at the preview limit and names the remainder; `full` prints every
 *  citation. Stored order is kept — the pipeline writes them most-relevant first. */
