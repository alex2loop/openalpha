import { type ReadonlySignal, signal } from '@preact/signals'

import type {
  LedgerEntryWire,
  LedgerPreviewResponse,
  LedgerWriteResponse,
} from '@/app/server/wire/money'
import type { TypedPrice } from '@/app/server/wire/vocab'
import { sendJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { holdingsBlock, stopsBlock } from '@/web/state/market'
import { loadSession } from '@/web/state/session'

/** What happened, as the ledger names it. */
export type LedgerKind = LedgerEntryWire['kind']

interface Instrument {
  readonly market: string
  readonly ticker: string
}

interface DraftBase {
  readonly at: string
  readonly note?: string
}

/** Sent only where the daemon's preview asked for a rate; anywhere else a rate is refused. */
interface StatedRate {
  readonly operatorFxRate?: number
  readonly fxRateConfirmed?: true
}

/** What the page sends for one row it records by hand: no order is placed. A trade's `fee` left
 *  out is priced by the venue's fee table. A dividend names no currency: its market's stands. */
export type LedgerDraft =
  | (DraftBase &
      StatedRate & {
        readonly kind: 'buy' | 'sell' | 'rights'
        readonly instrument: Instrument
        readonly venue: string
        readonly quantity: number
        readonly unitPrice: number
        readonly fee?: number
      })
  | (DraftBase & {
      readonly kind: 'dividend'
      readonly instrument: Instrument
      readonly venue: string
      readonly amount: number
    })
  | (DraftBase & {
      readonly kind: 'split' | 'distribution'
      readonly instrument: Instrument
      readonly venue: string
      readonly quantityDelta: number
    })
  | (DraftBase &
      StatedRate & {
        readonly kind: 'transfer'
        readonly fromVenue: string
        readonly venue: string
        readonly currency: string
        readonly amount: number
        readonly fee: number
      })
  | (DraftBase &
      StatedRate & {
        readonly kind: 'deposit' | 'withdrawal' | 'fee' | 'loss'
        readonly venue: string
        readonly currency: string
        readonly amount: number
      })

/** `typedPrice` rides only a row with a price: absent would skip the daemon's check of a price far
 *  from the market. */
interface TradeRequest {
  readonly draft: LedgerDraft
  readonly typedPrice?: TypedPrice
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

/** The day's market rate the row would ask for, absent where no rate applies. An edit names the
 *  row it `replacing`, which the book is read without. */
export async function previewLedger(
  request: { readonly draft: LedgerDraft; readonly replacing?: string },
  abort: AbortSignal
): Promise<LedgerPreviewResponse> {
  return sendJson('POST', ROUTES.ledgerPreview, { body: request, signal: abort })
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
