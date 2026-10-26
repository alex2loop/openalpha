import { type ReadonlySignal, signal } from '@preact/signals'

import type { ReconcileResponse } from '@/app/server/wire/money'
import type {
  ConfirmOrderResponse,
  StagedOrderWire,
  TradeStatusResponse,
} from '@/app/server/wire/orders'
import { ApiFailure, getJson, sendJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { state } from '@/web/state/session'
import { markLedgerChanged } from '@/web/state/trade'

// A refusal is a 4xx: the daemon read the request and did nothing. No status, or a 5xx, may have
// come after the daemon acted.
const REFUSAL_STATUS_MIN = 400
const REFUSAL_STATUS_MAX = 499

export type ReconcileMismatch = ReconcileResponse['venues'][number]['mismatches'][number]

/** The last confirm: the daemon's answer, its refusal, or `uncertain` when no answer came back. */
export type PlaceAnswer =
  | { readonly kind: 'answered'; readonly venue: string; readonly response: ConfirmOrderResponse }
  | { readonly kind: 'refused'; readonly failure: ApiFailure }
  | { readonly kind: 'uncertain' }

/** A venue's last sync: the daemon's reply, its refusal, or `slow` when no answer came in time. */
export type SyncAnswer =
  | { readonly kind: 'answered'; readonly text: string }
  | { readonly kind: 'refused'; readonly failure: ApiFailure }
  | { readonly kind: 'slow' }

// Module-level so a tab or dialog closed mid-request cannot offer the same send again on reopening;
// each entry leaves when its answer comes, and the answers are one per venue and one in all.
const placing = signal<ReadonlySet<string>>(new Set())
const placed = signal<PlaceAnswer | undefined>(undefined)
const syncing = signal<ReadonlySet<string>>(new Set())
const synced = signal<ReadonlyMap<string, SyncAnswer>>(new Map())

/** Tokens whose confirm is on its way: their Đặt lệnh stays disabled. */
export const placingTokens: ReadonlySignal<ReadonlySet<string>> = placing
export const placeAnswer: ReadonlySignal<PlaceAnswer | undefined> = placed
/** Venues whose sync is on its way. */
export const syncingVenues: ReadonlySignal<ReadonlySet<string>> = syncing
export const syncAnswers: ReadonlySignal<ReadonlyMap<string, SyncAnswer>> = synced

export function readTrade(abort: AbortSignal): Promise<TradeStatusResponse> {
  return getJson(ROUTES.trade, { signal: abort })
}

export function readReconcile(abort: AbortSignal): Promise<ReconcileResponse> {
  return getJson(ROUTES.reconcile, { signal: abort })
}

/** Sends the confirm once. The token stays marked until an answer comes, so nothing sends it again;
 *  a lost answer reads as `uncertain`, never as a resend (the token is spent either way). */
export async function placeOrder(order: StagedOrderWire): Promise<void> {
  if (placing.value.has(order.token)) {
    return
  }

  placing.value = withKey(placing.value, order.token)
  placed.value = undefined

  try {
    const response = await sendJson('POST', ROUTES.tradeConfirm(order.token))

    placed.value = { kind: 'answered', venue: order.venue, response }
  } catch (error: unknown) {
    placed.value = isRefusal(error) ? { kind: 'refused', failure: error } : { kind: 'uncertain' }
  } finally {
    placing.value = withoutKey(placing.value, order.token)
  }
}

export function clearPlaceAnswer(): void {
  placed.value = undefined
}

export async function discardOrder(token: string): Promise<void> {
  await sendJson('DELETE', ROUTES.tradeStaged(token))
}

export async function cancelExit(ticker: string, venue: string): Promise<void> {
  await sendJson('DELETE', ROUTES.tradeExit(ticker, venue))
}

export async function setBuyingHalted(halted: boolean): Promise<void> {
  await sendJson('POST', ROUTES.tradeHalt, { body: { halted } })
}

/** Books the venue's fills once; a second click while it runs sends nothing. Whatever the answer, the
 *  book is read again, since a sync that timed out here may still be booking. */
export async function syncVenue(venue: string): Promise<void> {
  if (syncing.value.has(venue)) {
    return
  }

  syncing.value = withKey(syncing.value, venue)

  try {
    synced.value = new Map([...synced.value, [venue, await sendSync(venue)]])
    await markLedgerChanged()
  } finally {
    syncing.value = withoutKey(syncing.value, venue)
  }
}

/** A cash mismatch is corrected by moving cash, never by a trade: the venue holding more is a
 *  deposit the ledger missed, holding less a withdrawal. `delta` is book minus venue. */
export function toCashKind(mismatch: ReconcileMismatch): 'deposit' | 'withdrawal' | undefined {
  if (!mismatch.cash) {
    return undefined
  }

  return mismatch.delta < 0 ? 'deposit' : 'withdrawal'
}

async function sendSync(venue: string): Promise<SyncAnswer> {
  try {
    const answer = await sendJson('POST', ROUTES.ledgerSync, { body: { venue } })

    await clearSettledOrders()

    return { kind: 'answered', text: answer.text }
  } catch (error: unknown) {
    return isRefusal(error) ? { kind: 'refused', failure: error } : { kind: 'slow' }
  }
}

// Fills the sync just booked clear their unmirrored rows now rather than on the daemon's next pass.
async function clearSettledOrders(): Promise<void> {
  if (state.value?.capabilities.orders !== true) {
    return
  }

  await sendJson('POST', ROUTES.tradeReconcile).catch(() => {
    // The daemon's own pass clears them later; the sync itself already answered.
  })
}

function isRefusal(error: unknown): error is ApiFailure {
  return (
    error instanceof ApiFailure &&
    error.status >= REFUSAL_STATUS_MIN &&
    error.status <= REFUSAL_STATUS_MAX
  )
}

function withKey(keys: ReadonlySet<string>, key: string): ReadonlySet<string> {
  return new Set([...keys, key])
}

function withoutKey(keys: ReadonlySet<string>, key: string): ReadonlySet<string> {
  return new Set([...keys].filter((kept) => kept !== key))
}
