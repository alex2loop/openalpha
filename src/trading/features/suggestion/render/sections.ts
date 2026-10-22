import type { Locale } from '@/core/types/locale'
import type { SuggestionCitation } from '@/trading/features/suggestion/citation'
import type { SuggestionDetail } from '@/trading/features/suggestion/render/debate'
import type { StoredSuggestion } from '@/trading/features/suggestion/types'
import type { PriceDisplay } from '@/trading/kernel/instrument'
import type { QuotedIn } from '@/trading/render/money'
import { formatDay, t } from '@/i18n'
import { tradedWeightPctNav } from '@/trading/features/suggestion/pipeline/concentration'
import { formatPublishedDay } from '@/trading/render/datetime'
import {
  formatCount,
  formatFraction,
  formatQuantity,
  formatSignedFixedPercent,
  renderProvidedValue,
  SECTION_ICONS,
  SEVERITY_MARKS,
} from '@/trading/render/format'
import { INDENT, renderOverflowLine, renderSectionTitle } from '@/trading/render/layout'
import { formatPriceIn, renderBoardScaleNotes } from '@/trading/render/money'
import { toLink } from '@/trading/render/section'

/** Citations shown before the rest collapse behind a count line. Compact surfaces (chat, a Telegram
 *  card) drown past five, so the compact detail collapses them rather than deleting any. */
const SOURCE_PREVIEW_LIMIT = 5

/** What would make the call wrong is a short list, but never unbounded: a run that hedges across
 *  a dozen conditions has no edge to state. */
const INVALIDATOR_LINES = 5
const WITHHELD_KEY_SUFFIX = 'Withheld'

/** `withheld` writes the holding as its weight, never its size or its cost: a model relays that
 *  report, and the operator's own figures stay on their screen. */
export type OperatorFigures = 'shown' | 'withheld'

/** What the operator is carrying that has stopped being true, dated by the call that said it. */
export function renderThesisBreakLines(
  locale: Locale,
  suggestion: StoredSuggestion
): readonly string[] {
  const broken = suggestion.invalidatedPrior

  if (broken === undefined) {
    return []
  }

  return [
    `${INDENT[1]}${SEVERITY_MARKS.warn} ${t(locale, 'trading.render.suggestion.thesisBroken', {
      day: formatDay(locale, broken.at),
    })}`,
    ...broken.fired.map((condition) => `${INDENT[2]}${condition}`),
  ]
}

/** What would make this call wrong. Absent when the run named nothing: a first call states its
 *  levels without conditions yet. Printed on a hold too - being told to do nothing is exactly when
 *  the operator has no other signal for when to look again. */
export function renderInvalidatorLines(
  locale: Locale,
  suggestion: StoredSuggestion
): readonly string[] {
  const { invalidators } = suggestion

  if (invalidators === undefined || invalidators.length === 0) {
    return []
  }

  const shown = invalidators.slice(0, INVALIDATOR_LINES)
  const hiddenCount = invalidators.length - shown.length

  return [
    renderSectionTitle(
      SECTION_ICONS.invalidators,
      t(locale, 'trading.render.suggestion.invalidators')
    ),
    ...shown.map((invalidator) => `${INDENT[1]}${invalidator}`),
    ...(hiddenCount > 0 ? [renderOverflowLine(locale, hiddenCount)] : []),
  ]
}

/** The benchmark basket the name sits in — index-fund demand tracks it, and it is the shorthand a
 *  VN operator already reads a ticker by. */
export function renderIndexTierLine(
  locale: Locale,
  suggestion: StoredSuggestion
): readonly string[] {
  const { indexTier } = suggestion

  if (indexTier === undefined) {
    return []
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.render.suggestion.indexTier', {
      ticker: suggestion.instrument.ticker,
      tier: renderProvidedValue(locale, `trading.index-tier.${indexTier}`, indexTier),
    })}`,
  ]
}

/** That the order adds to a position rather than opening one. Without it "buy 100 MBB" reads as a
 *  new name every time the plan tops one up. A hold and an unsized suggestion state the holding
 *  alone: neither has a total to report, and neither is an order. */
export function renderHeldLine(
  locale: Locale,
  suggestion: StoredSuggestion,
  figures: OperatorFigures
): readonly string[] {
  const { held } = suggestion

  if (held === undefined) {
    return []
  }

  const weight = held.pctNav
  const suffix = withheldSuffix(figures)

  // Without a NAV there is no share to state, but the holding itself is the fact that changes what
  // the operator does about the suggestion, so it is stated alone rather than dropped.
  if (weight === undefined) {
    return [
      `${INDENT[1]}${t(locale, `trading.render.suggestion.alreadyHeldUnweighted${suffix}`, {
        units: formatQuantity(locale, held.units),
        ticker: suggestion.instrument.ticker,
      })}`,
    ]
  }

  const units = suggestion.action === 'hold' ? undefined : suggestion.units
  const sizePctNav = suggestion.action === 'hold' ? undefined : suggestion.sizePctNav
  const shared = {
    units: formatQuantity(locale, held.units),
    ticker: suggestion.instrument.ticker,
    pct: formatFraction(locale, weight),
  }

  if (units === undefined || sizePctNav === undefined) {
    return [`${INDENT[1]}${t(locale, `trading.render.suggestion.alreadyHeld${suffix}`, shared)}`]
  }

  const reducing = suggestion.action === 'reduce'
  const key = reducing ? 'alreadyHeldReducing' : 'alreadyHeldAdding'
  const sign = reducing ? -1 : 1
  const tradedPctNav = tradedWeightPctNav({ held, units, sizePctNav })

  return [
    `${INDENT[1]}${t(locale, `trading.render.suggestion.${key}${suffix}`, {
      ...shared,
      after: formatQuantity(locale, held.units + sign * units),
      afterPct: formatFraction(locale, weight + sign * tradedPctNav),
    })}`,
  ]
}

/** Every sentence that states the holding's size or cost has a twin in the catalog, under this
 *  suffix, that states the same fact as a weight or from today's price. */
export function withheldSuffix(figures: OperatorFigures): '' | typeof WITHHELD_KEY_SUFFIX {
  return figures === 'withheld' ? WITHHELD_KEY_SUFFIX : ''
}

/** Why the order is smaller than the plan's own number for this name: `/rebalance` fills to the
 *  caps, this scales that by conviction and intent, and nothing else says so. */
export function renderScaledSizeLine(
  locale: Locale,
  suggestion: StoredSuggestion
): readonly string[] {
  if (suggestion.action === 'hold' || suggestion.policyUnits === undefined) {
    return []
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.render.suggestion.sizeScaled', {
      policy: formatQuantity(locale, suggestion.policyUnits),
      ticker: suggestion.instrument.ticker,
    })}`,
  ]
}

