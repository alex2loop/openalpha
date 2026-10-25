import { type ReadonlySignal, signal } from '@preact/signals'

import type { LedgerEntryWire, LedgerWriteResponse } from '@/app/server/wire/money'
import type { TypedPrice } from '@/app/server/wire/vocab'
import { sendJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { holdingsBlock, stopsBlock } from '@/web/state/market'
import { loadSession } from '@/web/state/session'

export type TradeKind = 'buy' | 'sell'
/** A ledger row this page writes by hand and so may edit or delete. */
export type TradeEntry = Extract<LedgerEntryWire, { readonly quantity: number }>

/** What the page sends for one buy or sell it records by hand: no order is placed. `fee` left
 *  out is priced by the venue's fee table. */
export interface TradeDraft {
  readonly kind: TradeKind
  readonly at: string
  readonly instrument: { readonly market: string; readonly ticker: string }
  readonly venue: string
  readonly quantity: number
  readonly unitPrice: number
  readonly fee?: number
  readonly note?: string
}

interface TradeRequest {
  readonly draft: TradeDraft
  /** Always sent: absent would skip the daemon's check of a price far from the market. */
  readonly typedPrice: TypedPrice
}

const revision = signal(0)
const flashed = signal<string | undefined>(undefined)

/** Bumps on every ledger write, so a list on screen reads its first page again. */
export const ledgerRevision: ReadonlySignal<number> = revision
/** The row just saved, for Lịch sử to flash once. */
export const flashedEntry: ReadonlySignal<string | undefined> = flashed

/** Records the row under `idempotencyKey`: sending the same body again with it records nothing new. */
export async function recordTrade(
  request: TradeRequest,
  idempotencyKey: string
): Promise<LedgerWriteResponse> {
  const answer = await sendJson('POST', ROUTES.ledgerWrite, {
    body: request,
    headers: { 'Idempotency-Key': idempotencyKey },
  })

  await afterWrite(answer.entry.id)

  return answer
}

/** Replaces the whole row. */
export async function editTrade(
  entryId: string,
  request: TradeRequest
): Promise<LedgerWriteResponse> {
  const answer = await sendJson('PATCH', ROUTES.ledgerRow(entryId), { body: request })

  await afterWrite(answer.entry.id)

  return answer
}

export async function deleteTrade(entryId: string): Promise<void> {
  await sendJson('DELETE', ROUTES.ledgerRow(entryId))
  await afterWrite(undefined)
}

/** Only a buy or a sell: the other kinds (rights, cash, dividends) are written elsewhere. */
export function isTradeEntry(entry: LedgerEntryWire): entry is TradeEntry {
  return entry.kind === 'buy' || entry.kind === 'sell'
}

/** The draft that records `entry` again, for taking back a delete. */
export function toTradeDraft(entry: TradeEntry): TradeDraft {
  return {
    kind: entry.kind === 'sell' ? 'sell' : 'buy',
    at: entry.at,
    instrument: entry.instrument,
    venue: entry.venue,
    quantity: entry.quantity,
    unitPrice: entry.unitPrice,
    fee: entry.fee,
    ...(entry.note === undefined ? {} : { note: entry.note }),
  }
}

/** The row has flashed; Lịch sử no longer marks it. */
export function clearFlashedEntry(): void {
  flashed.value = undefined
}

// The book is a fold of the ledger: everything that reads it is read again, and the session says
// whether the first-run steps are done.
async function afterWrite(entryId: string | undefined): Promise<void> {
  flashed.value = entryId
  revision.value += 1
  holdingsBlock.retry()
  stopsBlock.retry()
  await loadSession(new AbortController().signal)
}
