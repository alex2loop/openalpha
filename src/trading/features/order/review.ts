import type { SlashContext, SlashResult } from '@/core/types/command'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { OrderService, ReconcileReview, TradeStatus } from '@/trading/features/order/types'
import { pluralKey } from '@/i18n'
import { quoteConventionsFor } from '@/trading/features/market-data/command/quote-conventions'
import { renderUnmirroredIntents } from '@/trading/features/order/render'
import { renderOrphanExits } from '@/trading/features/order/render-orphans'
import { renderTradeStatus } from '@/trading/features/order/render-status'
import { soleStagedOrder } from '@/trading/features/order/status'
import { formatCount } from '@/trading/render/format'
import { joinSections } from '@/trading/render/layout'

const NOTHING_UNMIRRORED: 'slash.tradingTradeNothingUnmirrored' =
  'slash.tradingTradeNothingUnmirrored'
const RECONCILED: 'slash.tradingTradeReconciled' = 'slash.tradingTradeReconciled'
const SETTLED_ONE: 'slash.tradingTradeAutoSettledOne' = 'slash.tradingTradeAutoSettledOne'
const SETTLED: 'slash.tradingTradeAutoSettled' = 'slash.tradingTradeAutoSettled'
const UNKNOWN_INTENT: 'slash.tradingTradeUnknownIntent' = 'slash.tradingTradeUnknownIntent'
const NOTHING_OUTSTANDING: 'slash.tradingTradeNothingOutstanding' =
  'slash.tradingTradeNothingOutstanding'
const NO_STAGED: 'slash.tradingTradeNoStaged' = 'slash.tradingTradeNoStaged'
const MANY_STAGED: 'slash.tradingTradeManyStaged' = 'slash.tradingTradeManyStaged'

/** Declared here and read by the command, so a message this file can emit can never be missing
 *  from the registration that declares what the command says. */
export const REVIEW_MESSAGE_KEYS = Object.freeze([
  NOTHING_UNMIRRORED,
  RECONCILED,
  SETTLED_ONE,
  SETTLED,
  UNKNOWN_INTENT,
  NOTHING_OUTSTANDING,
  NO_STAGED,
  MANY_STAGED,
] as const)

/** What the read arms need, which is less than the command holds: no costs, no exit path, and
 *  nothing that places an order. */
interface ReviewDeps {
  readonly order: Pick<OrderService, 'tradeStatus' | 'reconcileOrders' | 'clearUnmirrored'>
  readonly marketData: Pick<MarketDataService, 'quoteConvention'>
  /** The operator's one clock, for the stamp an outstanding row carries. */
  readonly timezone: string
}

interface ReviewInput {
  readonly ctx: SlashContext
  readonly now: number
}

/** What is outstanding, and nothing else: no venue is asked, so it answers while an exchange is
 *  down — which is exactly when an operator wants to know what is still standing out there. */
export async function runStatus(deps: ReviewDeps, input: ReviewInput): Promise<SlashResult> {
  const { ctx, now } = input
  const status = await deps.order.tradeStatus({ now, signal: ctx.signal })

  if (isEmpty(status)) {
    return { kind: 'message', messages: [{ key: NOTHING_OUTSTANDING }] }
  }

  return {
    kind: 'text',
    text: renderTradeStatus({
      locale: ctx.locale,
      status,
      quoteConventions: quoteConventionsFor(deps.marketData, [
        ...status.exits.map((exit) => exit.instrument),
        ...status.unmirrored.map((intent) => intent.instrument),
      ]),
      timezone: deps.timezone,
    }),
  }
}

function isEmpty(status: TradeStatus): boolean {
  return (
    status.haltedAt === undefined &&
    status.staged.length === 0 &&
    status.exits.length === 0 &&
    status.unguarded.length === 0 &&
    status.unmirrored.length === 0
  )
}

/** The one order to claim, or the reason there is none to. Tagged rather than a token beside two
 *  sentinel strings, because a claim reads whatever it is handed and a sentinel that slipped
 *  through would be looked up as a token. */
type ConfirmTarget =
  | { readonly kind: 'token'; readonly token: string }
  | { readonly kind: 'refused'; readonly key: typeof NO_STAGED | typeof MANY_STAGED }

/** The token names one order among several; bare answers only while exactly one is waiting, the
 *  same rule routing applies to a venue. Nothing is claimed where the answer is a choice, so a
 *  second staged order can never be placed by a confirm meant for the first. */
export async function resolveConfirmTarget(
  deps: ReviewDeps,
  input: ReviewInput,
  named: string | undefined
): Promise<ConfirmTarget> {
  if (named !== undefined) {
    return { kind: 'token', token: named }
  }

  const { ctx, now } = input
  const { staged } = await deps.order.tradeStatus({ now, signal: ctx.signal })
  const only = soleStagedOrder(staged)

  if (only !== undefined) {
    return { kind: 'token', token: only.token }
  }

  return { kind: 'refused', key: staged.length === 0 ? NO_STAGED : MANY_STAGED }
}

/** The two halves of one job: read what the exchange took and the book never got, square it there
 *  by hand, then name the row that is now accounted for. Clearing is the only thing that takes a
 *  lost fill back out of the caps, which is why no clock and no age can do it instead. The same
 *  pass lists the exits resting at a venue that no row tracks; nothing here can cancel one. */
export async function runReconcile(
  deps: ReviewDeps,
  ctx: SlashContext,
  token: string | undefined
): Promise<SlashResult> {
  if (token !== undefined) {
    const cleared = await deps.order.clearUnmirrored(token, ctx.signal)

    return { kind: 'message', messages: [{ key: cleared ? RECONCILED : UNKNOWN_INTENT }] }
  }

  const review = await deps.order.reconcileOrders(ctx.signal)
  const exitsReported = review.orphanExits.length > 0 || review.unreadExitVenues.length > 0

  if (review.outstanding.length === 0 && !exitsReported) {
    return {
      kind: 'message',
      messages: [
        review.settled === 0
          ? { key: NOTHING_UNMIRRORED }
          : {
              key: pluralKey(review.settled, SETTLED_ONE, SETTLED),
              values: { count: formatCount(ctx.locale, review.settled) },
            },
      ],
    }
  }

  return {
    kind: 'text',
    text: joinSections([
      review.outstanding.length === 0 ? [] : [renderOutstanding(deps, ctx, review)],
      exitsReported
        ? [
            renderOrphanExits({
              locale: ctx.locale,
              orphans: review.orphanExits,
              unread: review.unreadExitVenues,
            }),
          ]
        : [],
    ]),
  }
}

function renderOutstanding(deps: ReviewDeps, ctx: SlashContext, review: ReconcileReview): string {
  return renderUnmirroredIntents({
    locale: ctx.locale,
    intents: review.outstanding,
    settled: review.settled,
    timezone: deps.timezone,
    quoteConventions: quoteConventionsFor(
      deps.marketData,
      review.outstanding.map((intent) => intent.instrument)
    ),
  })
}
