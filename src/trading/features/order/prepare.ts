import type { OrderServiceDeps } from '@/trading/features/order/deps'
import type { RoutedVenue } from '@/trading/features/order/routing'
import type { SellableQuantity } from '@/trading/features/order/sellable'
import type { UnmirroredExposure } from '@/trading/features/order/store/order-intent'
import type {
  CapRejection,
  ExitLevels,
  OrderSide,
  OrderType,
  PreparedOrder,
  PrepareInput,
  StagedOrder,
  StageOrderInput,
} from '@/trading/features/order/types'
import type { ValuedBook } from '@/trading/features/portfolio/types'
import type {
  CurrencyCode,
  InstrumentKind,
  InstrumentRef,
  PortfolioSegment,
  TradingDay,
  VenueRef,
} from '@/trading/kernel/instrument'
import type { SleeveBreach } from '@/trading/kernel/operator/exposure'
import { resolveDay, resolveInstrument } from '@/trading/features/market-data/resolve'
import { breachedSleeves } from '@/trading/features/order/exposure'
import { assertBuyingAllowed } from '@/trading/features/order/halt'
import { isExitInverted, validateOrderCaps } from '@/trading/features/order/policy'
import { roundExitLevels, roundToInstrument } from '@/trading/features/order/precision'
import { adapterFor, resolveOrderVenue } from '@/trading/features/order/routing'
import { resolveSellableQuantities, sellableQuantityOf } from '@/trading/features/order/sellable'
import { OrderError, OrderQuantityError } from '@/trading/features/order/types'
import { resolveTradeCost } from '@/trading/markets/cost'

const UNSETTLED_MESSAGE = 'the sale is larger than the settled part of the position'
const GUARDED_MESSAGE = 'the sale is larger than the part not frozen behind a resting exit'

/** Steps one to five of the write path, run twice: once at staging and again at confirm. The staged
 *  row carries the operator's terms, never the verdict — minutes pass between the two, and a market
 *  order whose quote has moved must not fill at a price nobody checked. */
export async function prepareOrder(
  deps: OrderServiceDeps,
  input: PrepareInput
): Promise<PreparedOrder> {
  const resolution = await resolveInstrument(deps.markets, {
    ticker: input.request.ticker,
    signal: input.signal,
  })

  if (resolution.kind === 'unresolved') {
    throw new OrderError('order.rejected', `no market quotes ${input.request.ticker}`)
  }

  const { instrument, instrumentKind, market } = resolution
  const sellableOf = createSellableOf(deps, instrument, input)

  if (input.request.side === 'sell') {
    assertAnySellable(await sellableOf())
  }

  const venue = await resolveOrderVenue({
    market: instrument.market,
    side: input.request.side,
    venues: deps.venues,
    holdingVenues: () => sellableVenues(sellableOf),
    ...(input.request.venue === undefined ? {} : { named: input.request.venue }),
  })
  const terms = await resolveExecutionTerms(deps, input, { instrument, venue })

  if (input.request.side === 'sell') {
    assertSellable(await sellableOf(), venue.id, terms.quantity)
  }

  const day = resolveDay(market, input.now)
  const currency = market.manifest.currency
  const segment = market.manifest.segment
  const notional = terms.quantity * terms.reference
  const caps = await capsFor(deps, {
    input,
    notional,
    currency,
    asOf: day,
    instrument,
    segment,
    venue: venue.id,
    ...(instrumentKind === undefined ? {} : { instrumentKind }),
  })

  return {
    instrument,
    venue: venue.id,
    symbol: terms.symbol,
    day,
    currency,
    quotePrice: terms.quotePrice,
    quantity: terms.quantity,
    notional,
    notionalBase: caps.notionalBase,
    rejections: caps.rejections,
    breaches: caps.breaches,
    ...(terms.limitPrice === undefined ? {} : { limitPrice: terms.limitPrice }),
    ...(terms.exit === undefined ? {} : { exit: terms.exit }),
  }
}

interface ExecutionScope {
  readonly instrument: InstrumentRef
  readonly venue: RoutedVenue
}

/** One read per sell, none per buy: a buy never touches the ledger fold. */
function createSellableOf(
  deps: OrderServiceDeps,
  instrument: InstrumentRef,
  input: PrepareInput
): () => Promise<ReadonlyMap<VenueRef, SellableQuantity>> {
  let sellable: Promise<ReadonlyMap<VenueRef, SellableQuantity>> | undefined

  return () =>
    (sellable ??= resolveSellableQuantities(deps, {
      instrument,
      now: input.now,
      signal: input.signal,
    }))
}

async function sellableVenues(
  sellableOf: () => Promise<ReadonlyMap<VenueRef, SellableQuantity>>
): Promise<readonly VenueRef[]> {
  return [...(await sellableOf())]
    .filter(([, quantity]) => sellableQuantityOf(quantity) > 0)
    .map(([id]) => id)
}

interface ExecutionTerms {
  readonly symbol: string
  readonly quantity: number
  readonly limitPrice?: number
  readonly exit?: ExitLevels
  readonly quotePrice: number
  readonly reference: number
}

