import type { Locale } from '@/core/types/locale'
import type { WatchlistResult } from '@/trading/features/profile/types'
import { pluralKey, t } from '@/i18n'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { renderCaveatLines } from '@/trading/render/caveat'
import { formatCount, renderDeclaredValue, SECTION_ICONS } from '@/trading/render/format'
import { renderKindBadge } from '@/trading/render/kind-badge'
import { INDENT, joinSections, renderEmptyLine, renderSectionTitle } from '@/trading/render/layout'

export function renderWatchlistText(locale: Locale, result: WatchlistResult): string {
  if (result.kind === 'unresolved') {
    return joinSections([
      [t(locale, 'trading.render.watchlist.unresolved')],
      renderCaveatLines(locale, result.caveats),
    ])
  }

  if (result.instruments.length === 0) {
    return renderEmptyLine(SECTION_ICONS.watchlist, t(locale, 'trading.render.watchlist.empty'))
  }

  return joinSections([
    [
      renderSectionTitle(
        SECTION_ICONS.watchlist,
        t(
          locale,
          pluralKey(
            result.instruments.length,
            'trading.render.watchlist.titleOne',
            'trading.render.watchlist.title'
          ),
          { count: formatCount(locale, result.instruments.length) }
        )
      ),
      ...result.instruments.map(
        (entry) =>
          `${INDENT[1]}${t(locale, 'trading.render.watchlist.row', {
            ticker: `${entry.ticker}${renderKindBadge(locale, result.instrumentKinds.get(buildInstrumentKey(entry)))}`,
            market: renderDeclaredValue(locale, `trading.market.${entry.market}`),
          })}`
      ),
    ],
    // List-only: the `add`/`remove` writes never pay a round-trip for a price they do not show.
    [`${INDENT[1]}${t(locale, 'trading.render.watchlist.next')}`],
  ])
}
