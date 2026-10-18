import { z } from 'zod'

import type { ToolDefinition, ToolInvocationContext, ToolResult } from '@/core/tool'
import type { Locale } from '@/core/types/locale'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { ExitCoverage, OrderRequest, OrderService } from '@/trading/features/order/types'
import type { Ticker } from '@/trading/kernel/instrument'
import type { CapBreach } from '@/trading/kernel/operator/exposure'
import { createTool } from '@/core/tool'
import { renderOrderLine } from '@/trading/features/order/render'
import { exitLevelsOf } from '@/trading/features/order/types'
import { isVenueRefShape, venueRef } from '@/trading/kernel/instrument'
import { fractionToPct, toAgentJson } from '@/trading/kernel/surface/agent-json'
import { noInput, PRICE_INPUT_UNITS } from '@/trading/kernel/surface/surface'
import { ledgerIdempotencyKey } from '@/trading/kernel/surface/tool-approval'
import { ORDER_SIDES } from '@/trading/kernel/venue/spot-adapter'
import { formatScaledPrice } from '@/trading/render/money'

const REASON_SEPARATOR = ', '
const CLAIM_REFUSED = 'order refused: the staged order was already used or has expired'
const CAP_BREACH_REFUSED =
  'order refused: this buy takes a holding past its cap. Tell the operator; they can review it and place it with /trade, which shows the breach before they confirm. Breaches:'

export function createOrderPlaceTool(
  order: OrderService,
  tickerSchema: z.ZodType<Ticker>
): ToolDefinition {
  return createTool({
    name: 'order_place',
    description:
      'Place one spot order on an operator exchange, with a take-profit and a stop-loss. ' +
      'A buy without a stop-loss is refused unless the operator turned `require_stop_loss` off. ' +
      'Every call asks the operator for approval first. ' +
      "When the suggestion's takeProfitTranchePct is below 1 (it sells only part at its take-profit and trails the rest), set only stopLoss: a takeProfit here would sell the whole position at that price. The take-profit alert prompts the partial sale.",
    inputSchema: orderPlaceInput(tickerSchema),
    capability: 'write',
    requiresApproval: () => true,
    // Two identical orders are two real fills, so a decision about one must not stand for the next.
    oneTimeApproval: true,
    presentation: {
      label: 'Place order',
      emoji: '🛒',
      detail: (input, locale) => renderOrderLine(locale, toOrderRequest(input)),
    },
    execute: (args, ctx) => placeOrder(order, toOrderRequest(args), ctx),
  })
}

function orderPlaceInput(tickerSchema: z.ZodType<Ticker>) {
  return (
    z
      .strictObject({
        ticker: tickerSchema,
        venue: z
          .string()
          .refine(isVenueRefShape)
          .optional()
          .describe(
            'which exchange to place on; required when more than one can serve the instrument'
          ),
        side: z.enum(ORDER_SIDES).describe('buy or sell.'),
        quantity: z.number().positive().describe("Units to trade, in the venue's lot convention."),
        limitPrice: z
          .number()
          .positive()
          .optional()
          .describe(`Makes it a limit order; absent places at market. ${PRICE_INPUT_UNITS}`),
        takeProfit: z
          .number()
          .positive()
          .optional()
          .describe(
            `Price at which a resting take-profit closes the position. Buys only; omit for none. Omit it on a plan that trails; see above. ${PRICE_INPUT_UNITS}`
          ),
        stopLoss: z
          .number()
          .positive()
          .optional()
          .describe(
            `Price at which a resting stop-loss closes the position. Required on a buy unless the operator turned require_stop_loss off; never on a sell. ${PRICE_INPUT_UNITS}`
          ),
      })
      // The slash grammar refuses the same shape: a sell is the way out already, so an exit on one
      // is a usage error, not a request the write path may quietly drop.
      .refine((input) => input.side === 'buy' || exitLevelsOf(input) === undefined, {
        message: 'a sell takes no takeProfit or stopLoss; they ride a buy',
        path: ['side'],
      })
  )
}

async function placeOrder(
  order: OrderService,
  request: OrderRequest,
  ctx: ToolInvocationContext
): Promise<string | ToolResult> {
  const now = Date.now()
  const prepared = await order.prepare({ request, now, signal: ctx.signal })

  if (prepared.rejections.length > 0) {
    // Codes, never the limits: a cash cap states what the book holds, and an agent may not see
    // absolute money (spec §13).
    return {
      content: `order refused: ${prepared.rejections.map((one) => one.code).join(REASON_SEPARATOR)}`,
      isError: true,
    }
  }

  // The approval prompt is drawn before the book is read, so it cannot show a cap this buy would
  // breach; `/trade` shows it before the operator confirms, so the order goes there instead.
  if (prepared.breaches.length > 0) {
    return { content: capBreachRefusal(prepared.breaches), isError: true }
  }

  const token = ledgerIdempotencyKey(ctx)

  await order.stage({
    request,
    prepared,
    // The run plus this exact call: the model supplies neither and cannot forge one, so a retried
    // call re-derives the same `clientOrderId` rather than placing a second order.
    token,
    now,
    signal: ctx.signal,
  })

  // Consumed before the venue is reached, as `/trade confirm` does: a token left staged here
  // could be confirmed by hand and placed a second time.
  const staged = await order.claim({ token, now, signal: ctx.signal })

  if (staged === undefined) {
    return { content: CLAIM_REFUSED, isError: true }
  }

  const executed = await order.execute({
    staged,
    prepared,
    approvalMode: ctx.approvalMode,
    now,
    signal: ctx.signal,
  })

  const { entry } = executed.write

  return toAgentJson({
    orderId: executed.receipt.orderId,
    clientOrderId: staged.clientOrderId,
    state: executed.receipt.state,
    at: entry.transaction.at,
    entryId: entry.id,
    exit: exitStateOf(executed),
  })
}

