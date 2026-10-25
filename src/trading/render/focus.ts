import type { Locale } from '@/core/types/locale'
import type { AgentFocus } from '@/trading/kernel/operator/focus'
import { renderDeclaredValue, renderProvidedValue } from '@/trading/render/format'
import { INLINE_SEPARATOR } from '@/trading/render/layout'
import { renderMarketName } from '@/trading/render/tool-detail'

/** A focus as its owner reads it: the markets, the sectors and the horizon it narrows to and the goal
 *  it hunts for, or the operator's own focus when it declares nothing. */
export function renderFocusLabel(locale: Locale, focus: AgentFocus | undefined): string {
  if (focus === undefined) {
    return renderDeclaredValue(locale, 'trading.focus.default')
  }

  return [
    ...(focus.markets ?? []).map((market) => renderMarketName(locale, market)),
    ...(focus.sectors ?? []).map((sector) =>
      renderProvidedValue(locale, `trading.sector.${sector}`, sector)
    ),
    ...(focus.horizon === undefined
      ? []
      : [renderDeclaredValue(locale, `trading.horizon.${focus.horizon}`)]),
    ...(focus.goal === undefined
      ? []
      : [renderDeclaredValue(locale, `trading.goal.${focus.goal}`)]),
  ].join(INLINE_SEPARATOR)
}
