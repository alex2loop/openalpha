import { randomUUID } from 'node:crypto'

import type {
  SlashCommand,
  SlashContext,
  SlashInvocationPolicy,
  SlashResult,
} from '@/core/types/command'
import type { Locale } from '@/core/types/locale'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { TradeCommand } from '@/trading/features/order/parse'
import type { OrderRequest, OrderService, PreparedOrder } from '@/trading/features/order/types'
import type { TradingCosts } from '@/trading/kernel/config'
import type { MarketRef } from '@/trading/kernel/instrument'
import type { TradeCost } from '@/trading/markets/cost'
import type { QuoteConvention, QuotedIn } from '@/trading/render/money'
import type { VenueRegistry } from '@/trading/venues/types'
import { t, translateToolError } from '@/i18n'
import { quoteConventionsFor } from '@/trading/features/market-data/command/quote-conventions'
import {
  confirmTokenOf,
  isConfirmArgs,
  parseTradeArgs,
  TRADE_ACTIONS,
} from '@/trading/features/order/parse'
import {
  renderCapRejections,
  renderExitOutcome,
  renderOrderPrompt,
  renderOrderReceipt,
} from '@/trading/features/order/render'
import {
  REVIEW_MESSAGE_KEYS,
  resolveConfirmTarget,
  runReconcile,
  runStatus,
} from '@/trading/features/order/review'
import { OrderError } from '@/trading/features/order/types'
import { usage } from '@/trading/kernel/surface/surface'
import { resolveTradeCost } from '@/trading/markets/cost'
import { renderVenueName } from '@/trading/render/format'
import { INLINE_SEPARATOR } from '@/trading/render/layout'
import { quotedInOf } from '@/trading/render/money'

const USAGE: 'slash.tradingTradeUsage' = 'slash.tradingTradeUsage'
const UNKNOWN_TOKEN: 'slash.tradingTradeUnknownToken' = 'slash.tradingTradeUnknownToken'
const CAP_REJECTED: 'slash.tradingTradeCapRejected' = 'slash.tradingTradeCapRejected'
const CANCELLED: 'slash.tradingTradeExitCancelled' = 'slash.tradingTradeExitCancelled'
const NO_EXIT: 'slash.tradingTradeNoExit' = 'slash.tradingTradeNoExit'
const FAILED: 'slash.tradingTradeFailed' = 'slash.tradingTradeFailed'
const HALTED: 'slash.tradingTradeHalted' = 'slash.tradingTradeHalted'
const RESUMED: 'slash.tradingTradeResumed' = 'slash.tradingTradeResumed'
const NEEDS_KEY: 'slash.tradingTradeNeedsKey' = 'slash.tradingTradeNeedsKey'

const STAGE_POLICY: SlashInvocationPolicy = {
  surfaces: ['channel', 'repl'],
  role: 'operator',
  action: 'mutate',
  idempotencyKey: (ctx) => ctx.requestId,
}

/** The dispatcher keys on `(surface, channel, userId, chatId, 'trade', policyKey)` for five
 *  minutes. A confirm keyed on the staging call's own `requestId` would produce the identical tuple
 *  and be answered `handled` without ever running, for exactly the window in which a confirm is
 *  plausible — so it keys on the token the staging call minted instead. A bare confirm names no
 *  token and falls back to the request id, which is what keeps a retry of the same turn idempotent
 *  without letting two different turns share a key. */
const CONFIRM_POLICY: SlashInvocationPolicy = {
  ...STAGE_POLICY,
  idempotencyKey: (ctx) => confirmTokenOf(ctx.args) ?? ctx.requestId,
}

const KEYLESS_POLICY: SlashInvocationPolicy = {
  surfaces: ['channel', 'repl'],
  role: 'operator',
  action: 'read',
}

/** The turn plus its one clock read, threaded together because every arm needs both and a second
 *  `Date.now()` inside one invocation is a value that disagrees with the first. */
interface Invocation {
  readonly ctx: SlashContext
  readonly now: number
}

interface TradeCommandDeps {
  readonly order: OrderService
  readonly marketData: Pick<MarketDataService, 'quoteConvention'>
  /** What the venue charges, per market. */
  readonly costs: TradingCosts
  /** The operator's one clock, for the stamp an outstanding intent carries. */
  readonly timezone: string
}

interface TradeCommandOptions extends Omit<TradeCommandDeps, 'order'> {
  /** Absent when no venue has an exchange key: `/trade` then places nothing and names the keys
   *  that would open it. */
  readonly order?: OrderService
  readonly venues: Pick<VenueRegistry, 'list'>
}

