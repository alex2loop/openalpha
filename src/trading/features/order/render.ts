import type { Locale } from '@/core/types/locale'
import type {
  CapRejection,
  ExecutedOrder,
  ExitOutcome,
  OrderRequest,
  OrderSide,
  PreparedOrder,
  StagedOrder,
  UnmirroredIntent,
} from '@/trading/features/order/types'
import type { TradingCosts } from '@/trading/kernel/config'
import type { MarketRef } from '@/trading/kernel/instrument'
import type { TradeCost } from '@/trading/markets/cost'
import type { QuoteConvention, QuotedIn } from '@/trading/render/money'
import { t } from '@/i18n'
import { renderBookAfter, renderWriteBody } from '@/trading/features/ledger/render'
import { estimatedFee } from '@/trading/markets/cost'
import { formatInstant } from '@/trading/render/datetime'
import { renderCapBreachLines } from '@/trading/render/exposure'
import {
  formatCount,
  formatQuantity,
  renderProvidedValue,
  renderVenueName,
  SECTION_ICONS,
  SIDE_MARKS,
} from '@/trading/render/format'
import { INDENT, INLINE_SEPARATOR, renderSectionTitle } from '@/trading/render/layout'
import { formatMoney, formatQuotedPrice } from '@/trading/render/money'
import { ABSENT_CELL } from '@/trading/render/number'

const REASON_SEPARATOR = '; '

interface PromptInput {
  readonly locale: Locale
  /** What the operator typed, so the prompt can say what rounding changed rather than change it
   *  quietly. */
  readonly request: OrderRequest
  readonly staged: StagedOrder
  readonly prepared: PreparedOrder
  readonly quotedIn: QuotedIn
  /** What the venue charges, when the operator has configured it. */
  readonly cost?: TradeCost
}

interface ReceiptInput {
  readonly locale: Locale
  readonly executed: ExecutedOrder
  readonly staged: StagedOrder
  readonly quotedIn: QuotedIn
  readonly quoteConventions: ReadonlyMap<MarketRef, QuoteConvention>
  readonly costs: TradingCosts
}

function sideRate(cost: TradeCost, side: OrderSide): number {
  return side === 'buy' ? cost.buyRate : cost.sellRate
}

/** The order as it will be placed, in the operator's own units, plus the one line that places it.
 *  A trigger is a price and prints in the market's own convention; the order's value and its fee
 *  are aggregate money and print in the currency it settles in. */
export function renderOrderPrompt(input: PromptInput): string {
  const { locale, prepared, quotedIn, staged } = input
  const lines = [
    renderSectionTitle(SECTION_ICONS.order, t(locale, 'trading.order.prompt.title')),
    `${INDENT[1]}${t(locale, 'trading.order.prompt.line', {
      side: t(locale, `trading.order.side.${staged.side}`),
      quantity: formatQuantity(locale, prepared.quantity),
      ticker: staged.instrument.ticker,
    })}`,
    `${INDENT[1]}${t(locale, 'trading.order.prompt.notional', {
      amount: formatMoney(locale, prepared.notional, prepared.currency),
    })}`,
    `${INDENT[1]}${t(locale, 'trading.order.prompt.quote', {
      price: formatQuotedPrice(locale, prepared.quotePrice, quotedIn),
    })}`,
  ]

  if (input.cost !== undefined) {
    lines.push(
      `${INDENT[1]}${t(locale, 'trading.order.prompt.fee', {
        amount: formatMoney(
          locale,
          estimatedFee(prepared.notional, sideRate(input.cost, staged.side)),
          prepared.currency
        ),
      })}`
    )
  }

  if (prepared.quantity !== input.request.quantity) {
    lines.push(
      `${INDENT[1]}${t(locale, 'trading.order.prompt.rounded', {
        original: formatQuantity(locale, input.request.quantity),
      })}`
    )
  }

  if (input.request.limitPrice !== undefined && prepared.limitPrice !== input.request.limitPrice) {
    lines.push(
      `${INDENT[1]}${t(locale, 'trading.order.prompt.roundedPrice', {
        original: formatQuotedPrice(locale, input.request.limitPrice, quotedIn),
      })}`
    )
  }

  lines.push(...renderCapBreachLines(locale, prepared.breaches))

  return [...lines, ...exitLines(input), confirmLine(input)].join('\n')
}

/** The row exactly as `/record` writes it, because it is the same row. The exposure leads: when a
 *  exit was asked for and did not go out, the operator reads that the position is unprotected
 *  before they read that the order worked. */
