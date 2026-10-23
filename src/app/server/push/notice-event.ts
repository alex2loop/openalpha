import type { WireEvent } from '@/app/server/wire/events'
import type { TradingNotice } from '@/trading/api'
import { APP_SOURCE } from '@/app/server/channel'
import { parseExitLevel } from '@/trading/api'

type Payload = TradingNotice['payload']
type AlertPayload = Extract<Payload, { readonly kind: 'price-alert' | 'exit-alert' }>

function alertEvent(payload: AlertPayload, text: string): WireEvent {
  const { alert } = payload
  const level = payload.kind === 'exit-alert' ? parseExitLevel(alert.origin) : null

  return {
    v: 1,
    kind: level === 'stop' ? 'stop_breached' : 'alert_fired',
    weight: level === 'stop' ? 'interrupt' : 'nudge',
    wake: true,
    source: APP_SOURCE,
    note: text,
    alert: {
      alertId: alert.id,
      instrument: { market: alert.instrument.market, ticker: alert.instrument.ticker },
      condition: alert.condition,
      threshold: alert.threshold,
      observedPrice: alert.observedPrice,
      ...(level === null ? {} : { level }),
    },
  }
}

function moverEvent(
  payload: Extract<Payload, { readonly kind: 'screener-alert' }>,
  text: string
): WireEvent {
  const { alert, session } = payload

  return {
    v: 1,
    kind: 'mover',
    weight: 'nudge',
    source: APP_SOURCE,
    note: text,
    mover: {
      instrument: { market: alert.instrument.market, ticker: alert.instrument.ticker },
      condition: alert.condition,
      observedPrice: alert.observedPrice,
      ...(session === undefined ? {} : { movePct: session.movePct }),
      ...(session?.benchmark === undefined ? {} : { benchmark: { ...session.benchmark } }),
    },
  }
}

/** A scheduled result only flashes by; any other notice (a delivery turned off, a restated
 *  series) asks for the operator. */
function noteEvent(kind: 'schedule_result' | 'notice', text: string): WireEvent {
  return {
    v: 1,
    kind,
    weight: kind === 'notice' ? 'nudge' : 'sneak',
    source: APP_SOURCE,
    note: text,
  }
}

/** A typed notice becomes its own event; anything else still reaches the app as the text a chat
 *  would have got, so no notice is lost for want of a dedicated kind. A filled exit is the one
 *  notice with no event of its own: the fill listener sends `order_filled` for every fill, and a
 *  second event for the same sale would show it twice. */
export function toWireEvent(message: {
  readonly text: string
  readonly notice?: TradingNotice
}): WireEvent | undefined {
  const payload = message.notice?.payload

  switch (payload?.kind) {
    case undefined:
      return noteEvent('schedule_result', message.text)

    case 'exit-filled':
      return undefined

    case 'price-alert':
    case 'exit-alert':
      return alertEvent(payload, message.text)

    case 'screener-alert':
      return moverEvent(payload, message.text)

    case 'brief':
      return {
        v: 1,
        kind: 'brief_ready',
        weight: 'nudge',
        source: APP_SOURCE,
        note: message.text,
        brief: { snapshotId: payload.snapshot.id, day: payload.snapshot.asOf },
      }

    default:
      return noteEvent('notice', message.text)
  }
}