export function createTradeCommand(options: TradeCommandOptions): SlashCommand {
  const { order, venues, ...rest } = options

  if (order === undefined) {
    return createKeylessTradeCommand(venues)
  }

  const deps: TradeCommandDeps = { ...rest, order }

  return {
    name: 'trade',
    description: { kind: 'localized', key: 'slash.tradingTradeHelp' },
    messageKeys: [
      USAGE,
      UNKNOWN_TOKEN,
      CAP_REJECTED,
      CANCELLED,
      NO_EXIT,
      FAILED,
      HALTED,
      RESUMED,
      ...REVIEW_MESSAGE_KEYS,
    ],
    policy: STAGE_POLICY,
    policyFor: (args) => (isConfirmArgs(args) ? CONFIRM_POLICY : STAGE_POLICY),
    // The action only: a staged order's side sits behind an optional venue, so its slot is not
    // known until the line is finished.
    completeFor: (args) => (args.length === 1 ? TRADE_ACTIONS : []),
    run: async (ctx): Promise<SlashResult> => run(deps, ctx),
  }
}

function createKeylessTradeCommand(venues: Pick<VenueRegistry, 'list'>): SlashCommand {
  return {
    name: 'trade',
    description: { kind: 'localized', key: 'slash.tradingTradeHelp' },
    messageKeys: [NEEDS_KEY],
    policy: KEYLESS_POLICY,
    run: async (ctx): Promise<SlashResult> => ({
      kind: 'text',
      text: t(ctx.locale, NEEDS_KEY, { venues: renderKeylessVenues(ctx.locale, venues) }),
    }),
  }
}

function renderKeylessVenues(locale: Locale, venues: Pick<VenueRegistry, 'list'>): string {
  return venues
    .list()
    .flatMap(({ manifest }) =>
      manifest.missingCredentials === undefined
        ? []
        : [`${renderVenueName(locale, manifest.id)} (${manifest.missingCredentials.join(', ')})`]
    )
    .join(INLINE_SEPARATOR)
}

async function run(deps: TradeCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  const parsed = parseTradeArgs(ctx.args)

  if (parsed === null) {
    return usage(USAGE)
  }

  const invocation: Invocation = { ctx, now: Date.now() }

  try {
    return await dispatch(deps, invocation, parsed)
  } catch (err: unknown) {
    if (!(err instanceof OrderError)) {
      throw err
    }

    return {
      kind: 'message',
      messages: [
        {
          key: FAILED,
          // The message carries what the code cannot: which venues could have served the order,
          // which order the exchange ended. The tool surface already shows it for the same codes.
          values: { reason: translateToolError(ctx.locale, err.code, err.detail(ctx.locale)) },
        },
      ],
    }
  }
}

async function dispatch(
  deps: TradeCommandDeps,
  invocation: Invocation,
  parsed: TradeCommand
): Promise<SlashResult> {
  if (parsed.kind === 'halt' || parsed.kind === 'resume') {
    return await runHalt(deps, invocation, parsed.kind === 'halt')
  }

  if (parsed.kind === 'exit') {
    return await runSetExit(deps, invocation, parsed)
  }

  if (parsed.kind === 'cancel') {
    return await runCancel(deps, invocation, parsed)
  }

  if (parsed.kind === 'confirm') {
    return await runConfirm(deps, invocation, parsed.token)
  }

  if (parsed.kind === 'reconcile') {
    return await runReconcile(deps, invocation.ctx, parsed.token)
  }

  if (parsed.kind === 'status') {
    return await runStatus(deps, invocation)
  }

  return await runStage(deps, invocation, parsed.request)
}

async function runStage(
  deps: TradeCommandDeps,
  invocation: Invocation,
  request: OrderRequest
): Promise<SlashResult> {
  const { ctx, now } = invocation
  const prepared = await deps.order.prepare({ request, now, signal: ctx.signal })

  if (prepared.rejections.length > 0) {
    return rejected(deps, ctx.locale, prepared)
  }

  const staged = await deps.order.stage({
    request,
    prepared,
    // A fresh token, not the request id: it is the confirm's idempotency key, and reusing the
    // staging call's would collide with the tuple that call already stamped.
    token: randomUUID(),
    now,
    signal: ctx.signal,
  })

  return {
    kind: 'text',
    text: renderOrderPrompt({
      locale: ctx.locale,
      request,
      staged,
      prepared,
      quotedIn: quotedInFor(prepared, quoteConventionsFrom(deps, prepared)),
      ...costFor(deps, prepared),
    }),
  }
}

