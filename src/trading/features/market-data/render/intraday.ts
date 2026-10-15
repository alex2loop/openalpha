import type { Locale } from '@/core/types/locale'
import type {
  IntradayField,
  IntradayMarketContext,
  IntradayReport,
  IntradayRow,
  IntradaySettled,
} from '@/trading/features/market-data/intraday/types'
import type { SessionPhase } from '@/trading/kernel/instrument'
import type { QuoteFreshness } from '@/trading/kernel/market/market-data'
import type { MarketIntradayBreadth } from '@/trading/kernel/market/market-overview'
import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { RenderContext } from '@/trading/render/format'
import type { PricePair } from '@/trading/render/price-pair'
import { formatDay, t } from '@/i18n'
import { INTRADAY_FIELDS } from '@/trading/features/market-data/intraday/types'
import { MOVER_KIND } from '@/trading/kernel/market/market-overview'
import { renderCaveatLines } from '@/trading/render/caveat'
import { formatClock } from '@/trading/render/datetime'
import { formatCount, renderDeclaredValue, SECTION_ICONS } from '@/trading/render/format'
import {
  INDENT,
  joinSections,
  renderOverflowLine,
  renderSectionTitle,
  toFactLines,
  withoutUnfilledWindow,
} from '@/trading/render/layout'
import { renderBoardScaleNotes } from '@/trading/render/money'
import { liveMoveOf, renderPricePair, renderSessionRange } from '@/trading/render/price-pair'
import { headRowFacts, labelledRowFacts, renderSectionHeading } from '@/trading/render/section'

const MOVER_FIELDS: ReadonlySet<IntradayField> = new Set(Object.values(MOVER_KIND))

/** The two lists render alike and differ only in their labels, so one renderer takes them and the
 *  caller names which block it is asking for. */
interface ListLabels {
  readonly title: 'trading.intraday.positions.title' | 'trading.intraday.watchlist.title'
  readonly empty: 'trading.intraday.positions.empty' | 'trading.intraday.watchlist.empty'
  readonly icon: string
  readonly overflow: number
  /** What leads the rows, where the list has something to say about itself as a whole. */
  readonly summary: readonly string[]
}

/** What every row needs beyond its own values: the instant the report was built, to age a reading
 *  against. */
interface RowContext extends RenderContext {
  readonly locale: Locale
  readonly firedAt: number
}

export function renderIntradayText(
  locale: Locale,
  report: IntradayReport,
  context: RenderContext
): string {
  const rowContext: RowContext = { ...context, locale, firedAt: report.firedAt }
  const blocks = [
    renderHeader(rowContext, report),
    ...(report.session === undefined ? [] : [renderSession(locale, report.session, report.phase)]),
    renderList(rowContext, report.positions, {
      title: 'trading.intraday.positions.title',
      empty: 'trading.intraday.positions.empty',
      icon: SECTION_ICONS.positions,
      overflow: report.positionsOverflow,
      summary: fallingLine(rowContext, report.positions),
    }),
    renderList(rowContext, report.watchlist, {
      title: 'trading.intraday.watchlist.title',
      empty: 'trading.intraday.watchlist.empty',
      icon: SECTION_ICONS.watchlist,
      overflow: report.watchlistOverflow,
      summary: [],
    }),
    ...report.contexts.map((entry) => renderContext(rowContext, entry)),
    ...(report.settled === undefined ? [] : [renderSettled(rowContext, report.settled)]),
    ...(report.sessionForming ? [t(locale, 'trading.intraday.note.forming')] : []),
  ]
  const boardScale = renderBoardScaleNotes(locale, [
    ...report.indexes,
    ...report.positions,
    ...report.watchlist,
  ])
  const caveats = renderCaveatLines(locale, report.caveats)

  return joinSections([...blocks.map((block) => [block]), boardScale, caveats])
}

function renderHeader(context: RowContext, report: IntradayReport): string {
  const { locale } = context
  const title = t(locale, 'trading.intraday.header', {
    icon: SECTION_ICONS.intraday,
    market: renderDeclaredValue(locale, `trading.market.${report.market}`),
    phase: t(locale, `trading.intraday.phase.${report.phase}`),
    time: formatClock(locale, report.firedAt, context.timezone),
  })

  return [title, ...report.indexes.map((row) => renderIndex(context, row))].join('\n')
}

/** An index carries no currency and a name does; everything else about the two rows is the same
 *  pair, so one builder owns it and the tally below can ask it the same question the rows ask.
 *  Absent for a row whose quote never came back, which has no reading to pair. */