/** What the venue will actually fill: the pair it lists, the size and price snapped to its ticks,
 *  and the live quote those are judged against. Rounding happens before every guard, because a
 *  limit that cleared the drift check unrounded can cross it once snapped. */
async function resolveExecutionTerms(
  deps: OrderServiceDeps,
  input: PrepareInput,
  scope: ExecutionScope
): Promise<ExecutionTerms> {
  const { adapter } = scope.venue

  // A signature is rejected for a clock a few seconds out, and that failure reads exactly like a
  // bad secret. Asked here, before staging and again before the confirm, so the diagnosis always
  // happens with no money moving.
  await adapter.assertClockInSync(input.signal)

  const symbol = adapter.toSymbol(scope.instrument)
  const limits = await adapter.fetchLimits(symbol, input.signal)
  const rounded = roundToInstrument({
    limits,
    quantity: input.request.quantity,
    ...(input.request.limitPrice === undefined
      ? {}
      : { limit: { price: input.request.limitPrice, side: input.request.side } }),
  })
  const exit =
    input.request.exit === undefined ? undefined : roundExitLevels(limits, input.request.exit)
  const quotePrice = await deps.quoteOf(scope.instrument, input.now, input.signal)
  const reference = rounded.limitPrice ?? quotePrice
  const terms = { ...rounded, quotePrice, reference, ...(exit === undefined ? {} : { exit }) }

  assertTradableTerms(deps, terms, input.stagedQuote)

  return { ...terms, symbol }
}

interface TradableTerms {
  readonly limitPrice?: number
  readonly exit?: ExitLevels
  readonly quotePrice: number
  readonly reference: number
}

/** Every guard reads the rounded terms, because rounding is what the exchange will actually fill: a
 *  limit that cleared the drift check unrounded can cross it once snapped to a tick. `!(x > 0)`
 *  rather than `x <= 0`: a NaN quote passes every comparison below it, so drift and every cap
 *  measured against it would read as satisfied. */
function assertTradableTerms(
  deps: OrderServiceDeps,
  terms: TradableTerms,
  stagedQuote: number | undefined
): void {
  if (!(terms.quotePrice > 0) || (terms.limitPrice !== undefined && !(terms.limitPrice > 0))) {
    throw new OrderError('order.rejected', 'the terms carry no price this can size against')
  }

  assertWithinDrift(deps, terms, stagedQuote)

  if (isExitInverted({ reference: terms.reference, ...terms.exit })) {
    throw new OrderError('order.exit_inverted', 'stop and target are on the wrong sides')
  }
}

/** A limit order is held to the live quote; a market order, which names no price, to the quote
 *  the operator was shown. The market arm applies only at confirm, where minutes may have
 *  passed. Written `!(drift <= max)` so a NaN refuses. */
function assertWithinDrift(
  deps: OrderServiceDeps,
  terms: TradableTerms,
  stagedQuote: number | undefined
): void {
  const { maximumPriceDrift } = deps.policy

  if (terms.limitPrice !== undefined) {
    if (!(driftOf(terms.quotePrice, terms.limitPrice) <= maximumPriceDrift)) {
      throw new OrderError('order.rejected', 'limit price has drifted from the live quote')
    }

    return
  }

  if (stagedQuote !== undefined && !(driftOf(stagedQuote, terms.quotePrice) <= maximumPriceDrift)) {
    throw new OrderError('order.rejected', 'the live quote has drifted from the one staged')
  }
}

/** Ahead of routing, because a position whose every unit is frozen narrows to no venue at all and
 *  would be refused as one no venue serves — naming the holder in the same breath. Nothing held
 *  anywhere is left to routing, which already answers that. */
function assertAnySellable(sellable: ReadonlyMap<VenueRef, SellableQuantity>): void {
  const held = [...sellable.values()]

  if (held.length === 0 || held.some((quantity) => sellableQuantityOf(quantity) > 0)) {
    return
  }

  if (held.every((quantity) => quantity.settled === 0)) {
    throw new OrderQuantityError('order.sell_unsettled', UNSETTLED_MESSAGE, 0)
  }

  throw new OrderQuantityError('order.sell_guarded', GUARDED_MESSAGE, 0)
}

/** Unsettled stock and coins frozen behind a resting exit are two different fixes — wait, or cancel
 *  the exit — so they refuse separately rather than under one number the operator cannot act on. */
export function assertSellable(
  sellable: ReadonlyMap<VenueRef, SellableQuantity>,
  venue: VenueRef,
  quantity: number
): void {
  const held = sellable.get(venue) ?? { settled: 0, guarded: 0 }
  const free = sellableQuantityOf(held)

  if (quantity > held.settled) {
    throw new OrderQuantityError('order.sell_unsettled', UNSETTLED_MESSAGE, held.settled)
  }

  if (quantity > free) {
    throw new OrderQuantityError('order.sell_guarded', GUARDED_MESSAGE, free)
  }
}

/** The staged row is the operator's terms plus the two identities every later step addresses it by:
 *  the token they quote back, and the id the exchange knows it as. */
