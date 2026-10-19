import type { Locale } from '@/core/types/locale'
import type { BookDisplay } from '@/trading/features/portfolio/render/rows'
import type { ValuedBook } from '@/trading/features/portfolio/types'
import type {
  InstrumentKind,
  InstrumentRef,
  MarketRef,
  PortfolioSegment,
} from '@/trading/kernel/instrument'
import type { MarketEvent } from '@/trading/kernel/market/market-data'
import type { StopCover, StopDistance } from '@/trading/kernel/operator/alert'
import type { ProfileStamp, RiskCapSet } from '@/trading/kernel/operator/profile'
import type { RenderContext } from '@/trading/render/format'
import type { BoardQuoted, QuoteConvention } from '@/trading/render/money'
import { formatDay, pluralKey, t } from '@/i18n'
import { renderAllocationSection } from '@/trading/features/portfolio/render/allocation'
import { renderAttentionLines } from '@/trading/features/portfolio/render/attention'
import { renderCashSections } from '@/trading/features/portfolio/render/cash'
import { renderPositionSection } from '@/trading/features/portfolio/render/rows'
import { renderProfileStamp } from '@/trading/features/profile/render'
import { buildInstrumentKey, CASH_SEGMENT, ETF_KIND } from '@/trading/kernel/instrument'
import { renderCaveatLines } from '@/trading/render/caveat'
import {
  formatCount,
  formatFixedFraction,
  formatFlow,
  formatSignedFraction,
  renderDeclaredValue,
  SECTION_ICONS,
  SEVERITY_MARKS,
} from '@/trading/render/format'
import { renderFreshness } from '@/trading/render/freshness'
import { INDENT, joinSections, renderSectionTitle, toFactLines } from '@/trading/render/layout'
import { formatMoney, formatSignedMoney, renderBoardScaleNotes } from '@/trading/render/money'
import { apportion, FRACTION_QUANTUM } from '@/trading/render/number'

const PARTIAL_NAV_CAVEAT = 'valuation.partial-nav'
/** Cash may sit this far above its policy target before the report points at `/rebalance`. */
const CASH_NUDGE_MIN_GAP = 0.1

/** A dated corporate event on a name the operator holds. The instrument travels with it because a
 *  date alone cannot say which position it moves. */
export interface UpcomingEvent {
  readonly instrument: InstrumentRef
  readonly event: MarketEvent
}

/** The profile's cash-segment target as a fraction of NAV — policy is advice territory, never
 *  pricing. */
interface PortfolioRenderOptions {
  /** Where the text is going: its clock, its line width, and whether it can hold a padded column.
   *  Resolved once per command from `ctx.surface`. */
  readonly context: RenderContext
  readonly cashTargetPctNav?: number
  readonly upcoming?: readonly UpcomingEvent[]
  /** How each holding's market quotes a price. A renderer cannot reach the registry, so the command
   *  resolves one entry per market in the book. */
  readonly quoteConventions?: ReadonlyMap<MarketRef, QuoteConvention>
  /** The cap on one sector. */
  readonly sectorCapPctNav: number
  /** The policy the caps below were read off, stated once at the top instead of per row. */
  readonly profile: ProfileStamp
  /** Per-segment caps, so each allocation row is read against the limit its weight is measured by. */
  readonly segmentCaps?: Readonly<Record<PortfolioSegment, RiskCapSet>>
  /** Per instrument key, the kind the stored record files it under. A renderer cannot reach the
   *  store, so the command resolves one map for the whole book. */
  readonly instrumentKinds?: ReadonlyMap<string, InstrumentKind>
  /** Distance to stop per held instrument, keyed by `buildInstrumentKey`. The command resolves one
   *  map for the whole book; a renderer cannot reach a service. */
  readonly stopDistances?: ReadonlyMap<string, StopDistance>
  /** Per instrument the book could place a stop for, whether one is standing at every venue holding
   *  it. An instrument absent from it could carry none, and its row says nothing either way. */
  readonly restingStops?: ReadonlyMap<string, StopCover>
  /** Per instrument key, the smallest order any venue holding it accepts. The command resolves one
   *  map for the whole book; a renderer cannot reach a venue. */
  readonly minimumSizes?: ReadonlyMap<string, number>
}