function toPricePair(context: RowContext, row: IntradayRow): PricePair | undefined {
  const { price, observed } = row

  if (price === undefined || observed === undefined) {
    return undefined
  }

  return {
    timezone: context.timezone,
    ...(row.currency === undefined ? {} : { currency: row.currency }),
    ...(row.display === undefined ? {} : { display: row.display }),
    ...(row.previousClose === undefined ? {} : { previousClose: row.previousClose }),
    live: {
      price,
      ...(row.changePct === undefined ? {} : { changePct: row.changePct }),
      observed,
    },
  }
}

function renderIndex(context: RowContext, row: IntradayRow): string {
  const { locale } = context
  const pair = toPricePair(context, row)

  if (pair === undefined) {
    return `${INDENT[1]}${t(locale, 'trading.intraday.row.unpriced', { ticker: row.ticker })}`
  }

  const prices = renderPricePair(locale, pair, { context, depth: 2 })

  return [
    `${INDENT[1]}${row.ticker}`,
    ...prices,
    ...sessionLines(context, row).map((line) => `${INDENT[2]}${line}`),
  ].join('\n')
}

/** Only rows that actually print a live reading count, and each contributes the move that row
 *  shows: outside a session every row carries its settled change, and a tally over those reports
 *  yesterday's moves as what the book is doing now. The sentence says `live` rather than `priced`
 *  for the same reason — every row below carries a price, and only some of them carry this move. */
function fallingLine(context: RowContext, rows: readonly IntradayRow[]): readonly string[] {
  const moves = rows.flatMap((row) => {
    const pair = toPricePair(context, row)
    const move = pair === undefined ? undefined : liveMoveOf(pair)

    return move === undefined ? [] : [move]
  })

  if (moves.length === 0) {
    return []
  }

  return [
    `${INDENT[1]}${t(context.locale, 'trading.intraday.positions.falling', {
      falling: formatCount(context.locale, moves.filter((move) => move < 0).length),
      live: formatCount(context.locale, moves.length),
    })}`,
  ]
}

function renderList(context: RowContext, rows: readonly IntradayRow[], labels: ListLabels): string {
  const { locale } = context
  const title = `${labels.icon} ${t(locale, labels.title)}`

  if (rows.length === 0) {
    return [title, `${INDENT[1]}${t(locale, labels.empty)}`].join('\n')
  }

  const more = labels.overflow === 0 ? [] : [renderOverflowLine(locale, labels.overflow)]

  return [title, ...labels.summary, ...renderRows(context, rows), ...more].join('\n')
}

/** Grouped only when the rows actually span markets: a heading over a single-market book names
 *  what the report already said, while an ungrouped mixed book puts two currencies and two
 *  session clocks in one column and invites reading them as one. */
function renderRows(context: RowContext, rows: readonly IntradayRow[]): readonly string[] {
  const markets = [...new Set(rows.map((row) => row.market))]

  if (markets.length === 1) {
    return rows.map((row) => renderInstrumentRow(context, row, 1))
  }

  return markets.flatMap((market) => [
    `${INDENT[1]}${renderDeclaredValue(context.locale, `trading.market.${market}`)}`,
    ...rows
      .filter((row) => row.market === market)
      .map((row) => renderInstrumentRow(context, row, 2)),
  ])
}

/** The name, then the two dated readings under it — the same block `/price` and `/portfolio` print,
 *  so one instrument reads alike wherever it appears. A row the session has not printed a trade for
 *  says so on the name line rather than reporting the 0% its reference price would imply. */
function renderInstrumentRow(context: RowContext, row: IntradayRow, depth: number): string {
  const { locale } = context
  const pair = toPricePair(context, row)
  const indent = INDENT[depth] ?? ''

  if (pair === undefined || row.currency === undefined || row.observed === undefined) {
    return `${indent}${t(locale, 'trading.intraday.row.unpriced', { ticker: row.ticker })}`
  }

  const heading = `${indent}${headingOf(locale, row, row.observed)}`
  const prices = renderPricePair(locale, pair, { context, depth: depth + 1 })
  const detailIndent = INDENT[depth + 1] ?? indent

  return [
    heading,
    ...prices,
    ...sessionLines(context, row).map((line) => `${detailIndent}${line}`),
  ].join('\n')
}

/** Dated by the reading it belongs to, never by today: outside a session the provider answers with
 *  the previous session's range, and the same line then says which one it measured. */
function sessionLines(context: RowContext, row: IntradayRow): readonly string[] {
  if (row.session === undefined || row.observed === undefined) {
    return []
  }

  return [
    renderSessionRange(
      context.locale,
      { session: row.session, day: row.observed.day },
      row.display
    ),
  ]
}

