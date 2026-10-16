import type { Locale } from '@/core/types/locale'
import type { RenderView } from '@/trading/features/suggestion/render/view'
import type {
  ActionableStoredSuggestion,
  StoredSuggestion,
} from '@/trading/features/suggestion/types'
import type { QuotedIn } from '@/trading/render/money'
import { formatDay, t } from '@/i18n'
import { isInconclusive, renderHoldReason } from '@/trading/features/suggestion/render/verdict'
import { framedDirectionOf, isRecordedPlan } from '@/trading/features/suggestion/types'
import {
  formatAmount,
  formatFraction,
  formatQuantity,
  renderDeclaredValue,
} from '@/trading/render/format'
import { INDENT } from '@/trading/render/layout'
import { formatMoney, quotedInOf } from '@/trading/render/money'

/** The headline `/suggest` opens with. An inconclusive debate may not claim a verdict. */
export function verdictOf(view: RenderView, suggestion: StoredSuggestion): string {
  if (isInconclusive(suggestion)) {
    return t(view.locale, 'trading.render.suggestion.holdInconclusive', {
      ticker: suggestion.instrument.ticker,
      at: formatDay(view.locale, suggestion.at),
    })
  }

  return holdOrActionVerdict(view, suggestion)
}

/** A trader's wait never holds a run - `declineReasonOf` does not count it - so a hold that carries
 *  one was held by something else, and the headline defers to the reasons printed under it. */
function holdOrActionVerdict(view: RenderView, suggestion: StoredSuggestion): string {
  const { locale } = view

  if (suggestion.action !== 'hold') {
    return renderActionable(view, suggestion)
  }

  const arm = recordedOrFramedArm(suggestion)

  return t(locale, `trading.render.suggestion.hold${arm}`, {
    ticker: suggestion.instrument.ticker,
    at: formatDay(locale, suggestion.at),
  })
}

/** A recorded plan is levels the system set, not a verdict, so its header may not read as one. A
 *  declined buy on a name already owned is a declined add: the holding stands on its exit plan. */
function recordedOrFramedArm(suggestion: StoredSuggestion): '' | 'Held' | 'Reduce' | 'Recorded' {
  if (isRecordedPlan(suggestion)) {
    return 'Recorded'
  }

  if (framedDirectionOf(suggestion) === 'reduce') {
    return 'Reduce'
  }

  return suggestion.held === undefined ? '' : 'Held'
}

/** The header already says no call was made, and the banner under it says why; `debate-unresolved`
 *  repeated below would read as a third, weaker statement of the same fact. Every other hold reason
 *  survives — those name something the header does not. */
export function holdReasonLines(
  locale: Locale,
  suggestion: StoredSuggestion,
  inconclusive: boolean
): readonly string[] {
  if (suggestion.action !== 'hold') {
    return []
  }

  return suggestion.holdReasonCodes
    .filter((code) => !inconclusive || code !== 'debate-unresolved')
    .map((code) => `${INDENT[1]}${renderHoldReason(locale, code)}`)
}

/** The size clause exists only when a size does. An unvalued book still gets the call and a caveat
 *  saying why no size travelled with it. The levels follow as their own rows, and the verb sits in
 *  capitals in each arm's own copy, as `/rebalance` writes MUA and BÁN. */
function renderActionable(view: RenderView, suggestion: ActionableStoredSuggestion): string {
  const { locale } = view
  const arm = suggestion.action === 'reduce' ? 'Reduce' : ''
  const params = {
    ticker: suggestion.instrument.ticker,
    at: formatDay(locale, suggestion.at),
    conviction: renderDeclaredValue(locale, `trading.conviction.${suggestion.conviction}`),
  }

  if (suggestion.sizePctNav === undefined) {
    return t(locale, `trading.render.suggestion.actionableUnsized${arm}`, params)
  }

  const sized = { ...params, size: formatFraction(locale, suggestion.sizePctNav) }

  return suggestion.units === undefined
    ? t(locale, `trading.render.suggestion.actionable${arm}`, sized)
    : t(locale, `trading.render.suggestion.actionableSized${arm}`, {
        ...sized,
        shares: formatQuantity(locale, suggestion.units),
        amount: orderValue(locale, suggestion, suggestion.units),
      })
}

/** Labelled with its currency, never board-scaled: two scales in one sentence read as one. Money,
 *  not a bare magnitude — `formatMoney` prints the currency's own minor units, so a đồng total never
 *  claims two decimals it has no denomination for. */
function orderValue(locale: Locale, suggestion: ActionableStoredSuggestion, units: number): string {
  const value = units * suggestion.entry
  const currency = suggestion.quote?.currency

  return currency === undefined ? formatAmount(locale, value) : formatMoney(locale, value, currency)
}

/** The convention a level prints in: the currency the suggestion was quoted in, under the market's
 *  own unit and board scale. Absent when neither is known, and the level then prints bare rather
 *  than labelled with a currency nobody quoted. */
export function levelQuote(view: RenderView, suggestion: StoredSuggestion): QuotedIn | undefined {
  const currency = suggestion.quote?.currency ?? view.quote?.currency

  return currency === undefined ? undefined : { currency, ...quotedInOf(view.quote) }
}
