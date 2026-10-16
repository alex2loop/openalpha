import type { Locale } from '@/core/types/locale'
import type { Caveat } from '@/trading/kernel/caveat'
import type { MarketRef } from '@/trading/kernel/instrument'
import type { MacroRiskView } from '@/trading/kernel/market/market-macro'
import type { MarketDataOverview } from '@/trading/kernel/market/market-overview'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { RenderContext } from '@/trading/render/format'
import { t } from '@/i18n'
import {
  renderMacroHeading,
  renderMacroSections,
} from '@/trading/features/market-data/render/macro'
import { dedupeCaveats } from '@/trading/kernel/caveat'
import { wholeMarketSections } from '@/trading/markets/overview-sections'
import { renderCaveatLines } from '@/trading/render/caveat'
import { formatClock } from '@/trading/render/datetime'
import { formatScoreValue, renderDeclaredValue, SECTION_ICONS } from '@/trading/render/format'
import {
  INDENT,
  INLINE_SEPARATOR,
  joinSections,
  renderAsOf,
  renderEmptyLine,
  renderProvenanceLine,
  renderSectionTitle,
} from '@/trading/render/layout'
import { renderBlockRule, renderBriefSection } from '@/trading/render/section'

/** Everything the read carries, so the renderer never asks a service for a second one. The macro
 *  read is the region's, not any market's: its drivers price every asset in the message, which is
 *  why it heads them rather than sitting inside one block. */
interface MarketsView {
  readonly overviews: readonly MarketDataOverview[]
  readonly macro: SourceResult<MacroRiskView>
  readonly heldMarkets: ReadonlySet<MarketRef>
  /** The one clock read the whole message is stamped with. */
  readonly now: number
}

/** One block per market, its sections inside. The `━━━` rule is `/brief`'s sanctioned exception and
 *  this is the same markets-by-sections shape, so it uses the same device rather than a second one.
 *  Caveats are stated once at the end: four markets reading one gold source repeat its warning in
 *  every block, and the same sentence three times reads as three findings. */
export function renderOverviewText(
  locale: Locale,
  view: MarketsView,
  context: RenderContext
): string {
  const { overviews } = view

  if (overviews.length === 0) {
    return renderEmptyLine(SECTION_ICONS.overview, t(locale, 'trading.render.overview.empty'))
  }

  return joinSections([
    [renderSectionTitle(SECTION_ICONS.overview, title(locale, view, context.timezone))],
    leanLine(locale, view.macro),
    ...macroBlock(locale, view, context),
    ...overviews.flatMap((overview, index) => {
      const sharedWith = overviews
        .slice(0, index)
        .find((earlier) => isSharedExpandedMacro(earlier, overview, view.macro))

      return marketBlock(locale, {
        overview,
        view,
        context,
        ...(sharedWith === undefined ? {} : { sharedWith }),
      })
    }),
    renderCaveatLines(locale, caveatsOf(view), { collapseInfo: true }),
    [`${INDENT[1]}${t(locale, 'trading.render.macro.next')}`],
  ])
}

/** How many drivers the lean names. Two: one reads as the only cause, and four is a list nobody
 *  finishes on a phone. */
const LEAN_DRIVERS = 2

/** The regime the composite settled on and the two series pulling hardest on it. Absent with the
 *  macro read itself, which already reaches the reader as a caveat on the message. */
function leanLine(locale: Locale, macro: SourceResult<MacroRiskView>): readonly string[] {
  const lean = renderMacroLean(locale, macro)

  return lean === undefined ? [] : [`${INDENT[1]}${lean}`]
}

/** The regime and the two drivers pulling hardest on it, as one sentence without its indent.
 *  Absent when the macro read itself is. */
export function renderMacroLean(
  locale: Locale,
  macro: SourceResult<MacroRiskView>
): string | undefined {
  if (macro.kind !== 'available') {
    return undefined
  }

  const strongest = [...macro.value.drivers]
    .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution))
    .slice(0, LEAN_DRIVERS)

  if (strongest.length === 0) {
    return undefined
  }

  return t(locale, 'trading.render.overview.lean', {
    regime: renderDeclaredValue(locale, `trading.regime.${macro.value.regime}`),
    drivers: strongest
      .map((driver) => renderDeclaredValue(locale, `trading.macro.series.${driver.id}`))
      .join(INLINE_SEPARATOR),
  })
}

function title(locale: Locale, view: MarketsView, timezone: string): string {
  return t(locale, 'trading.render.overview.title', {
    time: formatClock(locale, view.now, timezone),
  })
}

/** Absent rather than an outage notice: the markets below are the answer, and a failed macro read
 *  already arrives as a caveat on the message. */
function macroBlock(
  locale: Locale,
  view: MarketsView,
  context: RenderContext
): readonly (readonly string[])[] {
  if (view.macro.kind !== 'available') {
    return []
  }

  const macro = view.macro.value
  const rule = `${renderBlockRule(SECTION_ICONS.macro, renderMacroHeading(locale, macro))}${renderAsOf(locale, macro.asOf)}`
  const [composite = [], ...rest] = renderMacroSections(locale, {
    view: macro,
    context,
    held: true,
  })

  return [[rule, ...composite], ...rest]
}

/** `overview.icon` rides on the read precisely so a renderer never reaches into the market
 *  registry. The rule carries the session as well as the day: four markets keep four calendars, and
 *  a settled close beside an open one is the difference between a fact and a number still moving. */
