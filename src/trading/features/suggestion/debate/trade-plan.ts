import type { z } from 'zod'

import type { Locale } from '@/core/types/locale'
import type { MessageKey } from '@/i18n'
import type { DebateContext } from '@/trading/features/suggestion/debate/call'
import type { TradePlan } from '@/trading/features/suggestion/debate/types'
import type { TRADE_PLAN_SCHEMA } from '@/trading/features/suggestion/pipeline/schemas'
import type { MarketManifest } from '@/trading/markets/types'
import { t } from '@/i18n'

type TradePlanWire = z.infer<typeof TRADE_PLAN_SCHEMA>
type EntryCondition = TradePlanWire['entryConditions'][number]
type ConditionState = 'met' | 'ungated' | 'open'

interface ReadCondition {
  readonly text: string
  readonly state: ConditionState
}

/** A condition the order already meets is dropped: the price trading now clears a level above, and
 *  the order's own price - a resting limit sits under the quote - a level below. One that only
 *  times or grades the entry stays as advice but holds nothing. A wait left with nothing to wait
 *  for is an entry, and its timing is restated because the role's own words argued for the wait. */
export function toTradePlan(raw: TradePlanWire, context: DebateContext): TradePlan {
  const prices = quotedPrices(context)
  const conditions = raw.entryConditions.map((condition) => ({
    text: condition.text,
    state: conditionStateOf(condition, prices, context.market.manifest),
  }))
  const cleared =
    raw.stance === 'wait' &&
    conditions.length > 0 &&
    conditions.every((condition) => condition.state !== 'open')

  return {
    stance: cleared ? 'enter' : raw.stance,
    entryTiming: cleared
      ? clearedTiming(conditions, context.input.request.locale)
      : raw.entryTiming,
    entryConditions: cleared ? [] : textsIn(conditions, ['open', 'ungated']),
    sizingIntent: raw.sizingIntent,
    notes: raw.notes,
  }
}

interface QuotedPrices {
  /** The price trading now, which a level to clear above is met by. */
  readonly now: number | undefined
  /** The order's own price, which a level to dip below is met by: the limit on a resting entry. */
  readonly fill: number | undefined
}

/** Both on the board's own scale, which is the scale the trader writes a level back in. */
function quotedPrices(context: DebateContext): QuotedPrices {
  const divisor = context.market.manifest.priceDisplay?.divisor ?? 1
  const levels = context.input.proposedLevels
  const quote = context.input.draft.quote?.price
  const fill = levels === undefined ? undefined : levels.entry / divisor
  const now = levels?.resting !== undefined && quote !== undefined ? quote / divisor : fill

  return { now, fill }
}

function conditionStateOf(
  condition: EntryCondition,
  prices: QuotedPrices,
  manifest: MarketManifest
): ConditionState {
  if (isMet(condition, prices)) {
    return 'met'
  }

  return isGating(condition, manifest) ? 'open' : 'ungated'
}

function kindOf(condition: EntryCondition): string | undefined {
  return condition.kind?.trim().toLowerCase()
}

/** Only a price condition is met by the price; a reading or an event carrying a stray level is not. */
function isMet(condition: EntryCondition, prices: QuotedPrices): boolean {
  const above = condition.above ?? undefined
  const below = condition.below ?? undefined

  if (kindOf(condition) !== 'price' || (above === undefined && below === undefined)) {
    return false
  }

  return (
    (above === undefined || (prices.now !== undefined && prices.now >= above)) &&
    (below === undefined || (prices.fill !== undefined && prices.fill <= below))
  )
}

/** A clock only says when to place the order, and volume only grades a breakout where the market
 *  measured it doing so. */
function isGating(condition: EntryCondition, manifest: MarketManifest): boolean {
  const kind = kindOf(condition)

  if (kind === 'timing') {
    return false
  }

  return !(kind === 'volume' && manifest.volumeGradesBreakout === true)
}

function clearedTiming(conditions: readonly ReadCondition[], locale: Locale): string {
  return [
    ...clearedLine(locale, 'trading.debate.waitCleared', textsIn(conditions, ['met'])),
    ...clearedLine(locale, 'trading.debate.waitUngated', textsIn(conditions, ['ungated'])),
  ].join(' ')
}

function clearedLine(locale: Locale, key: MessageKey, texts: readonly string[]): readonly string[] {
  return texts.length === 0 ? [] : [t(locale, key, { conditions: texts.join('; ') })]
}

function textsIn(
  conditions: readonly ReadCondition[],
  states: readonly ConditionState[]
): readonly string[] {
  return conditions
    .filter((condition) => states.includes(condition.state))
    .map((condition) => condition.text)
}