export function renderPortfolioText(
  locale: Locale,
  book: ValuedBook,
  options: PortfolioRenderOptions
): string {
  const display = {
    currency: book.book.baseCurrency,
    context: options.context,
    sectorCapPctNav: options.sectorCapPctNav,
    segmentWeights: apportionedSegmentWeights(book),
    ...(options.quoteConventions === undefined
      ? {}
      : { quoteConventions: options.quoteConventions }),
    ...(options.segmentCaps === undefined ? {} : { segmentCaps: options.segmentCaps }),
    ...(options.instrumentKinds === undefined ? {} : { instrumentKinds: options.instrumentKinds }),
    ...(options.stopDistances === undefined ? {} : { stopDistances: options.stopDistances }),
    ...(options.restingStops === undefined ? {} : { restingStops: options.restingStops }),
    ...(options.minimumSizes === undefined ? {} : { minimumSizes: options.minimumSizes }),
  }

  return joinSections([
    renderHeadline(locale, book, options),
    [
      ...renderAttentionLines(
        locale,
        [...(options.stopDistances?.values() ?? [])],
        (distance) =>
          options.instrumentKinds?.get(buildInstrumentKey(distance.instrument)) === ETF_KIND
      ),
      ...renderCashNudge(locale, display, options),
    ],
    // What the reader came for sits right under the warnings; the money statements follow it.
    renderPositionSection(locale, book, display),
    ...renderCashSections(locale, book, display),
    renderAllocationSection(locale, book, display),
    renderUpcoming(locale, options.upcoming ?? []),
    // The headline already states a partial valuation and names how many holdings caused it, so the
    // generic caveat would be the same sentence twice.
    renderCaveatLines(
      locale,
      book.caveats.filter((caveat) => caveat.code !== PARTIAL_NAV_CAVEAT)
    ),
    [
      ...renderBoardScaleNote(locale, book, options),
      renderProfileStamp(locale, options.profile),
    ].map((line) => line.trimStart()),
  ])
}

/** The weight column divides NAV over these segments, so it is rounded as a set rather than cell by
 *  cell, as `/rebalance` already rounds its own segment table: singly it printed 100,01%. Read by
 *  every line of this message that states a segment's weight, so none of them can round apart. */
function apportionedSegmentWeights(book: ValuedBook): ReadonlyMap<PortfolioSegment, number> {
  const weights = apportion(
    book.segmentValues.map((entry) => entry.weightPctNav),
    FRACTION_QUANTUM
  )

  return new Map(
    book.segmentValues.map((entry, index) => [entry.segment, weights[index] ?? entry.weightPctNav])
  )
}

/** The position rows quote each holding the way its own market does, so a board-scaled market needs
 *  the same note every other board-mixing list prints - once per convention, under the rows. */
function renderBoardScaleNote(
  locale: Locale,
  book: ValuedBook,
  options: PortfolioRenderOptions
): readonly string[] {
  const quotes: readonly BoardQuoted[] = book.positions.map((valued) => {
    const { market } = valued.position.instrument
    const display = options.quoteConventions?.get(market)?.display

    return {
      market,
      currency: valued.position.currency,
      ...(display === undefined ? {} : { display }),
    }
  })

  return renderBoardScaleNotes(locale, quotes).map((note) => `${INDENT[1]}${note}`)
}

/** What the book is worth, what it cost, and what today did to it — the three numbers a reader who
 *  stops after the first block should still have. */
function renderHeadline(
  locale: Locale,
  book: ValuedBook,
  options: PortfolioRenderOptions
): readonly string[] {
  const currency = book.book.baseCurrency

  if (book.navBase === undefined) {
    const unpriced = book.positions.filter((valued) => valued.kind === 'unpriced').length

    return [
      renderSectionTitle(
        SECTION_ICONS.portfolio,
        t(
          locale,
          pluralKey(
            unpriced,
            'trading.render.portfolio.navUnavailableOne',
            'trading.render.portfolio.navUnavailable'
          ),
          { count: formatCount(locale, unpriced) }
        )
      ),
    ]
  }

  return [
    `${renderSectionTitle(
      SECTION_ICONS.portfolio,
      t(locale, 'trading.render.portfolio.nav', {
        nav: formatMoney(locale, book.navBase, currency),
        compact: formatFlow(locale, book.navBase),
      })
    )}${renderFreshness(locale, book.freshness, options.context.timezone)}`,
    ...renderTotalPnl(locale, book, options.context),
    ...renderLatestMoveLine(locale, book),
  ]
}

