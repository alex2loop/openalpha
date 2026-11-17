import type { Locale } from '@/core/types/locale'
import type { MarketRef } from '@/trading/kernel/instrument'
import type { QuoteBoard, QuoteBoardItem } from '@/trading/kernel/market/market-capability'
import type { QuoteFreshness } from '@/trading/kernel/market/market-data'
import type { RenderContext } from '@/trading/render/format'
import type { QuoteConvention, QuotedIn } from '@/trading/render/money'
import { t } from '@/i18n'
import { isLevelKind } from '@/trading/kernel/instrument'
import { renderCaveatLines } from '@/trading/render/caveat'
import {
  formatCount,
  formatFlow,
  formatSignedFixedPercent,
  SECTION_ICONS,
} from '@/trading/render/format'
import { renderQuoteFreshness } from '@/trading/render/freshness'
import { INDENT, joinSections, renderEmptyLine, renderSectionTitle } from '@/trading/render/layout'
import { renderMarketBlocks, toMarketBlocks } from '@/trading/render/market-blocks'
import { formatPriceIn, quotedInOf, renderBoardScaleNotes } from '@/trading/render/money'
import { quoteBoardMoveOf } from '@/trading/render/price-pair'

/** The board convention each row's own market quotes in: a quoteBoard spans markets, so one display for
 *  the call would price a VN share in a crypto convention. */
interface QuoteRenderOptions {
  readonly context: RenderContext
  readonly quoteConventions?: ReadonlyMap<MarketRef, QuoteConvention>
  readonly marketIcons: ReadonlyMap<MarketRef, string>
}

export function renderQuotesText(
  locale: Locale,
  quoteBoard: QuoteBoard,
  options: QuoteRenderOptions
): string {
  if (quoteBoard.items.length === 0) {
    return joinSections([
      [renderEmptyLine(SECTION_ICONS.watchlist, t(locale, 'trading.render.quotes.empty'))],
      renderCaveatLines(locale, quoteBoard.caveats),
    ])
  }

  const tickerWidth =
    options.context.layout === 'lines'
      ? 0
      : quoteBoard.items.reduce((width, item) => Math.max(width, item.ticker.length), 0)

  return joinSections([
    [
      renderSectionTitle(
        SECTION_ICONS.watchlist,
        t(locale, 'trading.render.quotes.title', {
          count: formatCount(locale, quoteBoard.items.length),
        })
      ),
      ...renderMarketBlocks(
        locale,
        toMarketBlocks(quoteBoard.items, (item) => item.market),
        {
          icons: options.marketIcons,
          renderRows: (items) =>
            items.map((item) => rowLine(locale, item, { tickerWidth, options })),
        }
      ),
      ...boardScaleLines(locale, quoteBoard.items, options),
    ],
    renderCaveatLines(locale, quoteBoard.caveats),
  ])
}

function boardScaleLines(
  locale: Locale,
  items: readonly QuoteBoardItem[],
  options: QuoteRenderOptions
): readonly string[] {
  const quotes = items.flatMap((item) => {
    const { display } = quotedFieldsOf(item, options)

    return display === undefined ? [] : [{ market: item.market, currency: item.currency, display }]
  })

  return renderBoardScaleNotes(locale, quotes).map((note) => `${INDENT[1]}${note}`)
}

/** A level prints bare: it has no currency and no board scale to divide by, whatever its market
 *  quotes its names in. */
function quotedFieldsOf(item: QuoteBoardItem, options: QuoteRenderOptions): Partial<QuotedIn> {
  if (isLevelKind(item.kind)) {
    return {}
  }

  return { currency: item.currency, ...quotedInOf(options.quoteConventions?.get(item.market)) }
}

/** A separate key per shape rather than one with an empty `{change}`: a market that publishes no
 *  day change would otherwise leave a gap where a number belongs. */
function rowLine(
  locale: Locale,
  item: QuoteBoardItem,
  row: { readonly tickerWidth: number; readonly options: QuoteRenderOptions }
): string {
  const shared = {
    ticker: item.ticker.padEnd(row.tickerWidth),
    last: formatPriceIn(locale, item.last, quotedFieldsOf(item, row.options)),
    observed: renderQuoteFreshness(locale, rowFreshness(item), {
      timezone: row.options.context.timezone,
    }),
  }
  const change = changeText(locale, item)
  const line =
    change === undefined
      ? t(locale, 'trading.render.quotes.row', shared)
      : t(locale, 'trading.render.quotes.rowChange', { ...shared, change })

  return `${INDENT[1]}${line}${volumeText(locale, item)}`
}

/** A close names its session only once that session has settled; an old print from a session still
 *  trading is stated by its clock, never as that session's close. */
function rowFreshness(item: QuoteBoardItem): QuoteFreshness {
  return item.closedOn === undefined ? { ...item.observed, kind: 'live' } : item.observed
}

/** A session volume of exactly zero means the name has not traded, which its own type states. The
 *  0% its reference price yields would assert a move that never happened. */
function changeText(locale: Locale, item: QuoteBoardItem): string | undefined {
  if (item.sessionVolume === 0) {
    return t(locale, 'trading.render.quotes.noTrade')
  }

  const changePct = quoteBoardMoveOf(item)

  return changePct === undefined ? undefined : formatSignedFixedPercent(locale, changePct)
}

function volumeText(locale: Locale, item: QuoteBoardItem): string {
  if (item.sessionVolume === undefined || item.sessionVolume === 0) {
    return ''
  }

  return ` · ${t(locale, 'trading.render.quotes.volume', {
    volume: formatFlow(locale, item.sessionVolume),
  })}`
}