export function renderOrderReceipt(input: ReceiptInput): string {
  const { executed, locale, quoteConventions } = input
  const { write } = executed
  const lines = [
    renderSectionTitle(SECTION_ICONS.order, t(locale, 'trading.order.receipt.title')),
    ...renderWriteBody(locale, write, {
      costs: input.costs,
      quoteConventions,
      audience: 'confirmation',
    }),
    ...(executed.exit === undefined ? [] : [exitLine(input)]),
    ...renderBookAfter(locale, write, quoteConventions),
  ]

  if (executed.exitFailure === undefined) {
    return lines.join('\n')
  }

  return [unprotectedLine(input), ...lines].join('\n')
}

interface ExitOutcomeInput {
  readonly locale: Locale
  readonly outcome: ExitOutcome
  readonly quotedIn: QuotedIn
}

/** What now guards the position, and on which side. A single leg says so plainly: an operator who
 *  set only a stop should read that the upside is still unmanaged rather than infer it. */
export function renderExitOutcome(input: ExitOutcomeInput): string {
  const { locale, outcome, quotedIn } = input
  const title =
    outcome.action === 'placed'
      ? 'trading.order.exit.placedTitle'
      : 'trading.order.exit.amendedTitle'
  const lines = [
    renderSectionTitle(SECTION_ICONS.order, t(locale, title)),
    `${INDENT[1]}${t(locale, 'trading.order.exit.covers', {
      quantity: formatQuantity(locale, outcome.quantity),
      ticker: outcome.instrument.ticker,
      venue: renderVenueName(locale, outcome.venue),
    })}`,
  ]

  if (outcome.takeProfit !== undefined) {
    lines.push(
      `${INDENT[1]}${t(locale, 'trading.order.exit.takeProfit', {
        price: formatQuotedPrice(locale, outcome.takeProfit, quotedIn),
      })}`
    )
  }

  if (outcome.stopLoss !== undefined) {
    lines.push(
      `${INDENT[1]}${t(locale, 'trading.order.exit.stopLoss', {
        price: formatQuotedPrice(locale, outcome.stopLoss, quotedIn),
      })}`
    )
  }

  if (outcome.uncovered > 0) {
    lines.push(
      `${INDENT[1]}${t(locale, 'trading.order.exit.uncovered', {
        quantity: formatQuantity(locale, outcome.uncovered),
        ticker: outcome.instrument.ticker,
      })}`
    )
  }

  if (outcome.takeProfit === undefined || outcome.stopLoss === undefined) {
    lines.push(`${INDENT[1]}${t(locale, 'trading.order.exit.oneSided')}`)
  }

  // Only where a stop rests: `amendResting` has one caller, the `/trade exit` path, so nothing moves
  // this order when the exit tick raises the plan's stop. A take-profit alone has no trail to follow.
  if (outcome.stopLoss !== undefined) {
    lines.push(`${INDENT[1]}${t(locale, 'trading.order.exit.trailNotice')}`)
  }

  return lines.join('\n')
}

function exitLine(input: ReceiptInput): string {
  return `${INDENT[1]}${t(input.locale, 'trading.order.receipt.exit', {
    takeProfit: triggerText(input, input.staged.takeProfit),
    stopLoss: triggerText(input, input.staged.stopLoss),
  })}`
}

/** What the engine's approval prompt shows for `order_place`: the request as typed, in the
 *  operator's locale, so a real-money prompt never falls back to raw JSON. Prices are absent on
 *  purpose — the tool has no market convention to quote them in until the order is prepared. */
export function renderOrderLine(locale: Locale, request: OrderRequest): string {
  return t(locale, 'trading.order.prompt.line', {
    side: t(locale, `trading.order.side.${request.side}`),
    quantity: formatQuantity(locale, request.quantity),
    ticker: request.ticker,
  })
}

/** Every reason the caps gave, in one line the operator can act on. A limit and the reading that
 *  broke it are both money, so both print through the market's own convention. */
export function renderCapRejections(
  locale: Locale,
  rejections: readonly CapRejection[],
  quotedIn: QuotedIn
): string {
  const reasons = rejections
    .map((rejection) =>
      t(locale, `trading.order.cap.${rejection.code}`, {
        limit: capText({ locale, rejection, quotedIn }, rejection.limit),
        actual: capText({ locale, rejection, quotedIn }, rejection.actual),
        ...(rejection.venue === undefined
          ? {}
          : { venue: renderVenueName(locale, rejection.venue) }),
      })
    )
    .join(REASON_SEPARATOR)
  const cash = rejections.find((rejection) => rejection.code === 'cash')

  if (cash === undefined) {
    return reasons
  }

  return [
    reasons,
    t(locale, 'trading.order.cap.remedy', {
      ...(cash.venue === undefined ? {} : { venue: renderVenueName(locale, cash.venue) }),
    }),
  ].join('\n')
}