/** What went in and what it has become are two facts, so a narrow destination stacks them rather
 *  than wrapping one line mid-figure. Deposits at or below zero make the ratio meaningless rather
 *  than infinite. */
function renderTotalPnl(
  locale: Locale,
  book: ValuedBook,
  context: RenderContext
): readonly string[] {
  const currency = book.book.baseCurrency
  const deposits = book.book.netDepositsBase
  const pnlBase = (book.navBase ?? 0) - deposits
  const pnl = { pnl: formatSignedMoney(locale, pnlBase, currency) }
  const result =
    deposits <= 0
      ? t(locale, 'trading.render.portfolio.totalPnl', pnl)
      : t(locale, 'trading.render.portfolio.totalPnlPct', {
          ...pnl,
          pct: formatSignedFraction(locale, pnlBase / deposits),
        })

  return toFactLines(
    [
      t(locale, 'trading.render.portfolio.deposits', {
        deposits: formatMoney(locale, deposits, currency),
      }),
      result,
    ],
    context,
    1
  )
}

/** Each leg contributes the move of its own latest reading: a settled close's session, a live
 *  quote's gap to the close. Dated by the oldest reading only when that is not the book's own day,
 *  because a bare "latest" on a non-trading day names a session the reader is not in. */
function renderLatestMoveLine(locale: Locale, book: ValuedBook): readonly string[] {
  const { dayChange } = book

  if (dayChange === undefined) {
    return []
  }

  const shared = {
    pnl: formatSignedMoney(locale, dayChange.amountBase, book.book.baseCurrency),
    pct: formatSignedFraction(locale, dayChange.fraction),
  }

  if (book.book.asOf === dayChange.at) {
    return [`${INDENT[1]}${t(locale, 'trading.render.portfolio.latestMove', shared)}`]
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.render.portfolio.latestMoveDated', {
      ...shared,
      day: formatDay(locale, dayChange.at),
    })}`,
  ]
}

/** Dates the operator would otherwise learn about from the gap-down. Omitted entirely when the
 *  calendar had nothing or could not be read — an empty heading answers nothing. */
function renderUpcoming(locale: Locale, events: readonly UpcomingEvent[]): readonly string[] {
  if (events.length === 0) {
    return []
  }

  return [
    renderSectionTitle(SECTION_ICONS.upcoming, t(locale, 'trading.render.portfolio.upcoming')),
    ...events.map(
      (row) =>
        `${INDENT[1]}${t(locale, 'trading.render.portfolio.upcomingRow', {
          ticker: row.instrument.ticker,
          event: renderDeclaredValue(locale, `trading.event.${row.event.kind}`),
          day: formatDay(locale, row.event.at),
        })}`
    ),
  ]
}

/** A surplus points at `/rebalance`, as a warning under the headline; a shortfall is what rebalance
 *  itself sells down. */
function renderCashNudge(
  locale: Locale,
  display: BookDisplay,
  options: PortfolioRenderOptions
): readonly string[] {
  if (options.cashTargetPctNav === undefined) {
    return []
  }

  // The weight the allocation table above already printed, not the fold's own: the three figures on
  // this line are read against that table, and one of them rounded apart is the whole defect.
  const current = display.segmentWeights.get(CASH_SEGMENT) ?? 0
  const gap = current - options.cashTargetPctNav

  if (gap < CASH_NUDGE_MIN_GAP) {
    return []
  }

  return [
    `${INDENT[1]}${SEVERITY_MARKS.warn} ${t(locale, 'trading.render.portfolio.cashNudge', {
      current: formatFixedFraction(locale, current),
      target: formatFixedFraction(locale, options.cashTargetPctNav),
      gap: formatFixedFraction(locale, gap),
    })}`,
  ]
}
