import { useEffect } from 'preact/hooks'

import type { AlertsResponse, AlertWire } from '@/app/server/wire/market'
import type { InstrumentRefWire } from '@/app/server/wire/trading'
import type { WatchlistUpdateResponse } from '@/app/server/wire/watchlist'
import { sendJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { type BlockReading, readBlock } from '@/web/state/block'
import { alertsBlock, profileBlock, quotesBlock } from '@/web/state/market'
import { tr } from '@/web/text/tr'

// Alerts fire while the page is open, so a list on screen is read again at this period.
const ALERTS_POLL_MS = 60_000

/** The alerts, read while the component is mounted: only the Watch tab and a ticker card show them. */
export function useAlerts(): BlockReading<AlertsResponse> {
  useEffect(() => alertsBlock.start(ALERTS_POLL_MS), [])

  return readBlock(alertsBlock)
}

/** The name as the daemon takes it when two markets may share a ticker: `market:ticker`. */
export function qualifyName(instrument: InstrumentRefWire): string {
  return `${instrument.market}:${instrument.ticker}`
}

/** Puts `name` (as typed, or qualified) on the watchlist. Resolves with the daemon's refusal in
 *  plain words when it could not place the name, nothing when it is on the list. */
export async function addWatch(name: string): Promise<string | undefined> {
  const answer = await sendJson('POST', ROUTES.watchlist, { body: { add: [name] } })

  refreshWatch()

  return describeRefusal(answer, name)
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

// A name the daemon placed is on the list; one it could not place says so, in plain words.
function describeRefusal(answer: WatchlistUpdateResponse, typed: string): string | undefined {
  if (answer.message !== undefined) {
    return answer.message
  }

  if (answer.ambiguous.length > 0) {
    return tr('ui.office.book.addAmbiguous', { name: typed })
  }

  return answer.unknown.length > 0 ? tr('ui.office.book.addUnknown', { name: typed }) : undefined
}

function refreshWatch(): void {
  profileBlock.retry()
  quotesBlock.retry()
}
