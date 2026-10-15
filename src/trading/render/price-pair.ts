import type { Locale } from '@/core/types/locale'
import type { CurrencyCode, PriceDisplay, QuoteUnit, TradingDay } from '@/trading/kernel/instrument'
import type { PreviousClose, QuoteBoardItem } from '@/trading/kernel/market/market-capability'
import type { QuoteFreshness, SessionSoFar } from '@/trading/kernel/market/market-data'
import type { RenderContext } from '@/trading/render/format'
import { formatDay, t } from '@/i18n'
import { formatInstant } from '@/trading/render/datetime'
import { formatFlow, formatSignedFixedPercent } from '@/trading/render/format'
import { INDENT, toFactLines } from '@/trading/render/layout'
import { formatPrice, formatQuotedPrice } from '@/trading/render/money'
import { changeAgainstClose } from '@/trading/sources/rows/normalization'

/** Separates padded cells inside a table row, after the row is already indented. */
const COLUMN_GAP = '  '

/** What a clock adds to a dated column: a space and `HH:mm`. A padding hint only — the column is
 *  never narrowed by it, so a locale that prints a longer clock still lines up. */
const CLOCK_COLUMN = 6

/** The two readings a move is measured between, and nothing about how they render. Named apart from
 *  `PricePair` so a consumer that wants only the number — a brief row, a board row — can pass the
 *  two readings without inventing the display fields it has no use for. */
interface PriceReadings {
  readonly previousClose?: PreviousClose
  readonly live?: LiveReading
}

/** The two readings a price-bearing surface states, never blended: what the last settled session
 *  closed at, and what the instrument is trading at now. Both dated, so neither can be mistaken for
 *  the other, and the live one is absent whenever the market has not printed a price. */
export interface PricePair extends PriceReadings {
  /** The operator's own clock, so a pair on a VN board and a pair on a crypto board read the same. */
  readonly timezone: string
  /** What the holder paid per unit, where the surface knows — the reading the other two are worth
   *  comparing against. Undated: a cost basis is an average over lots, so no single day owns it. */
  readonly unitCost?: number
  readonly currency?: CurrencyCode
  /** The measure the price is per, where the surface knows its market. A weight is not implied by
   *  the ticker, so a gold row says which one it is quoted per. */
  readonly unit?: QuoteUnit
  readonly display?: PriceDisplay
  /** The live reading is a dealer board's buy price. A board keeps no close, so the pair states that
   *  one quote under its own name, dated by when it was read. */
  readonly dealerBuy?: boolean
}

export interface LiveReading {
  readonly price: number
  readonly changePct?: number
  readonly observed: QuoteFreshness
}

/** Label, when, amount, move. A grid where the reader has a monospace font - padded to the widest
 *  entry so the rows read as a pair rather than two sentences - and the same cells joined inline
 *  where they do not. Every row leads with its own label, so a wrap can orphan nothing. */
/** Where the block sits and how wide its lines may run. The depth is the pair's own, so the rows
 *  arrive indented and the budget counts that indent rather than being overrun by it. */
interface PricePairPlacement {
  readonly context: RenderContext
  readonly depth: number
}

export function renderPricePair(
  locale: Locale,
  pair: PricePair,
  placement: PricePairPlacement
): readonly string[] {
  const { context, depth } = placement
  const rows = [
    ...unitCostRow(locale, pair),
    ...(pair.dealerBuy === true
      ? dealerBuyRow(locale, pair)
      : [...previousCloseRow(locale, pair), ...liveRow(locale, pair)]),
  ]

  if (context.layout === 'lines') {
    return rows.flatMap((row) => toFactLines(cellsOf(row), context, depth))
  }

  const labelWidth = widestOf(rows.map((row) => row.label))
  const whenWidth = Math.max(widestOf(rows.map((row) => row.when)), datedWidth(rows))

  return rows.map(
    (row) =>
      `${INDENT[depth] ?? ''}${[
        row.label.padEnd(labelWidth),
        row.when.padEnd(whenWidth),
        ...tail(row),
      ]
        .join(COLUMN_GAP)
        .trimEnd()}`
  )
}

