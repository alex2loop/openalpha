import type { Locale } from '@/core/types/locale'
import type { Holding, ValuedBook, ValuedPosition } from '@/trading/features/portfolio/types'
import type {
  CurrencyCode,
  InstrumentKind,
  MarketRef,
  PortfolioSegment,
} from '@/trading/kernel/instrument'
import type { StopCover, StopDistance } from '@/trading/kernel/operator/alert'
import type { RiskCapSet } from '@/trading/kernel/operator/profile'
import type { RenderContext } from '@/trading/render/format'
import type { QuoteConvention, QuotedIn } from '@/trading/render/money'
import { formatDay, pluralKey, t } from '@/i18n'
import { openLots } from '@/trading/features/portfolio/folds/holdings'
import { renderUnplannedLine, riskFacts } from '@/trading/features/portfolio/render/attention'
import { buildInstrumentKey, ETF_KIND } from '@/trading/kernel/instrument'
import { isBelowMinimumSize } from '@/trading/kernel/venue/catalog'
import {
  formatCount,
  formatFixedFraction,
  formatQuantity,
  formatSignedFixedFraction,
  renderVenueName,
  SECTION_ICONS,
} from '@/trading/render/format'
import { renderKindBadge } from '@/trading/render/kind-badge'
import { INDENT, renderEmptyLine, renderSectionTitle, toFactLines } from '@/trading/render/layout'
import { renderMarketBlocks, toMarketBlocks } from '@/trading/render/market-blocks'
import {
  formatMoney,
  formatQuotedPrice,
  formatSignedMoney,
  quotedInOf,
} from '@/trading/render/money'
import { ABSENT_CELL } from '@/trading/render/number'
import { renderPricePair } from '@/trading/render/price-pair'

/** How each holding's market quotes a price, and the currency the book is folded in. A renderer
 *  cannot reach the registry, so the command resolves one entry per market in the book. */
export interface BookDisplay {
  readonly currency: CurrencyCode
  /** Where the text is going: its clock, its line width, and whether it can hold a padded column.
   *  Resolved once per command from `ctx.surface`. */
  readonly context: RenderContext
  readonly quoteConventions?: ReadonlyMap<MarketRef, QuoteConvention>
  readonly marketIcons: ReadonlyMap<MarketRef, string>
  /** Per instrument key, the kind the stored record files it under. A renderer cannot reach the
   *  store, so the command resolves one map for the whole book. */
  readonly instrumentKinds?: ReadonlyMap<string, InstrumentKind>
  /** Distance to stop per held instrument, keyed by `buildInstrumentKey`. */
  readonly stopDistances?: ReadonlyMap<string, StopDistance>
  readonly restingStops?: ReadonlyMap<string, StopCover>
  /** The cap on one sector, so a concentration row is read against the limit it will be measured by
   *  rather than in isolation. */
  readonly sectorCapPctNav: number
  /** Per-segment caps, so an allocation row is read against the limit its weight will be measured
   *  by rather than in isolation. */
  readonly segmentCaps?: Readonly<Record<PortfolioSegment, RiskCapSet>>
  /** Per instrument key, the smallest order any venue holding it accepts. */
  readonly minimumSizes?: ReadonlyMap<string, number>
  /** The weight each segment prints at. Apportioned once for the whole message, because a segment
   *  stated by the allocation table and again by a line below it must not read two ways. */
  readonly segmentWeights: ReadonlyMap<PortfolioSegment, number>
}

export function renderPositionSection(
  locale: Locale,
  book: ValuedBook,
  display: BookDisplay
): readonly string[] {
  const holdings = book.positions.filter((valued) => !isUntradeable(valued, display))
  const residue = book.positions.length - holdings.length

  if (holdings.length === 0) {
    return [
      renderEmptyLine(SECTION_ICONS.positions, t(locale, 'trading.render.portfolio.noPositions')),
      ...renderResidueLine(locale, residue),
    ]
  }

  const blocks = toMarketBlocks(holdings, (valued) => valued.position.instrument.market)

  return [
    renderSectionTitle(SECTION_ICONS.positions, t(locale, 'trading.render.portfolio.positions')),
    ...renderMarketBlocks(locale, blocks, {
      icons: display.marketIcons,
      renderRows: (positions) =>
        positions.flatMap((valued) => renderPosition(locale, valued, display)),
    }),
    ...renderUnplannedLine(locale, stopDistancesOf(holdings, display)),
    ...renderResidueLine(locale, residue),
  ]
}

