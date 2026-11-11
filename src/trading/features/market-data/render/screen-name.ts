import type { Locale } from '@/core/types/locale'
import type { ScreenRenderRequest } from '@/trading/features/market-data/render/screen'
import type { ScreenView } from '@/trading/features/market-data/types'
import type { Ticker } from '@/trading/kernel/instrument'
import { t } from '@/i18n'
import { boardOf, renderPriceUnitLine } from '@/trading/features/market-data/render/screen'
import { renderBoardRowHead } from '@/trading/features/market-data/render/screen-evidence'
import {
  boardFacts,
  renderBoardFactLines,
} from '@/trading/features/market-data/render/screen-facts'
import { renderCaveatLines } from '@/trading/render/caveat'
import { renderDeclaredValue, SECTION_ICONS } from '@/trading/render/format'
import {
  joinSections,
  renderAsOf,
  renderProvenanceLine,
  renderSectionTitle,
} from '@/trading/render/layout'

/** Wrapping at width 0 puts each reading on a line of its own: one name has no neighbour to line up
 *  against, so the eye reads straight down. */
const LIST_WIDTH = 0

/** `/screen <ticker>`: that name's row as a board lists it, whichever board was read, so its
 *  figures read as on the Screen board and on its card, never with a rank; or a line saying the
 *  board left it out. */
export function renderScreenNameText(
  locale: Locale,
  request: ScreenRenderRequest & { readonly ticker: Ticker },
  result: ScreenView
): string {
  const [candidate] = result.candidates
  const values = {
    ticker: request.ticker,
    market: renderDeclaredValue(locale, `trading.market.${request.market}`),
  }

  if (candidate === undefined) {
    const title = t(locale, 'trading.render.screen.nameMissing', values)

    return joinSections([
      [renderSectionTitle(SECTION_ICONS.screen, title)],
      renderCaveatLines(locale, result.caveats, { plain: true }),
    ])
  }

  const title = t(locale, 'trading.render.screen.nameTitle', values)
  const board = boardOf(request, result)
  const facts = boardFacts(locale, candidate, board)

  return joinSections([
    [
      `${renderSectionTitle(SECTION_ICONS.screen, title)}${renderAsOf(locale, result.dataThroughDay ?? result.asOf)}`,
      ...renderPriceUnitLine(locale, request, result),
      ...renderBoardRowHead(locale, candidate, board),
      ...renderBoardFactLines(locale, facts, { ...board.context, width: LIST_WIDTH }),
      ...renderProvenanceLine(locale, result.provenance, request.context.timezone),
    ],
    renderCaveatLines(locale, result.caveats, { plain: true }),
  ])
}