function cellsOf(row: PriceRow): readonly string[] {
  return [row.label, row.when, row.amount, row.change ?? ''].filter((cell) => cell.length > 0)
}

function tail(row: PriceRow): readonly string[] {
  return row.change === undefined ? [row.amount] : [row.amount, row.change]
}

/** The column is sized for a dated row whether or not this pair carries one: a board where some
 *  names have traded and others have not would otherwise step its amounts left and right down the
 *  page. Only ever widens the column, so a locale whose clock is longer still fits. */
function datedWidth(rows: readonly PriceRow[]): number {
  const dated = rows.some((row) => row.dated)

  return dated ? 0 : widestOf(rows.map((row) => row.when)) + CLOCK_COLUMN
}

interface PriceRow {
  readonly label: string
  readonly when: string
  readonly amount: string
  /** The session's move, kept out of `amount` so a chat line can separate them the way it
   *  separates every other pair of cells. */
  readonly change?: string
  /** Whether `when` carries a clock as well as a day - what makes this the wider of the two rows. */
  readonly dated?: boolean
}

/** First, because it is the reading the other two are measured against, and because a reader
 *  scanning down the column sees what was paid before what it is now worth. */
function unitCostRow(locale: Locale, pair: PricePair): readonly PriceRow[] {
  const { unitCost } = pair

  if (unitCost === undefined) {
    return []
  }

  return [
    {
      label: t(locale, 'trading.render.price.costLabel'),
      when: '',
      amount: amountOf(locale, unitCost, pair),
    },
  ]
}

function previousCloseRow(locale: Locale, pair: PricePair): readonly PriceRow[] {
  const settled = settledCloseOf(pair)

  if (settled === undefined) {
    return []
  }

  return [
    {
      label: t(locale, 'trading.render.price.settledLabel'),
      when: formatDay(locale, settled.at),
      amount: amountOf(locale, settled.price, pair),
      ...(settled.changePct === undefined
        ? {}
        : { change: formatSignedFixedPercent(locale, settled.changePct) }),
    },
  ]
}

/** The settled close this pair states, and what that session moved. Normally the close the surface
 *  supplied; the reading itself once that reading is a close for a session newer than the series
 *  holds. A market whose provider has not yet published the session's own daily bar answers with
 *  exactly that, and taking the supplied close there printed the session before it as today's — the
 *  reading, which is the close, rendered nowhere at all.
 *
 *  The move follows the same reading: the surface's own where it supplied one, the reading's where
 *  the two are the same session (measuring a close against itself reports zero), and against the
 *  prior close where the reading is the newer one. */
function settledCloseOf(pair: PriceReadings): PreviousClose | undefined {
  const { live, previousClose } = pair

  if (live === undefined || live.observed.kind !== 'close') {
    return previousClose
  }

  if (previousClose !== undefined && live.observed.day <= previousClose.at) {
    const changePct = previousClose.changePct ?? (isSameSession(pair) ? live.changePct : undefined)

    return changePct === undefined ? previousClose : { ...previousClose, changePct }
  }

  const changePct = changeAgainstClose(live.price, previousClose?.price, live.changePct)

  return {
    price: live.price,
    at: live.observed.day,
    ...(changePct === undefined ? {} : { changePct }),
  }
}

/** Whether the live reading is the settled close — true once the session's own bar is stored. */
function isSameSession(pair: PriceReadings): boolean {
  return pair.previousClose !== undefined && pair.live?.observed.day === pair.previousClose.at
}

/** The move a live row would print, `undefined` wherever no live row renders. Exported so a tally
 *  counts what the rows show: the provider's own figure is a rolling window, and a count taken from
 *  it reports names as falling on a session they spent up. */