/** An unknown token places nothing: the claim is what proves the operator saw this exact order and
 *  answered it, so an invented one can never reach the exchange. */
async function runConfirm(
  deps: TradeCommandDeps,
  invocation: Invocation,
  named: string | undefined
): Promise<SlashResult> {
  const { ctx, now } = invocation
  const target = await resolveConfirmTarget(deps, invocation, named)

  if (target.kind === 'refused') {
    return { kind: 'message', messages: [{ key: target.key }] }
  }

  const outcome = await deps.order.confirm({ token: target.token, now, signal: ctx.signal })

  if (outcome.kind === 'unknown-token') {
    return { kind: 'message', messages: [{ key: UNKNOWN_TOKEN }] }
  }

  if (outcome.kind === 'rejected') {
    return rejected(deps, ctx.locale, outcome.prepared)
  }

  const { staged, prepared, executed } = outcome
  const quoteConventions = quoteConventionsFrom(deps, prepared)

  return {
    kind: 'text',
    text: renderOrderReceipt({
      locale: ctx.locale,
      executed,
      staged,
      quotedIn: quotedInFor(prepared, quoteConventions),
      quoteConventions,
      costs: deps.costs,
    }),
  }
}

type CancelCommand = Extract<TradeCommand, { kind: 'cancel' }>

async function runCancel(
  deps: TradeCommandDeps,
  invocation: Invocation,
  parsed: CancelCommand
): Promise<SlashResult> {
  const { ctx, now } = invocation
  const cancelled = await deps.order.cancelExit({
    ticker: parsed.ticker,
    now,
    signal: ctx.signal,
    ...(parsed.venue === undefined ? {} : { venue: parsed.venue }),
  })

  return {
    kind: 'message',
    messages: [{ key: cancelled ? CANCELLED : NO_EXIT, values: { ticker: parsed.ticker } }],
  }
}

async function runHalt(
  deps: TradeCommandDeps,
  invocation: Invocation,
  halted: boolean
): Promise<SlashResult> {
  const { ctx, now } = invocation

  await deps.order.setHalted({ halted, now, signal: ctx.signal })

  return { kind: 'message', messages: [{ key: halted ? HALTED : RESUMED }] }
}

type ExitCommand = Extract<TradeCommand, { kind: 'exit' }>

async function runSetExit(
  deps: TradeCommandDeps,
  invocation: Invocation,
  parsed: ExitCommand
): Promise<SlashResult> {
  const { ctx, now } = invocation
  const outcome = await deps.order.setExit({
    ticker: parsed.ticker,
    exit: parsed.exit,
    requestId: ctx.requestId,
    now,
    signal: ctx.signal,
    ...(parsed.quantity === undefined ? {} : { quantity: parsed.quantity }),
    ...(parsed.venue === undefined ? {} : { venue: parsed.venue }),
  })
  const conventions = quoteConventionsFor(deps.marketData, [outcome.instrument])

  return {
    kind: 'text',
    text: renderExitOutcome({
      locale: ctx.locale,
      outcome,
      quotedIn: {
        currency: outcome.currency,
        ...quotedInOf(conventions.get(outcome.instrument.market)),
      },
    }),
  }
}

function rejected(deps: TradeCommandDeps, locale: Locale, prepared: PreparedOrder): SlashResult {
  const quotedIn = quotedInFor(prepared, quoteConventionsFrom(deps, prepared))

  return {
    kind: 'message',
    messages: [
      {
        key: CAP_REJECTED,
        values: { reasons: renderCapRejections(locale, prepared.rejections, quotedIn) },
      },
    ],
  }
}

/** Spread into a render input, so a venue with no configured rate contributes no key at all. */
function costFor(deps: TradeCommandDeps, prepared: PreparedOrder): { readonly cost?: TradeCost } {
  const cost = resolveTradeCost(prepared.venue, deps.costs)

  return cost === undefined ? {} : { cost }
}

function quoteConventionsFrom(
  deps: TradeCommandDeps,
  prepared: PreparedOrder
): ReadonlyMap<MarketRef, QuoteConvention> {
  return quoteConventionsFor(deps.marketData, [prepared.instrument])
}

function quotedInFor(
  prepared: PreparedOrder,
  conventions: ReadonlyMap<MarketRef, QuoteConvention>
): QuotedIn {
  return {
    currency: prepared.currency,
    ...quotedInOf(conventions.get(prepared.instrument.market)),
  }
}
