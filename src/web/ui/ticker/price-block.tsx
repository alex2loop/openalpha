import { useEffect } from 'preact/hooks'

import type { TradingPriceChartResponse } from '@/app/server/wire/price-chart'
import type { TradingCandleWire, TradingQuoteWire } from '@/app/server/wire/trading'
import type { PriceWindow } from '@/app/server/wire/vocab'
import { formatDay, termOfKind, termOfTicker, translateDisplayText } from '@/i18n'
import { ApiFailure, getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { useBlockRead } from '@/web/state/block'
import { findMarket, findQuote, keyOf, quotesBlock, stopsBlock } from '@/web/state/market'
import { PRICE_WINDOWS, pickPriceWindow, priceWindow } from '@/web/state/price-window'
import { isRefreshable, useRereadAfterRefresh } from '@/web/state/refresh'
import { locale, state } from '@/web/state/session'
import { formatCompactAmount, formatMultiple } from '@/web/text/figures'
import { INLINE_SEPARATOR, joinInline } from '@/web/text/glyphs'
import { toTickFormatter } from '@/web/text/market-price'
import { sectorName } from '@/web/text/segment'
import { tr } from '@/web/text/tr'
import { Term } from '@/web/ui/glossary/term'
import { Button } from '@/web/ui/kit/button'
import { TrendIcon } from '@/web/ui/kit/icons'
import { Segmented } from '@/web/ui/kit/segmented'
import { RefreshMarketsButton } from '@/web/ui/market/refresh-button'
import { type ChartLevel, PriceChart } from '@/web/ui/ticker/chart/price-chart'
import { type LiveQuote, useLiveQuote } from '@/web/ui/ticker/live-quote'
import { type PriceFacts, PriceHead, sessionRangeOf } from '@/web/ui/ticker/price-head'
import { BlockFrame } from '@/web/ui/today/block-frame'

const NO_CHART: ChartRead = Object.freeze({ bars: [], averages: [], caveats: [] })

/** What the card draws: a market with no bars of its own answers none. */
type ChartRead = Pick<
  TradingPriceChartResponse,
  'bars' | 'averages' | 'sector' | 'relativeVolume' | 'caveats'
>

interface PriceBlockProps {
  readonly ticker: string
  readonly market: string
  readonly levels: readonly ChartLevel[]
}

interface PriceCardProps extends PriceBlockProps {
  readonly span: PriceWindow
}

/** The name, its price with the session it belongs to, and its chart over the span picked, with the
 *  plan's levels on it. Without any price it says so and offers to refresh its market; its head
 *  button reads this one name's price live, then the chart again. */
export function PriceBlock(props: PriceBlockProps) {
  const span = priceWindow.value

  return <PriceCard key={span} span={span} {...props} />
}

// The read is fixed for the block's life, so each span is its own block.
function PriceCard(props: PriceCardProps) {
  const { ticker, market, span } = props
  const reading = useBlockRead(readChart(ticker, market, span), {
    capability: ROUTES.priceChart.capability,
  })
  const live = useLiveQuote(ticker, market, reading.retry)

  useRereadAfterRefresh(reading.retry)

  const board = findQuote(ticker, market)
  const quote = newerQuote(live.quote, board)
  const labelTail = toLabelTail(reading.data?.sector)
  // An index, a fund or world gold says what it is, in the glossary's words.
  const term = termOfTicker(ticker) ?? (quote === undefined ? undefined : termOfKind(quote.kind))

  useLiveWhileTrading({ ticker, market }, { quote, live })

  return (
    <BlockFrame
      title={`${ticker}${labelTail}`}
      colour="teal"
      icon={<TrendIcon />}
      reading={reading}
      showReadLine={false}
      titleView={
        term === undefined ? undefined : (
          <span>
            <Term id={term}>{ticker}</Term>
            {labelTail}
          </span>
        )
      }
      action={<RefreshPriceButton live={live} />}
    >
      {(chart) => (
        <>
          {live.failure !== undefined && <p class="failure-line">{live.failure}</p>}
          <PriceBody {...props} chart={chart} quote={quote} />
        </>
      )}
    </BlockFrame>
  )
}

function RefreshPriceButton({ live }: { readonly live: LiveQuote }) {
  if (state.value?.capabilities.quotes === false) {
    return null
  }

  return (
    <Button size="small" disabled={live.isBusy} onClick={live.refresh}>
      {tr('ui.office.ticker.refresh')}
    </Button>
  )
}

// What follows the ticker in the title: the sector, where the market files the name under one.
function toLabelTail(sector: string | undefined): string {
  return sector === undefined ? '' : ` ${INLINE_SEPARATOR} ${sectorName(sector)}`
}

// A market that is trading shows its live price, not the close the board fell back to: one read
// when the page opens, the same one the Lấy giá mới button makes. A market with no session never
// closes, so it is always trading. A market with no price history of its own (a dealer's board) has
// nothing stored to show, so its live read is made at any hour.
function useLiveWhileTrading(
  { ticker, market }: { readonly ticker: string; readonly market: string },
  { quote, live }: { readonly quote: TradingQuoteWire | undefined; readonly live: LiveQuote }
): void {
  const isBoardKnown = quotesBlock.view.value.data !== undefined
  const held = findMarket(market)
  const isOpen = held !== undefined && (held.session === undefined || held.session.phase === 'open')
  const canQuote = state.value?.capabilities.quotes !== false
  const isLiveOnly = held?.hasBars === false
  const isClose = quote === undefined || quote.closedOn !== undefined

  useEffect(() => {
    if (isBoardKnown && (isOpen || isLiveOnly) && canQuote && isClose) {
      live.refresh()
    }
  }, [ticker, market, isBoardKnown, isOpen, isLiveOnly])
}

interface PriceBodyProps extends PriceCardProps {
  readonly chart: ChartRead
  readonly quote: TradingQuoteWire | undefined
}

function PriceBody({ ticker, market, levels, span, chart, quote }: PriceBodyProps) {
  const facts = resolvePrice({ ticker, market }, quote, chart.bars)

  if (facts === undefined) {
    return <NoPrice market={market} />
  }

  return (
    <>
      <PriceHead market={market} facts={facts} range={sessionRangeOf(quote, chart.bars)} />
      {chart.bars.length > 1 && (
        <ChartSection market={market} facts={facts} levels={levels} span={span} chart={chart} />
      )}
    </>
  )
}

function WindowPicker({ span }: { readonly span: PriceWindow }) {
  return (
    <Segmented
      label={tr('ui.office.windowPick')}
      value={span}
      options={PRICE_WINDOWS.map((choice) => ({
        value: choice,
        label: tr(`ui.office.window.${choice}`),
      }))}
      onChange={pickPriceWindow}
    />
  )
}

interface ChartSectionProps {
  readonly market: string
  readonly facts: PriceFacts
  readonly levels: readonly ChartLevel[]
  readonly span: PriceWindow
  readonly chart: ChartRead
}

function ChartSection({ market, facts, levels, span, chart }: ChartSectionProps) {
  const { bars, relativeVolume } = chart

  return (
    <>
      <WindowPicker span={span} />
      <PriceChart
        bars={bars}
        averages={chart.averages}
        levels={levels}
        span={span}
        formatPrice={toTickFormatter(market, facts)}
        formatDay={(day) => formatDay(locale.value, day)}
      />
      <p class="meta">
        {joinInline([
          tr('ui.office.ticker.sessions', { count: bars.length }),
          ...(levels.length > 0 ? [tr('ui.office.ticker.levelsNote')] : []),
        ])}
      </p>
      {relativeVolume !== undefined && <p class="meta">{formatRelativeVolume(relativeVolume)}</p>}
    </>
  )
}

function formatRelativeVolume(reading: NonNullable<ChartRead['relativeVolume']>): string {
  return tr('trading.render.quote.relativeVolume', {
    day: formatDay(locale.value, reading.day),
    volume: formatCompactAmount(reading.volume),
    ratio: formatMultiple(reading.ratio),
    sessions: reading.sessions,
  })
}

// Only the name's own market is refreshed: every market for one missing price costs minutes. Where
// it takes no refresh, the ticker is what to check.
function NoPrice({ market }: { readonly market: string }) {
  const held = findMarket(market)

  if (held === undefined || !isRefreshable(held)) {
    return <p class="meta">{tr('ui.office.ticker.noPrice')}</p>
  }

  return (
    <>
      <p class="meta">{tr('ui.office.ticker.noData')}</p>
      <RefreshMarketsButton markets={[held]} size="small" />
    </>
  )
}

// A name the daemon cannot find bars for has none to draw, which is an answer: the card says so.
function readChart(
  ticker: string,
  market: string,
  span: PriceWindow
): (abort: AbortSignal) => Promise<ChartRead> {
  return async (abort) => {
    // A dealer's board has no series of its own: the bars held for it are world gold in USD.
    if (findMarket(market)?.hasBars === false) {
      return NO_CHART
    }

    try {
      return await getJson(ROUTES.priceChart, {
        query: { market, ticker, window: span },
        signal: abort,
      })
    } catch (error: unknown) {
      if (error instanceof ApiFailure && error.code === 'not_found') {
        return NO_CHART
      }

      throw error
    }
  }
}

// The newer of the price read on request and the board's, by when each was taken.
function newerQuote(
  live: TradingQuoteWire | undefined,
  board: TradingQuoteWire | undefined
): TradingQuoteWire | undefined {
  if (live === undefined || board === undefined) {
    return live ?? board
  }

  return (toQuoteTimes(live).readAt ?? 0) >= (toQuoteTimes(board).readAt ?? 0) ? live : board
}

// The quote when there is one, else the mark a holding's stop was measured from, else the last
// close the bars carry, dated.
function resolvePrice(
  { ticker, market }: { readonly ticker: string; readonly market: string },
  quote: TradingQuoteWire | undefined,
  bars: readonly TradingCandleWire[]
): PriceFacts | undefined {
  if (quote !== undefined) {
    return {
      value: quote.last,
      ...(quote.changePct === undefined ? {} : { changePct: quote.changePct }),
      isLevel: quote.isLevel,
      ...(quote.board === undefined ? {} : { board: quote.board }),
      session: quote.board === undefined ? describeSession(market, quote.closedOn) : '',
      ...toQuoteTimes(quote),
      ...liveClose(quote, bars),
    }
  }

  const mark = stopsBlock.view.value.data?.stops.find(
    (stop) => keyOf(stop.instrument) === keyOf({ market, ticker })
  )?.price
  const markReadAt = stopsBlock.view.value.readAt

  if (mark !== undefined) {
    return {
      value: mark,
      session: describeSession(market, undefined),
      ...(markReadAt === undefined ? {} : { readAt: markReadAt }),
    }
  }

  const last = bars.at(-1)

  return last === undefined
    ? undefined
    : { value: last.close, session: describeSession(market, last.at) }
}

// A live price states the last settled close beside it, dated, never one in place of the other.
function liveClose(
  quote: TradingQuoteWire,
  bars: readonly TradingCandleWire[]
): Pick<PriceFacts, 'close'> {
  const last = bars.at(-1)

  return quote.closedOn !== undefined || quote.staleAt !== undefined || last === undefined
    ? {}
    : { close: { day: last.at, value: last.close } }
}

// When the quote was taken: the newest of its sources' own reading times.
function toQuoteTimes(quote: TradingQuoteWire): Pick<PriceFacts, 'readAt' | 'staleAt'> {
  const times = quote.provenance.map((source) => source.observedAt ?? source.fetchedAt)

  return {
    ...(times.length === 0 ? {} : { readAt: Math.max(...times) }),
    ...(quote.staleAt === undefined ? {} : { staleAt: quote.staleAt }),
  }
}

// A settled close names its day; a live price names the phase the market is in, where the catalog
// has a word for it.
function describeSession(market: string, closedOn: string | undefined): string {
  if (closedOn !== undefined) {
    return tr('ui.office.today.closeNote', { time: formatDay(locale.value, closedOn) })
  }

  const phase = findMarket(market)?.session?.phase

  return phase === undefined
    ? ''
    : translateDisplayText(locale.value, { key: `trading.session.${phase}`, fallback: '' })
}
