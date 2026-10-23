import type { WireEvent } from '@/app/server/wire/events'
import type { BusEventMap, EventBus } from '@/core/events'
import type { Locale } from '@/core/types/locale'
import '@/app/events'
import { NOTED_NORMALIZERS } from '@/app/server/ws/wire-events'
import { renderEntryFillNotice, renderExitFillNotice } from '@/trading/api'

interface FillFeedDeps {
  readonly bus: EventBus
  readonly broadcast: (event: WireEvent) => void
  readonly locale: Locale
}

/** A fill reaches the page once, from the bus: the chat notice a resting exit also sends is not
 *  mirrored, so a page never hears the same fill twice. */
export function followFills({ bus, broadcast, locale }: FillFeedDeps): (() => void)[] {
  return [
    bus.on('order_filled', (e) => {
      broadcast(NOTED_NORMALIZERS.order_filled(e, toFillNote(e, locale)))
    }),
  ]
}

/** A sale says which exit filled and that the ledger holds it; a buy only that it filled, since the
 *  `/trade` reply already carried the figures. */
export function toFillNote(e: BusEventMap['order_filled'], locale: Locale): string {
  if (e.side === 'buy') {
    return renderEntryFillNotice(locale, e)
  }

  return renderExitFillNotice(locale, {
    kind: 'exit-filled',
    fill: {
      instrument: e.instrument,
      venue: e.venue,
      quantity: e.quantity,
      unitPrice: e.unitPrice,
      currency: e.currency,
      ...(e.closeReason === undefined ? {} : { closeReason: e.closeReason }),
    },
  })
}
