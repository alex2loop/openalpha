import type { Locale } from '@/core/types/locale'
import type { QuoteView } from '@/trading/kernel/market/market-capability'
import type { MarketEvent } from '@/trading/kernel/market/market-data'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { RenderContext } from '@/trading/render/format'
import { formatDay, t } from '@/i18n'
import { renderCaveatLines } from '@/trading/render/caveat'
import { renderDeclaredValue, SECTION_ICONS } from '@/trading/render/format'
import {
  INDENT,
  INLINE_SEPARATOR,
  joinSections,
  renderProvenanceLine,
  renderSectionTitle,
} from '@/trading/render/layout'
import { isBoardScaled, renderBoardScale } from '@/trading/render/money'
import { renderPricePair, renderSessionRange } from '@/trading/render/price-pair'
import { renderLabelledRow } from '@/trading/render/section'

/** Both are enrichments the command may not have been able to read: the price is the answer, and a
 *  provider that served no intraday series or no calendar must not take the answer down with it. */
interface QuoteRenderOptions {
  readonly context: RenderContext
  readonly events?: readonly MarketEvent[]
}

export function renderQuoteText(
  locale: Locale,
  result: SourceResult<QuoteView>,
  options: QuoteRenderOptions
): string {
  if (result.kind === 'unavailable') {
    return joinSections([
      [
        t(locale, 'trading.render.quote.unavailable', {
          reason: t(locale, `trading.source.unavailable.${result.reason}`),
        }),
      ],
      renderCaveatLines(locale, result.caveats),
    ])
  }

  const { quote, observed, display } = result.value
  const range =
    quote.session === undefined
      ? undefined
      : renderSessionRange(locale, { session: quote.session, day: observed.day }, display)

  return joinSections([
    [
      renderSectionTitle(
        SECTION_ICONS.quote,
        [quote.instrument.ticker, ...unitParts(locale, result.value)].join(INLINE_SEPARATOR)
      ),
      ...priceLines(locale, result.value, options),
      ...(range === undefined ? [] : [`${INDENT[1]}${range}`]),
      ...renderUpcomingLines(locale, options.events ?? []),
      ...renderProvenanceLine(locale, result.provenance, options.context.timezone),
    ],
    renderCaveatLines(locale, result.caveats),
  ])
}

/** A board keeps no daily series to close against, so outside its hours the pair has no row to
 *  print at all. Same cells as `/overview`, from the same renderer, so the two cannot drift. */
function priceLines(
  locale: Locale,
  view: QuoteView,
  options: QuoteRenderOptions
): readonly string[] {
  const { quote, observed, previousClose, display, currency } = view
  const { board } = quote

  if (board !== undefined) {
    // The cells take the currency's own precision; the title above already names it, with the
    // measure a board price is quoted per, so they do not restate the code.
    return [
      `${INDENT[1]}${renderLabelledRow(
        locale,
        {
          buyPrice: board.buyPrice,
          sellPrice: board.sellPrice,
          ...(board.spreadPct === undefined ? {} : { spreadPct: board.spreadPct }),
        },
        { ...(currency === undefined ? {} : { currency }), stated: true }
      )}`,
    ]
  }

  return renderPricePair(
    locale,
    {
      timezone: options.context.timezone,
      ...(currency === undefined ? {} : { currency }),
      ...(previousClose === undefined ? {} : { previousClose }),
      live: {
        price: quote.price,
        ...(quote.changePct === undefined ? {} : { changePct: quote.changePct }),
        observed,
      },
      ...(display === undefined ? {} : { display }),
    },
    { context: options.context, depth: 1 }
  )
}

/** Nothing for a level, which is a bare number. A board-scaled price is not in currency units, so
 *  naming the currency alone would mislabel it; the divisor is what lets a reader turn the board
 *  number back into money. */
function unitParts(locale: Locale, view: QuoteView): readonly string[] {
  const { unit, currency, display } = view

  if (unit === undefined || currency === undefined) {
    return []
  }

  if (!isBoardScaled(display) || display === undefined) {
    return [renderDeclaredValue(locale, `trading.quote-unit.${unit}`, { currency })]
  }

  return [renderBoardScale(locale, display, currency)]
}

function renderUpcomingLines(locale: Locale, events: readonly MarketEvent[]): readonly string[] {
  return events.map(
    (event) =>
      `${INDENT[1]}${t(locale, 'trading.render.quote.upcoming', {
        event: renderDeclaredValue(locale, `trading.event.${event.kind}`),
        day: formatDay(locale, event.at),
      })}`
  )
}
