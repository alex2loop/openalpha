import type { Locale } from '@/core/types/locale'
import type { MessageKey } from '@/i18n'
import type { MarketRef, Region } from '@/trading/kernel/instrument'
import { t } from '@/i18n'
import { renderDeclaredValue } from '@/trading/render/format'
import { INLINE_SEPARATOR } from '@/trading/render/layout'

// The arm of a discriminated tool input, in the operator's language. Shared across tools because
// the same verbs recur: an alert and a brief are both disabled, and one word must not read two ways.
const ACTION_KEYS = {
  add: 'tools.actionAdd',
  create: 'tools.actionCreate',
  disable: 'tools.actionDisable',
  enable: 'tools.actionEnable',
  list: 'tools.actionList',
  remove: 'tools.actionRemove',
  show: 'tools.actionShow',
} as const satisfies Record<string, MessageKey>

type ToolAction = keyof typeof ACTION_KEYS

/** A tool call line names the scope it acted on the way every other surface names one: a market
 *  printed as its raw ref is the one place `equity-vn` would reach a reader unrendered. */
export function renderMarketName(locale: Locale, market: MarketRef): string {
  return renderDeclaredValue(locale, `trading.market.${market}`)
}

export function renderRegionName(locale: Locale, region: Region): string {
  return renderDeclaredValue(locale, `trading.region.${region}`)
}

export function renderToolAction(locale: Locale, action: ToolAction): string {
  return t(locale, ACTION_KEYS[action])
}

/** Joins the scope parts a call carried, dropping the ones it did not. Absent is not empty: a news
 *  call naming no ticker is a market call, and printing a gap for it would read as a missing name. */
export function joinToolDetail(parts: readonly (string | undefined)[]): string | undefined {
  const present = parts.filter((part): part is string => part !== undefined && part !== '')

  return present.length === 0 ? undefined : present.join(INLINE_SEPARATOR)
}
