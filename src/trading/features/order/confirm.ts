import type {
  ConfirmOutcome,
  OrderRequest,
  OrderService,
  StagedOrder,
} from '@/trading/features/order/types'
import { exitLevelsOf } from '@/trading/features/order/types'

type ConfirmParts = Pick<OrderService, 'claim' | 'prepare' | 'execute'>
type ConfirmInput = Parameters<OrderService['confirm']>[0]

/** Confirming is the operator answering this exact staged order, so it is the approval and runs
 *  `manual`. The claim consumes the token before the re-price, so a refused confirm stays used: a
 *  token never places twice, and the operator stages again. */
async function confirm(parts: ConfirmParts, input: ConfirmInput): Promise<ConfirmOutcome> {
  const staged = await parts.claim(input)

  if (staged === undefined) {
    return { kind: 'unknown-token' }
  }

  const prepared = await parts.prepare({
    request: toOrderRequest(staged),
    stagedQuote: staged.quotePrice,
    now: input.now,
    signal: input.signal,
  })

  if (prepared.rejections.length > 0) {
    return { kind: 'rejected', staged, prepared }
  }

  const executed = await parts.execute({
    staged,
    prepared,
    approvalMode: 'manual',
    now: input.now,
    signal: input.signal,
  })

  return { kind: 'executed', staged, prepared, executed }
}

/** The staged terms, re-priced: the row carries what the operator asked for, and `prepare` decides
 *  again whether it may go out. */
function toOrderRequest(staged: StagedOrder): OrderRequest {
  const exit = exitLevelsOf(staged)

  return {
    ticker: staged.instrument.ticker,
    venue: staged.venue,
    side: staged.side,
    orderType: staged.orderType,
    quantity: staged.quantity,
    ...(staged.limitPrice === undefined ? {} : { limitPrice: staged.limitPrice }),
    ...(exit === undefined ? {} : { exit }),
  }
}

/** What a surface does with a staged order: place it, or drop it. Dropping is a claim that places
 *  nothing, so a dropped token can no more be confirmed than a used one. */
export function createOrderConfirm(parts: ConfirmParts): Pick<OrderService, 'confirm' | 'discard'> {
  return {
    confirm: (input) => confirm(parts, input),
    discard: async (input) => (await parts.claim(input)) !== undefined,
  }
}