/** Why the sale fires at all. A trim toward a target and an exit from a broken thesis are the same
 *  three lines of output otherwise, and they are not the same decision. */
export function renderReduceReasonLines(
  locale: Locale,
  suggestion: StoredSuggestion
): readonly string[] {
  if (suggestion.action !== 'reduce' || suggestion.reduceReasonCode === undefined) {
    return []
  }

  const code = suggestion.reduceReasonCode
  // Only the trim names a number: the evidence arms say what turned, which needs no parameter.
  const params =
    code === 'over-target' && suggestion.targetPctNav !== undefined
      ? { target: formatFraction(locale, suggestion.targetPctNav) }
      : {}

  return [`${INDENT[1]}${t(locale, `trading.reduce.${code}`, params)}`]
}

/** Every level below prints in board points on a board-scaled market, so the scale is said once. */
export function renderBoardScaleLines(
  locale: Locale,
  suggestion: StoredSuggestion,
  quote: QuotedIn | undefined
): readonly string[] {
  return renderBoardScaleNotes(locale, [
    { market: suggestion.instrument.market, ...(quote ?? {}) },
  ]).map((note) => `${INDENT[1]}${note}`)
}

/** The price the run was built at, dated by the header: a stored suggestion replayed later shows
 *  the quote its levels came from, never today's. Absent when the market published none — the
 *  levels then priced off the last close, which the bars section of the operator's own tools owns. */
export function renderQuoteLine(
  locale: Locale,
  suggestion: StoredSuggestion,
  display?: PriceDisplay
): readonly string[] {
  const { quote } = suggestion

  if (quote === undefined) {
    return []
  }

  const price = formatPriceIn(locale, quote.price, {
    currency: quote.currency,
    ...(display === undefined ? {} : { display }),
  })
  const line =
    quote.changePct === undefined
      ? t(locale, 'trading.render.suggestion.quote', { price })
      : t(locale, 'trading.render.suggestion.quoteChange', {
          price,
          change: formatSignedFixedPercent(locale, quote.changePct),
        })

  return [`${INDENT[1]}${line}`]
}

/** The title carries the read counts, because the list below it carries only what a role quoted.
 *  Silent where nothing was cited. */
export function renderSourceLines(
  locale: Locale,
  suggestion: StoredSuggestion,
  detail: SuggestionDetail = 'compact'
): readonly string[] {
  const { citations } = suggestion

  if (citations.length === 0) {
    return []
  }

  const shown = detail === 'full' ? citations : citations.slice(0, SOURCE_PREVIEW_LIMIT)
  const hiddenCount = citations.length - shown.length

  return [
    renderSectionTitle(SECTION_ICONS.sources, sourcesTitle(locale, suggestion)),
    ...shown.map((citation) => `${INDENT[1]}${renderCitation(locale, citation)}`),
    ...(hiddenCount > 0 ? [renderOverflowLine(locale, hiddenCount)] : []),
  ]
}

function sourcesTitle(locale: Locale, suggestion: StoredSuggestion): string {
  const read = suggestion.headlinesRead

  if (read === undefined) {
    return t(locale, 'trading.render.suggestion.sources')
  }

  return t(locale, 'trading.render.suggestion.sourcesRead', {
    cited: formatCount(locale, suggestion.citations.length),
    own: formatCount(locale, read.own),
    ticker: suggestion.instrument.ticker,
    market: formatCount(locale, read.market),
  })
}

/** What the link reads as when the citation carries no headline: the publisher's host, which is a
 *  name rather than a redirect. A target that will not parse as a URL is its own label. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    // A stored citation is whatever the provider gave; an unparseable target still has to render.
    return url
  }
}

/** The headline is the link and the target never prints: a news redirect runs to 300 characters of
 *  base64, which is a tenth of the message and nothing a reader can act on. A citation with no
 *  headline has only that target to show, so it states the source it came from instead. */
function renderCitation(locale: Locale, citation: SuggestionCitation): string {
  const dated =
    citation.publishedAt === undefined
      ? undefined
      : formatPublishedDay(locale, citation.publishedAt)

  if (citation.title === undefined) {
    const link = toLink(hostOf(citation.url), citation.url)

    return dated === undefined ? link : `${link} (${dated})`
  }

  return toLink(citation.title, citation.url, {
    reader: locale,
    ...(dated === undefined ? {} : { dated }),
  })
}
