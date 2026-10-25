import type { AlertWire } from '@/app/server/wire/market'
import type { InstrumentRefWire } from '@/app/server/wire/trading'
import type { WatchlistUpdateResponse } from '@/app/server/wire/watchlist'
import { sendJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { alertsBlock, profileBlock, quotesBlock } from '@/web/state/market'

/** The name as the daemon takes it when two markets may share a ticker: `market:ticker`. */
export function qualifyName(instrument: InstrumentRefWire): string {
  return `${instrument.market}:${instrument.ticker}`
}

/** Puts `name` (as typed, or qualified) on the watchlist; the daemon says which it found. */
export async function addWatch(name: string): Promise<WatchlistUpdateResponse> {
  const answer = await sendJson('POST', ROUTES.watchlist, { body: { add: [name] } })

  refreshWatch()

  return answer
}

export async function removeWatch(instrument: InstrumentRefWire): Promise<void> {
  await sendJson('POST', ROUTES.watchlist, { body: { remove: [qualifyName(instrument)] } })
  refreshWatch()
}

/** Turns the alert off; the daemon's answer says whether it was still there to turn off. */
export async function disableAlert(alertId: string): Promise<'disabled' | 'gone'> {
  const { result } = await sendJson('DELETE', ROUTES.alertRow(alertId))

  alertsBlock.retry()

  return result === 'disabled' ? 'disabled' : 'gone'
}

/** Sets the same alert again, as a new one. */
export async function restoreAlert(alert: AlertWire): Promise<void> {
  await sendJson('POST', ROUTES.alertCreate, {
    body: {
      instrument: alert.instrument,
      condition: alert.condition,
      threshold: alert.threshold,
    },
  })
  alertsBlock.retry()
}

function refreshWatch(): void {
  profileBlock.retry()
  quotesBlock.retry()
}