/** The name alone, unless the session has printed no trade for it - which the row has to say, or
 *  its reference price reads as a flat session it never had. */
function headingOf(locale: Locale, row: IntradayRow, observed: QuoteFreshness): string {
  if (observed.kind === 'live' && row.traded === false) {
    return t(locale, 'trading.intraday.row.noTrade', { ticker: row.ticker })
  }

  if (row.gapFailed === true) {
    return t(locale, 'trading.intraday.row.failedGap', { ticker: row.ticker })
  }

  return row.ticker
}

/** Counts only, and a word of its own for the denominator: `matched` climbs through the session
 *  while the settled block's `measured` is a finished number, and a reader who subtracts one from
 *  the other reads a market that lost names. */
function renderSession(
  locale: Locale,
  session: MarketIntradayBreadth,
  phase: SessionPhase
): string {
  const key =
    phase === 'open' || phase === 'break'
      ? 'trading.intraday.session.title'
      : 'trading.intraday.session.closedTitle'
  const title = renderSectionTitle(
    SECTION_ICONS.reflect,
    t(locale, key, {
      day: formatDay(locale, session.at),
    })
  )

  return [
    title,
    `${INDENT[1]}${t(locale, 'trading.intraday.session.breadth', {
      advancers: formatCount(locale, session.advancers),
      decliners: formatCount(locale, session.decliners),
      matched: formatCount(locale, session.matched),
    })}`,
  ].join('\n')
}

/** Every field renders in tuple order, an absent one as "not reported", so the block's shape never
 *  changes with the data. The first row rides the label; the rest sit under it, because a field with
 *  more to say is still one field. */
function renderSettled(context: RowContext, settled: IntradaySettled): string {
  const { locale } = context
  const title = renderSectionTitle(
    SECTION_ICONS.portfolio,
    t(locale, 'trading.intraday.settled.title', {
      day: formatDay(locale, settled.day),
    })
  )

  return [
    title,
    ...INTRADAY_FIELDS.filter((field) => isReportableField(settled, field)).flatMap((field) =>
      renderSettledField({ locale, context }, settled, field)
    ),
  ].join('\n')
}

/** A market measures its movers over one window, so the twin it does not publish is an impossibility
 *  rather than a gap, and reporting it missing would claim the market went quiet. Every other field
 *  keeps its placeholder, which is what holds the block's shape steady. */
function isReportableField(settled: IntradaySettled, field: IntradayField): boolean {
  return !MOVER_FIELDS.has(field) || settled.fields.some((entry) => entry.field === field)
}

function renderSettledField(
  row: { readonly locale: Locale; readonly context: RenderContext },
  settled: IntradaySettled,
  field: IntradayField
): readonly string[] {
  const { locale, context } = row
  const entry = settled.fields.find((candidate) => candidate.field === field)
  const label = withoutUnfilledWindow(
    t(locale, `trading.intraday.field.${field}`, entry?.labelParams)
  )
  const [first, ...rest] = entry?.rows ?? []

  if (first === undefined) {
    return [`${INDENT[1]}${label} ${missing(locale)}`]
  }

  const { currency } = settled

  const unit = currency === undefined ? {} : { currency }
  const [lead, ...tail] = headRowFacts(locale, first, unit)

  return [
    ...toFactLines([`${label} ${lead ?? missing(locale)}`, ...tail], context, 1),
    ...rest.flatMap((entryRow) =>
      toFactLines(labelledRowFacts(locale, entryRow, unit), context, 2)
    ),
  ]
}

/** A held market the report does not otherwise cover, named once with what it publishes beyond a
 *  price. One line per section, because each carries a single row. */
function renderContext(context: RowContext, entry: IntradayMarketContext): string {
  const { locale } = context
  const title = `${entry.icon} ${renderDeclaredValue(locale, `trading.market.${entry.market}`)}`

  return [
    title,
    ...entry.sections.flatMap((section) => renderContextSection(context, section)),
  ].join('\n')
}

/** The heading names the block and the facts fall under it, as many to a line as the destination
 *  fits: a market publishing four readings ran to one line nobody could read on a phone. */
function renderContextSection(context: RowContext, section: BriefSectionResult): readonly string[] {
  const { locale } = context
  const ready = section.status === 'ready' ? section : undefined
  const facts = (ready?.rows ?? []).flatMap((row) =>
    labelledRowFacts(locale, row, ready?.currency === undefined ? {} : { currency: ready.currency })
  )

  return [
    `${INDENT[1]}${renderSectionHeading(locale, section, context.timezone)}`,
    ...toFactLines(facts, context, 2),
  ]
}

function missing(locale: Locale): string {
  return t(locale, 'trading.intraday.value.missing')
}
