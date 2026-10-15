import type { Locale } from '@/core/types/locale'
import type { InstrumentRef } from '@/trading/kernel/instrument'
import type { QuotedIn } from '@/trading/render/money'
import { t } from '@/i18n'
import { formatCommandNumber } from '@/trading/render/format'
import { INDENT } from '@/trading/render/layout'
import { formatPriceIn } from '@/trading/render/money'

/** The command that moves a resting exit, spelled as the order grammar reads it. */
const TRADE_EXIT_COMMAND = '/trade exit'

/** What stands at an exchange behind a raised stop: a stop left at the old level, nothing at all, a
 *  venue that takes orders whose book was not read, or only the operator's own broker or shop. */
export type StopPlacement = 'resting' | 'unguarded' | 'unread' | 'by-hand'

interface StopRaisedView {
  readonly instrument: InstrumentRef
  readonly from: number
  readonly to: number
  readonly quoted: Partial<QuotedIn>
  readonly placement: StopPlacement
}

/** A raised plan stop moves nothing at an exchange, so the lines say what to do with the order: the
 *  command that moves or sets it where one can rest, the level to carry by hand elsewhere. */
export function renderStopRaised(locale: Locale, view: StopRaisedView): readonly string[] {
  const { instrument, quoted } = view
  const to = formatPriceIn(locale, view.to, quoted)

  return [
    t(locale, 'trading.render.stopRaised.level', {
      ticker: instrument.ticker,
      from: formatPriceIn(locale, view.from, quoted),
      to,
    }),
    placementLine(locale, view, to),
  ].map((line) => `${INDENT[1]}${line}`)
}

function placementLine(locale: Locale, view: StopRaisedView, to: string): string {
  if (view.placement === 'by-hand') {
    return t(locale, 'trading.render.stopRaised.by-hand', { to })
  }

  const command = `${TRADE_EXIT_COMMAND} ${view.instrument.ticker} sl ${formatCommandNumber(view.to)}`

  return t(locale, `trading.render.stopRaised.${view.placement}`, { command })
}