function marketBlock(
  locale: Locale,
  block: {
    readonly overview: MarketDataOverview
    readonly view: MarketsView
    readonly context: RenderContext
    /** An earlier market reading the same macro, whose driver rows this block does not repeat. */
    readonly sharedWith?: MarketDataOverview
  }
): readonly (readonly string[])[] {
  const { overview, view, context } = block
  const name = renderDeclaredValue(locale, `trading.market.${overview.market}`)
  const [macro = [], ...macroRest] = sleeveMacroSections(locale, {
    overview,
    region: view.macro,
    context,
    held: view.heldMarkets.has(overview.market),
    ...(block.sharedWith === undefined ? {} : { sharedWith: block.sharedWith }),
  })

  return [
    [`${renderBlockRule(overview.icon, name)}${blockStamp(locale, overview)}`, ...macro],
    ...macroRest,
    ...wholeMarketSections(overview).map((section) => [
      renderBriefSection(locale, section, context),
    ]),
    renderProvenanceLine(locale, overview.provenance, context.timezone),
  ]
}

interface SleeveMacroInput {
  readonly overview: MarketDataOverview
  readonly region: SourceResult<MacroRiskView>
  readonly context: RenderContext
  readonly held: boolean
  readonly sharedWith?: MarketDataOverview
}

/** An earlier market whose own driver table printed, read on the same composite as this one: gold
 *  and VN gold weigh the same US series, and printing the table twice reads as two findings. A
 *  market that only printed the region's one-liner has no table to point back to. */
function isSharedExpandedMacro(
  earlier: MarketDataOverview,
  current: MarketDataOverview,
  region: SourceResult<MacroRiskView>
): boolean {
  const { macro } = earlier

  return (
    macro !== undefined &&
    current.macro !== undefined &&
    !isRegionMacro(macro, region) &&
    macro.regime === current.macro.regime &&
    macro.score === current.macro.score &&
    macro.asOf === current.macro.asOf &&
    macro.formulaVersion === current.macro.formulaVersion
  )
}

/** A sleeve reading the region's own macro states it in one line - the drivers are already above,
 *  and printing them per market drew the same table five times. A sleeve whose read genuinely
 *  differs expands into its own: that number is what gated it, and this is the only place it is
 *  shown. */
function sleeveMacroSections(
  locale: Locale,
  input: SleeveMacroInput
): readonly (readonly string[])[] {
  const { macro } = input.overview

  if (macro === undefined) {
    return []
  }

  return isRegionMacro(macro, input.region)
    ? [[sleeveMacroLine(locale, input.overview, macro)]]
    : expandedMacroSections(locale, input)
}

/** Three fields, not a deep compare: two reads of the same region agree on all three, and a sleeve
 *  that genuinely differs differs in the score. */
function isRegionMacro(macro: MacroRiskView, region: SourceResult<MacroRiskView>): boolean {
  return (
    region.kind === 'available' &&
    region.value.regime === macro.regime &&
    region.value.score === macro.score &&
    region.value.asOf === macro.asOf
  )
}

/** The one line a sleeve keeps when its read is the region's: what gated it, and how hard. */
function sleeveMacroLine(
  locale: Locale,
  overview: MarketDataOverview,
  macro: MacroRiskView
): string {
  return `${INDENT[1]}${t(locale, 'trading.render.macro.sleeveLine', {
    market: renderDeclaredValue(locale, `trading.market.${overview.market}`),
    regime: renderDeclaredValue(locale, `trading.regime.${macro.regime}`),
    score: formatScoreValue(locale, macro.score),
  })}`
}

/** The market's own composite, score and driver rows, under its own title. */
function expandedMacroSections(
  locale: Locale,
  input: SleeveMacroInput
): readonly (readonly string[])[] {
  const { overview } = input

  if (overview.macro === undefined) {
    return []
  }

  const heading = renderSectionTitle(
    SECTION_ICONS.macro,
    t(locale, 'trading.render.macro.marketTitle', {
      market: renderDeclaredValue(locale, `trading.market.${overview.market}`),
      regime: renderDeclaredValue(locale, `trading.regime.${overview.macro.regime}`),
    })
  )
  const [composite = [], ...rest] = renderMacroSections(locale, {
    view: overview.macro,
    context: input.context,
    held: input.held,
  })

  if (input.sharedWith === undefined) {
    return [[heading, ...composite], ...rest]
  }

  return [
    [
      heading,
      ...composite,
      `${INDENT[1]}${t(locale, 'trading.render.macro.sameDrivers', {
        market: renderDeclaredValue(locale, `trading.market.${input.sharedWith.market}`),
      })}`,
    ],
  ]
}

function blockStamp(locale: Locale, overview: MarketDataOverview): string {
  const phase =
    overview.sessionPhase === undefined
      ? ''
      : ` · ${t(locale, `trading.intraday.phase.${overview.sessionPhase}`)}`

  return `${phase}${renderAsOf(locale, overview.asOf)}`
}

/** Every read's caveats, the macro one included, folded to one list. */
function caveatsOf(view: MarketsView): readonly Caveat[] {
  return dedupeCaveats([
    ...view.overviews.flatMap((overview) => overview.caveats),
    ...view.macro.caveats,
  ])
}