function capBreachRefusal(breaches: readonly CapBreach[]): string {
  return `${CAP_BREACH_REFUSED} ${toAgentJson(breaches.map(toBreachWeights))}`
}

/** Weights as percents, the unit an agent reads. An unmeasured ETF segment has no combined weight to
 *  state, only the ceiling it could not be checked against. */
function toBreachWeights(breach: CapBreach): Record<string, unknown> {
  if (breach.kind === 'etf-unmeasured') {
    const { capPctNav, ...subject } = breach

    return { ...subject, capPct: fractionToPct(capPctNav) }
  }

  const { combinedPctNav, capPctNav, ...subject } = breach

  return {
    ...subject,
    combinedPct: fractionToPct(combinedPctNav),
    capPct: fractionToPct(capPctNav),
  }
}

/** The one thing `portfolio_view` cannot say. A model that can see a position but not whether a
 *  stop stands under it advises a trim as though the downside were open, or leaves one alone
 *  believing it is covered. */
export function createOrderExitsTool(
  order: Pick<OrderService, 'exitCoverage'>,
  marketData: Pick<MarketDataService, 'quoteConvention'>
): ToolDefinition {
  return createTool({
    name: 'order_exits',
    description:
      "Show whether each position in the book has a take-profit/stop-loss standing at its exchange, and at what levels. `guardedShare` is the share of that position covered: 1 is fully covered, 0 is nothing standing under it, and anything between is a partial exit the operator set deliberately. A position at 0 is unprotected right now - say so before advising anything that assumes a stop, and never read a suggestion's stop level as one that was placed. Only positions at an exchange this tree can place on appear at all: a holding recorded by hand can carry no resting order, so it is absent rather than reported unguarded. Levels are absent where more than one exit rests on one position. Set or move an exit with the operator's own /trade exit - this tool reads and never places.",
    inputSchema: noInput,
    capability: 'read',
    presentation: { label: 'Exits', emoji: '🛡️' },
    async execute(_args, ctx): Promise<string> {
      const coverage = await order.exitCoverage({ now: Date.now(), signal: ctx.signal })

      return toAgentJson(coverage.map((row) => agentCoverage(row, marketData, ctx.locale)))
    },
  })
}

/** The levels written as the market's board shows them. */
function agentCoverage(
  row: ExitCoverage,
  marketData: Pick<MarketDataService, 'quoteConvention'>,
  locale: Locale
): unknown {
  const quoted = marketData.quoteConvention(row.instrument.market) ?? {}
  const { takeProfit, stopLoss } = row

  return {
    ...row,
    ...(takeProfit === undefined
      ? {}
      : { takeProfit: formatScaledPrice(locale, takeProfit, quoted) }),
    ...(stopLoss === undefined ? {} : { stopLoss: formatScaledPrice(locale, stopLoss, quoted) }),
  }
}

/** The tool's flat argument shape. The exit is two optional siblings here rather than a nested
 *  object: a model fills a flat schema more reliably, and `toOrderRequest` is where it becomes the
 *  domain's nested one. Zod infers each optional as `| undefined`, which is what this mirrors. */
interface OrderPlaceInput {
  readonly ticker: Ticker
  readonly venue?: string | undefined
  readonly side: OrderRequest['side']
  readonly quantity: number
  readonly limitPrice?: number | undefined
  readonly takeProfit?: number | undefined
  readonly stopLoss?: number | undefined
}

function toOrderRequest(args: OrderPlaceInput): OrderRequest {
  const exit = exitLevelsOf(args)

  return {
    ticker: args.ticker,
    side: args.side,
    orderType: args.limitPrice === undefined ? 'market' : 'limit',
    quantity: args.quantity,
    ...(args.venue === undefined ? {} : { venue: venueRef(args.venue) }),
    ...(args.limitPrice === undefined ? {} : { limitPrice: args.limitPrice }),
    ...(exit === undefined ? {} : { exit }),
  }
}

/** The one thing the agent must not misreport: a filled entry whose exit never went out leaves the
 *  position unprotected, and "placed" for both would read as protected. */
function exitStateOf(executed: {
  readonly exit?: unknown
  readonly exitFailure?: string
}): 'placed' | 'failed' | 'none' {
  if (executed.exitFailure !== undefined) {
    return 'failed'
  }

  return executed.exit === undefined ? 'none' : 'placed'
}
