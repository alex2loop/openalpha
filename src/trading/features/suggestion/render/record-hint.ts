import type { Locale } from '@/core/types/locale'
import type { StoredSuggestion } from '@/trading/features/suggestion/types'
import type { VenueRef } from '@/trading/kernel/instrument'
import type { QuoteConvention } from '@/trading/render/money'
import { t } from '@/i18n'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { isBookCall } from '@/trading/kernel/operator/focus'
import { formatCommandNumber } from '@/trading/render/format'
import { INDENT } from '@/trading/render/layout'
import { isBoardScaled } from '@/trading/render/money'

/** More than one venue can hold the market, and the operator picks: the hint offers them rather
 *  than choosing a custodian on their behalf. */
const VENUE_ALTERNATIVE_SEPARATOR = '|'

interface RecordHintInput {
  readonly locale: Locale
  readonly suggestion: StoredSuggestion
  /** Every venue that holds the suggestion's market, so the hint can name where the fill will sit. */
  readonly venues: readonly VenueRef[]
  readonly quote?: QuoteConvention
}

/** The stored price, not the board-formatted one: the ledger parser reads full currency units. On
 *  a board market the message names that unit, because the levels above are quoted on the board's
 *  scale and a reader who "corrects" this price to match them records the fill off by the divisor.
 *  Where no board exists the two are the same number, so the warning is dropped. */
export function renderRecordHint(input: RecordHintInput): readonly string[] {
  const { locale, suggestion, venues } = input
  const currency = suggestion.quote?.currency

  if (
    suggestion.action === 'hold' ||
    !isBookCall(suggestion) ||
    suggestion.units === undefined ||
    currency === undefined ||
    venues.length === 0
  ) {
    return []
  }

  const instrument = buildInstrumentKey(suggestion.instrument)
  const side = suggestion.action === 'reduce' ? 'sell' : 'buy'
  const venue = venues.join(VENUE_ALTERNATIVE_SEPARATOR)
  const units = formatCommandNumber(suggestion.units)
  const entry = formatCommandNumber(suggestion.entry)
  const day = suggestion.orderSession ?? suggestion.at
  const command = `/record ${side} ${venue} ${instrument} ${units} ${entry} ${currency} ${day}`
  const key = isBoardScaled(input.quote?.display) ? 'recordHintBoard' : 'recordHint'

  return [`${INDENT[1]}${t(locale, `trading.render.suggestion.${key}`, { command, currency })}`]
}
