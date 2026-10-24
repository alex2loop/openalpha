import { z } from 'zod'

import type { NoteWire } from '@/app/server/wire/digest'
import type { Locale } from '@/core/types/locale'
import type { NoticeRow } from '@/persistence/api'
import type { DayDigestView, MarketView } from '@/trading/api'
import { formatDay, t } from '@/i18n'
import { formatClock, formatPriceIn, formatSignedFixedFraction, quotedInOf } from '@/trading/api'

type ClosedCall = DayDigestView['closed'][number]

/** What the notes are written with: the operator's language and clock, and how each market prints
 *  a price. */
interface NoteContext {
  readonly locale: Locale
  readonly timezone: string
  readonly markets: readonly MarketView[]
}

const STOP_EVENT = z.object({
  alert: z.object({
    instrument: z.object({ market: z.string(), ticker: z.string() }),
    threshold: z.number(),
  }),
})

/** `undefined` for a row whose stored event is not the stop the daemon wrote, which is left out
 *  rather than shown half-formed. */
export function toStopNote(row: NoticeRow, context: NoteContext): NoteWire | undefined {
  const event = parseStopEvent(row.event)

  if (event === undefined) {
    return undefined
  }

  const { instrument, threshold } = event.alert
  const market = context.markets.find((entry) => entry.market === instrument.market)
  const level = formatPriceIn(
    context.locale,
    threshold,
    market === undefined ? {} : { currency: market.currency, ...quotedInOf(market) }
  )

  return {
    kind: 'stop',
    ticker: instrument.ticker,
    at: row.createdAt,
    text: t(context.locale, 'ui.digest.stopFired', {
      ticker: instrument.ticker,
      level,
      time: formatClock(context.locale, row.createdAt, context.timezone),
    }),
  }
}

export function toCallNote(call: ClosedCall, locale: Locale): NoteWire {
  const { ticker } = call.instrument

  return {
    kind: 'call',
    ticker,
    at: call.outcome.resolvedAt,
    text: t(locale, 'ui.digest.callClosed', {
      action: t(locale, `trading.action.${call.action}`),
      ticker,
      day: formatDay(locale, call.at),
      result: formatSignedFixedFraction(locale, call.outcome.returnPct),
    }),
  }
}

function parseStopEvent(raw: string): z.infer<typeof STOP_EVENT> | undefined {
  try {
    const parsed = STOP_EVENT.safeParse(JSON.parse(raw))

    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}