interface CapContext {
  readonly locale: Locale
  readonly rejection: CapRejection
  readonly quotedIn: QuotedIn
}

/** An open-position cap counts positions; every other cap measures money. */
function capText(context: CapContext, value: number): string {
  return context.rejection.code === 'openTrades'
    ? formatQuantity(context.locale, value)
    : formatQuotedPrice(context.locale, value, context.quotedIn)
}

interface UnmirroredContext {
  readonly locale: Locale
  readonly timezone: string
}

interface UnmirroredInput extends UnmirroredContext {
  readonly intents: readonly UnmirroredIntent[]
  readonly settled: number
}

/** What the exchange took and the book never got, one row per line with the token that settles it.
 *  Each row states the trade the operator has to look for at the venue, so it can be read against
 *  an exchange history without holding anything else on screen. */
export function renderUnmirroredIntents(input: UnmirroredInput): string {
  const { locale } = input
  const recovered =
    input.settled === 0
      ? []
      : [
          `${INDENT[1]}${t(locale, 'trading.order.unmirrored.recovered', {
            count: formatCount(locale, input.settled),
          })}`,
        ]

  return [
    renderSectionTitle(SECTION_ICONS.order, t(locale, 'trading.order.unmirrored.title')),
    ...recovered,
    ...input.intents.flatMap((intent) => renderUnmirroredLines(input, intent)),
    `${INDENT[1]}${t(locale, 'trading.order.unmirrored.remedy')}`,
  ].join('\n')
}

/** One intent as the two lines that describe it: what to look for at the venue, and the token that
 *  settles it. Exported because the status surface prints the same rows as one of its sections. */
export function renderUnmirroredLines(
  context: UnmirroredContext,
  intent: UnmirroredIntent
): readonly string[] {
  const { locale } = context
  const parts = [
    t(locale, 'trading.order.prompt.line', {
      side: t(locale, `trading.order.side.${intent.side}`),
      quantity: formatQuantity(locale, intent.filledQuantity ?? intent.quantity),
      ticker: intent.instrument.ticker,
    }),
    renderVenueName(locale, intent.venue),
    formatInstant(locale, intent.createdAt, context.timezone),
    renderProvidedValue(
      locale,
      `trading.order.unmirrored.reason.${intent.failure}`,
      intent.failure
    ),
    // Labelled because it is the handle the operator searches the exchange with, and a bare id
    // beside a quantity and a price says nothing about which of them it is.
    ...(intent.orderId === undefined
      ? []
      : [t(locale, 'trading.order.unmirrored.orderId', { orderId: intent.orderId })]),
  ]

  return [
    `${INDENT[1]}${SIDE_MARKS[intent.side]} ${parts.join(INLINE_SEPARATOR)}`,
    `${INDENT[2]}${t(locale, 'trading.order.unmirrored.settle', { token: intent.token })}`,
  ]
}

function exitLines(input: PromptInput): readonly string[] {
  const { locale, quotedIn, staged } = input
  const lines: string[] = []

  if (staged.takeProfit !== undefined) {
    lines.push(
      `${INDENT[1]}${t(locale, 'trading.order.prompt.takeProfit', {
        price: formatQuotedPrice(locale, staged.takeProfit, quotedIn),
      })}`
    )
  }

  if (staged.stopLoss !== undefined) {
    lines.push(
      `${INDENT[1]}${t(locale, 'trading.order.prompt.stopLoss', {
        price: formatQuotedPrice(locale, staged.stopLoss, quotedIn),
      })}`
    )
  }

  return lines
}

function confirmLine(input: PromptInput): string {
  return t(input.locale, 'trading.order.prompt.confirm', { token: input.staged.token })
}

function unprotectedLine(input: ReceiptInput): string {
  const { transaction } = input.executed.write.entry

  return t(input.locale, 'trading.order.receipt.unprotected', {
    quantity: formatQuantity(input.locale, 'quantity' in transaction ? transaction.quantity : 0),
    ticker: input.staged.instrument.ticker,
  })
}

function triggerText(input: ReceiptInput, value: number | undefined): string {
  return value === undefined ? ABSENT_CELL : formatQuotedPrice(input.locale, value, input.quotedIn)
}
