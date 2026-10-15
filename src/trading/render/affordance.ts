import type { Affordance } from '@/core/types/command'
import type { Locale } from '@/core/types/locale'
import type { MarketRef } from '@/trading/kernel/instrument'
import { t } from '@/i18n'
import { renderDeclaredValue, SECTION_ICONS } from '@/trading/render/format'

/** What each command offers next, in one place so two surfaces cannot offer different things after
 *  the same read. Every entry is a command the reader could have typed: the button is a shortcut,
 *  never a capability of its own, and it carries no state - a tap tomorrow re-runs against
 *  tomorrow's book. */
export function bookAffordances(locale: Locale): readonly Affordance[] {
  return [
    {
      icon: SECTION_ICONS.advice,
      label: t(locale, 'trading.render.affordance.rebalance'),
      command: '/rebalance',
    },
    {
      icon: SECTION_ICONS.ledger,
      label: t(locale, 'trading.render.affordance.transactions'),
      command: '/transactions',
    },
  ]
}

export function planAffordances(locale: Locale): readonly Affordance[] {
  return [
    {
      icon: SECTION_ICONS.portfolio,
      label: t(locale, 'trading.render.affordance.portfolio'),
      command: '/portfolio',
    },
    {
      icon: SECTION_ICONS.screen,
      label: t(locale, 'trading.render.affordance.screen'),
      command: '/screen',
    },
  ]
}

/** One per market the read covers, so a block cut to a headline keeps the command that prints it in
 *  full beside it. */
export function marketAffordances(
  locale: Locale,
  markets: readonly MarketRef[]
): readonly Affordance[] {
  return markets.map((market) => ({
    label: renderDeclaredValue(locale, `trading.market.${market}`),
    command: `/market ${market}`,
  }))
}

/** The page after this one, over the same days. Absent where the store answered with no cursor,
 *  which is the last page. */
export function pageAffordances(
  locale: Locale,
  cursor: string | undefined,
  range?: string
): readonly Affordance[] {
  if (cursor === undefined) {
    return []
  }

  const args = range === undefined ? cursor : `${range} ${cursor}`

  return [
    {
      icon: SECTION_ICONS.ledger,
      label: t(locale, 'trading.render.affordance.older'),
      command: `/transactions ${args}`,
    },
  ]
}