export function liveMoveOf(pair: PriceReadings): number | undefined {
  const { live } = pair

  if (live === undefined || live.observed.kind !== 'live' || isSameSession(pair)) {
    return undefined
  }

  return changeAgainstClose(live.price, pair.previousClose?.price, live.changePct)
}

/** The move for the one reading a board row states, where a surface prints a single line instead of
 *  the pair: the live reading's where a live row would render, the settled close's own otherwise.
 *  Asked here rather than re-derived, because a row that measures its own close against itself
 *  prints every settled session flat. */
export function quoteBoardMoveOf(item: QuoteBoardItem): number | undefined {
  const readings: PriceReadings = {
    ...(item.previousClose === undefined ? {} : { previousClose: item.previousClose }),
    live: {
      price: item.last,
      ...(item.changePct === undefined ? {} : { changePct: item.changePct }),
      observed: item.observed,
    },
  }

  return liveMoveOf(readings) ?? settledCloseOf(readings)?.changePct
}

/** Absent unless the market has actually printed a price: a close restated under a second label
 *  would claim a trade that has not happened, and a same-session pair would report that session as
 *  flat against itself.
 *
 *  Dated by the instant it was read, never by the session it belongs to: a market whose trading day
 *  is not the operator's calendar day — crypto for most of a UTC+7 evening — would otherwise pair
 *  one basis' day with the other's clock and print a stamp that never happened. The settled row
 *  above it is what names the session. */
function liveRow(locale: Locale, pair: PricePair): readonly PriceRow[] {
  const { live } = pair

  if (live === undefined || live.observed.kind !== 'live' || isSameSession(pair)) {
    return []
  }

  const amount = amountOf(locale, live.price, pair)
  const changePct = liveMoveOf(pair)

  return [
    {
      label: t(locale, 'trading.render.price.liveLabel'),
      when: formatInstant(locale, live.observed.observedAt, pair.timezone),
      dated: true,
      amount,
      ...(changePct === undefined ? {} : { change: formatSignedFixedPercent(locale, changePct) }),
    },
  ]
}

function dealerBuyRow(locale: Locale, pair: PricePair): readonly PriceRow[] {
  const { live } = pair

  if (live === undefined) {
    return []
  }

  return [
    {
      label: t(locale, 'trading.render.price.dealerBuyLabel'),
      when: formatInstant(locale, live.observed.observedAt, pair.timezone),
      dated: true,
      amount: amountOf(locale, live.price, pair),
    },
  ]
}

function amountOf(locale: Locale, value: number, pair: PricePair): string {
  if (pair.currency === undefined) {
    return formatPrice(locale, value, pair.display)
  }

  return formatQuotedPrice(locale, value, {
    currency: pair.currency,
    ...(pair.unit === undefined ? {} : { unit: pair.unit }),
    ...(pair.display === undefined ? {} : { display: pair.display }),
  })
}

function widestOf(values: readonly string[]): number {
  return values.reduce((widest, value) => Math.max(widest, value.length), 0)
}

/** Where in its session's range the price sits - the one fact a bare number cannot carry. Dated by
 *  the reading it belongs to, because a provider whose intraday series has not opened today answers
 *  with the previous session's range and "today" would be the wrong word for it. Two keys rather
 *  than an empty `{volume}`: a provider serving no intraday volume must not leave a gap. */
export function renderSessionRange(
  locale: Locale,
  reading: { readonly session: SessionSoFar; readonly day: TradingDay },
  display?: PriceDisplay
): string {
  const { session } = reading
  const bounds = {
    day: formatDay(locale, reading.day),
    low: formatPrice(locale, session.low, display),
    high: formatPrice(locale, session.high, display),
  }

  if (session.volume === undefined) {
    return t(locale, 'trading.render.quote.session', bounds)
  }

  return t(locale, 'trading.render.quote.sessionVolume', {
    ...bounds,
    volume: formatFlow(locale, session.volume),
  })
}