/** Only the holdings this section printed: a name held back as residue would otherwise be counted
 *  under a block it has no row in. */
function stopDistancesOf(
  holdings: readonly ValuedPosition[],
  display: BookDisplay
): readonly StopDistance[] {
  return holdings.flatMap((valued) => {
    const distance = display.stopDistances?.get(buildInstrumentKey(valued.position.instrument))

    return distance === undefined ? [] : [distance]
  })
}

/** A row this section held back still counts toward NAV and toward the allocation table above, so
 *  omitting it silently leaves a weight with nothing under it. */
function renderResidueLine(locale: Locale, residue: number): readonly string[] {
  if (residue === 0) {
    return []
  }

  return [
    `${INDENT[1]}${t(
      locale,
      pluralKey(residue, 'trading.render.portfolio.residueOne', 'trading.render.portfolio.residue'),
      { count: formatCount(locale, residue) }
    )}`,
  ]
}

/** What a full exit left behind: the venue will not trade a quantity this small, so the row would
 *  state a holding the operator can neither sell nor act on. Its value still counts toward NAV,
 *  which is where a fraction of a unit belongs. */
function isUntradeable(valued: ValuedPosition, display: BookDisplay): boolean {
  const key = buildInstrumentKey(valued.position.instrument)

  return isBelowMinimumSize(valued.position.quantity, display.minimumSizes?.get(key))
}

function renderPosition(
  locale: Locale,
  valued: ValuedPosition,
  display: BookDisplay
): readonly string[] {
  const { instrument, quantity, currency } = valued.position
  const board = quotedInOf(display.quoteConventions?.get(instrument.market))
  const key = buildInstrumentKey(instrument)
  // Fee-bearing, as the broker app shows it: the entry fee is part of what the holding has to
  // clear, so the row's cost is the price an exit breaks even against.
  const investedNative = valued.position.costBasisNative
  const investedBase = valued.position.costBasisBase
  // `foldBook` drops positions at or below dust, so the unit cost never divides by zero. Native,
  // not base: a price row is quoted the way its own market quotes, so a crypto cost reads in USD
  // per coin rather than as billions of the book's currency.
  const unitCostNative = investedNative / quantity
  const unitCost = formatQuotedPrice(locale, unitCostNative, { currency, ...board })
  const shared = {
    ticker: `${instrument.ticker}${renderKindBadge(locale, display.instrumentKinds?.get(key))}`,
    quantity: formatQuantity(locale, quantity),
  }

  if (valued.kind === 'unpriced') {
    return [
      `${INDENT[1]}${t(locale, 'trading.render.portfolio.unpriced', shared)}`,
      `${INDENT[2]}${t(locale, 'trading.render.portfolio.unpricedDetail', {
        cost: unitCost,
        total: formatMoney(locale, investedBase, display.currency),
      })}`,
      ...renderVenueSplitLine(locale, valued.position, display.context),
      ...renderUnsettledLine(locale, valued),
    ]
  }

  return [
    ...toFactLines(
      [
        shared.ticker,
        shared.quantity,
        formatMoney(locale, valued.valueBase, display.currency),
        t(locale, 'trading.render.portfolio.positionWeight', {
          weight:
            valued.weightPctNav === undefined
              ? ABSENT_CELL
              : formatFixedFraction(locale, valued.weightPctNav),
        }),
      ],
      display.context,
      1
    ),
    ...renderPriceLines(locale, valued, {
      context: display.context,
      unitCost: unitCostNative,
      currency,
      ...board,
    }),
    ...positionFactLines(locale, valued, { ...display, quote: { currency, ...board } }),
    ...renderVenueSplitLine(locale, valued.position, display.context),
    ...renderUnsettledLine(locale, valued),
  ]
}

type PricedPosition = Extract<ValuedPosition, { readonly kind: 'priced' }>

/** What the holding has done and how old it is, then what leaving it costs on its own line, so the
 *  exit levels never share a line with the return. What it cost to open is quantity × the unit
 *  cost on the rows above, so the row does not restate it. */
