import type { Locale } from '@/core/types/locale'
import type { InstrumentKind } from '@/trading/kernel/instrument'
import { t } from '@/i18n'
import { ETF_KIND } from '@/trading/kernel/instrument'

/** One kind is named on a row, and it is the one a segment puts a ceiling on: a tracker read as a
 *  stock pick is the misreading the ceiling exists to prevent. Every other kind, and a row whose
 *  kind never resolved, prints bare — no badge beats a guessed one. */
export function renderKindBadge(
  locale: Locale,
  instrumentKind: InstrumentKind | undefined
): string {
  return instrumentKind === ETF_KIND ? ` (${t(locale, 'trading.render.kind.etf')})` : ''
}