export async function stageOrder(
  deps: OrderServiceDeps,
  input: StageOrderInput
): Promise<StagedOrder> {
  await assertBuyingAllowed(deps, input.request.side, input.signal)

  const { adapter } = adapterFor(deps.venues, input.prepared.venue)
  const staged: StagedOrder = {
    token: input.token,
    clientOrderId: adapter.toClientOrderId(input.token),
    instrument: input.prepared.instrument,
    venue: input.prepared.venue,
    symbol: input.prepared.symbol,
    side: input.request.side,
    orderType: input.request.orderType,
    quantity: input.prepared.quantity,
    quotePrice: input.prepared.quotePrice,
    notionalBase: input.prepared.notionalBase,
    createdAt: input.now,
    ...(input.prepared.limitPrice === undefined ? {} : { limitPrice: input.prepared.limitPrice }),
    ...input.prepared.exit,
  }

  await deps.intents.stage(staged, input.signal)

  return staged
}

interface CapsInput {
  readonly input: PrepareInput
  readonly notional: number
  readonly currency: CurrencyCode
  readonly asOf: TradingDay
  readonly instrument: InstrumentRef
  readonly segment: PortfolioSegment
  readonly venue: VenueRef
  readonly instrumentKind?: InstrumentKind
}

interface Caps {
  readonly notionalBase: number
  readonly rejections: readonly CapRejection[]
  readonly breaches: readonly SleeveBreach[]
}

/** The book plus the orders that placed and never reached it: the ledger cannot see a position
 *  whose mirror failed, nor the cash it spent, and a cap that ignores those is not a cap. */
async function capsFor(deps: OrderServiceDeps, caps: CapsInput): Promise<Caps> {
  const { input } = caps
  const book = await deps.portfolio.viewAbsolute({ now: input.now, signal: input.signal })
  const [notionalBase, unmirrored] = await Promise.all([
    deps.toBaseCurrency({
      amount: caps.notional,
      currency: caps.currency,
      asOf: caps.asOf,
      signal: input.signal,
    }),
    deps.intents.unmirroredExposure(input.signal),
  ])

  return {
    notionalBase,
    breaches: await buyBreaches(deps, caps, { book, notionalBase }),
    rejections: rejectionsFor(deps, {
      side: input.request.side,
      orderType: input.request.orderType,
      notional: caps.notional,
      notionalBase,
      hasStopLoss: input.request.exit?.stopLoss !== undefined,
      venue: caps.venue,
      book,
      unmirrored,
    }),
  }
}

/** What the caps say about one order, given one reading of the book. Shared because the same
 *  verdict is taken twice: once where the operator is told, and again where the order goes out. */
interface CapTerms {
  readonly side: OrderSide
  readonly orderType: OrderType
  readonly notional: number
  readonly notionalBase: number
  readonly hasStopLoss: boolean
  readonly venue: VenueRef
  readonly book: ValuedBook
  readonly unmirrored: UnmirroredExposure
}

export function rejectionsFor(deps: OrderServiceDeps, terms: CapTerms): readonly CapRejection[] {
  const cost = resolveTradeCost(terms.venue, deps.costs)

  return validateOrderCaps({
    policy: deps.policy,
    side: terms.side,
    notional: terms.notional,
    notionalBase: terms.notionalBase,
    orderType: terms.orderType,
    ...(cost === undefined ? {} : { cost }),
    availableCashBase: venueCashBase(terms),
    venue: terms.venue,
    openTrades: terms.book.positions.length + terms.unmirrored.count,
    hasStopLoss: terms.hasStopLoss,
  })
}

/** Unmirrored spend is whole-book and stays that way: subtracting all of it from one venue can
 *  refuse an order the book could afford, which is the right direction for a cash ceiling and
 *  avoids a per-venue query for rows that are rare and have to be cleared anyway. */
function venueCashBase(terms: CapTerms): number {
  const available = terms.book.book.cashByVenue.get(terms.venue)?.available ?? 0

  return available - terms.unmirrored.spentBase
}

interface ValuedOrder {
  readonly book: ValuedBook
  readonly notionalBase: number
}

/** A sell takes exposure off, so it reads no profile and crosses no ceiling. An operator who has
 *  saved none has declared no ceilings either, which states nothing rather than measuring against
 *  seeds they never chose. */
async function buyBreaches(
  deps: OrderServiceDeps,
  caps: CapsInput,
  valued: ValuedOrder
): Promise<readonly SleeveBreach[]> {
  if (caps.input.request.side !== 'buy') {
    return []
  }

  const profile = await deps.findProfile(caps.input.signal)

  if (profile === null) {
    return []
  }

  return breachedSleeves({
    profile,
    book: valued.book,
    instrument: caps.instrument,
    segment: caps.segment,
    notionalBase: valued.notionalBase,
    ...(caps.instrumentKind === undefined ? {} : { instrumentKind: caps.instrumentKind }),
  })
}

function driftOf(quote: number, limit: number): number {
  return Math.abs(quote - limit) / quote
}