function positionFactLines(
  locale: Locale,
  valued: PricedPosition,
  display: BookDisplay & { readonly quote: Partial<QuotedIn> }
): readonly string[] {
  const key = buildInstrumentKey(valued.position.instrument)
  const investedBase = valued.position.costBasisBase
  const pnlBase = valued.valueBase - investedBase

  return [
    ...toFactLines(
      [
        t(locale, 'trading.render.portfolio.positionDetail', {
          pnl: formatSignedMoney(locale, pnlBase, display.currency),
          pct: returnFraction(locale, pnlBase, investedBase),
        }),
        heldSinceFact(locale, valued),
      ],
      display.context,
      2
    ),
    ...toFactLines(
      riskFacts({
        locale,
        distance: display.stopDistances?.get(key),
        resting: display.restingStops?.get(key),
        fund: display.instrumentKinds?.get(key) === ETF_KIND,
        price: { at: valued.price, quote: display.quote, context: display.context },
      }),
      display.context,
      2
    ),
  ]
}

/** Only where the holding actually spans custodians. A one-venue holding has no split, and printing
 *  a split of one would state a fact the row above already carries. */
function renderVenueSplitLine(
  locale: Locale,
  holding: Holding,
  context: RenderContext
): readonly string[] {
  const { venueSplit } = holding

  if (venueSplit === undefined) {
    return []
  }

  const [first, ...rest] = venueSplit.map(
    (share) => `${renderVenueName(locale, share.venue)} ${formatQuantity(locale, share.units)}`
  )

  if (first === undefined) {
    return []
  }

  return toFactLines(
    [t(locale, 'trading.render.portfolio.venueSplit', { first }), ...rest],
    context,
    2
  )
}

/** The same dated rows `/price` prints, with what the holder paid above them. */
function renderPriceLines(
  locale: Locale,
  valued: ValuedPosition,
  board: QuotedIn & {
    readonly context: RenderContext
    readonly unitCost: number
  }
): readonly string[] {
  if (valued.kind !== 'priced') {
    return []
  }

  const { previousClose } = valued

  return renderPricePair(
    locale,
    {
      timezone: board.context.timezone,
      unitCost: board.unitCost,
      currency: board.currency,
      ...(previousClose === undefined
        ? {}
        : {
            previousClose: {
              price: previousClose.price,
              at: previousClose.at,
              ...(previousClose.changePct === undefined
                ? {}
                : { changePct: previousClose.changePct }),
            },
          }),
      live: {
        price: valued.price,
        ...(valued.changePct === undefined ? {} : { changePct: valued.changePct }),
        observed: valued.observed,
      },
      ...(board.unit === undefined ? {} : { unit: board.unit }),
      ...(board.display === undefined ? {} : { display: board.display }),
      ...(valued.dealerBuy === undefined ? {} : { dealerBuy: true }),
    },
    { context: board.context, depth: 2 }
  )
}

/** The day the oldest lot still carrying quantity was acquired. A session count would need the
 *  quoting market's calendar, which no renderer may reach; the date answers the same question. */
function heldSinceFact(locale: Locale, valued: ValuedPosition): string {
  const oldest = openLots(valued.position.lots)[0]?.acquiredAt

  return oldest === undefined
    ? ''
    : t(locale, 'trading.render.portfolio.heldSince', { day: formatDay(locale, oldest) })
}

/** Named only when there is one: the operator cannot sell an unsettled parcel today, and that is
 *  the fact a bare quantity hides. Judged on the rendered parcel, which is the only number this
 *  line shows: one too small to print says nothing is unsettled. */
function renderUnsettledLine(locale: Locale, valued: ValuedPosition): readonly string[] {
  const { position } = valued
  const unsettled = position.quantity - position.settledQuantity
  const quantity = formatQuantity(locale, unsettled)

  if (unsettled <= 0 || quantity === formatQuantity(locale, 0)) {
    return []
  }

  return [`${INDENT[2]}${t(locale, 'trading.render.portfolio.unsettled', { quantity })}`]
}

function returnFraction(locale: Locale, pnlBase: number, costBasisBase: number): string {
  if (costBasisBase <= 0) {
    return ABSENT_CELL
  }

  return formatSignedFixedFraction(locale, pnlBase / costBasisBase)
}
