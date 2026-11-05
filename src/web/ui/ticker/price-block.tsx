import { useEffect } from 'preact/hooks'

import type { DealerBoardWire, SessionRangeWire } from '@/app/server/wire/quote-detail'
import type { TradingCandleWire, TradingQuoteWire } from '@/app/server/wire/trading'
import { formatDay, termOfTicker, translateDisplayText } from '@/i18n'
import { ApiFailure, getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { useBlockRead } from '@/web/state/block'
import {
  findMarket,
  findQuote,
  keyOf,
  printDisplayOf,
  quotesBlock,
  stopsBlock,
} from '@/web/state/market'
import { isRefreshable, useRereadAfterRefresh } from '@/web/state/refresh'
import { locale, state } from '@/web/state/session'
import { useRetryWhenKnown } from '@/web/state/use-retry-when-known'
import {
  formatCompactAmount,
  formatPrice,
  formatSignedPercent,
  toneOfPercent,
} from '@/web/text/figures'
import { joinInline } from '@/web/text/glyphs'
import {
  boardScaleNotes,
  formatDealerBoard,
  formatMarketPrice,
  toTickFormatter,
} from '@/web/text/market-price'
import { buildDayKey, formatWhen } from '@/web/text/time'
import { shiftDay } from '@/web/text/time-units'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { TrendIcon } from '@/web/ui/kit/icons'
import { Term } from '@/web/ui/kit/term'
import { RefreshMarketsButton } from '@/web/ui/market/refresh-button'
import { type ChartLevel, PriceChart } from '@/web/ui/ticker/chart'
import { type LiveQuote, useLiveQuote } from '@/web/ui/ticker/live-quote'
import { BlockFrame } from '@/web/ui/today/block-frame'

// Calendar days read, enough to hold the sessions shown across weekends and holidays.
const CHART_DAYS = 70
const CHART_SESSIONS = 30

interface BarsRead {
  readonly bars: readonly TradingCandleWire[]
}

interface PriceBlockProps {
  readonly ticker: string
  readonly market: string
  readonly levels: readonly ChartLevel[]
}

interface PriceFacts {
  readonly value: number
  readonly changePct?: number
  readonly kind?: string
  /** Which session the price belongs to, when it is not the one trading now. */
  readonly session: string
  /** When the price was read (epoch ms); absent for a close the bars carry, which names its day. */
  readonly readAt?: number
  /** When a price too old to be live was read, in a session still trading. */
  readonly staleAt?: number
  /** The last settled close, beside a live price so the two are not read as one. */
  readonly close?: { readonly day: string; readonly value: number }
  /** A dealer's two sides, where `value` is the sell price. */
  readonly board?: DealerBoardWire
}

/** The name, its price with the session it belongs to, and the last 30 sessions with the plan's
 *  levels on them. Without any price it says so and offers to refresh its market; its head button
 *  reads this one name's price live, then the bars again. */
export function PriceBlock({ ticker, market, levels }: PriceBlockProps) {
  const reading = useBlockRead(readBars(ticker, market), { capability: ROUTES.ohlcv.capability })
  const live = useLiveQuote(ticker, market, reading.retry)

  useRetryWhenKnown(state.value?.timeZone !== undefined, reading.retry)
  useRereadAfterRefresh(reading.retry)

  const board = findQuote(ticker, market)
  const quote = newerQuote(live.quote, board)
  const label = board?.label
  // An index, a fund or world gold says what it is, in the glossary's words.
  const term = termOfTicker(ticker)

  useLiveWhileTrading({ ticker, market }, { quote, live })

  return (
    <BlockFrame
      title={label === undefined ? ticker : `${ticker} · ${label}`}
      colour="teal"
      icon={<TrendIcon />}
      reading={reading}
      showReadLine={false}
      titleView={
        term === undefined ? undefined : (
          <>
            <Term id={term}>{ticker}</Term>
            {label !== undefined && ` · ${label}`}
          </>
        )
      }
      action={
        state.value?.capabilities.quotes !== false && (
          <Button size="small" disabled={live.isBusy} onClick={live.refresh}>
            {tr('ui.office.ticker.refresh')}
          </Button>
        )
      }
    >
      {({ bars }) => (
        <>
          {live.failure !== undefined && <p class="failure-line">{live.failure}</p>}
          <PriceBody ticker={ticker} market={market} bars={bars} levels={levels} quote={quote} />
        </>
      )}
    </BlockFrame>
  )
}

// A market that is trading shows its live price, not the close the board fell back to: one read
// when the page opens, the same one the Lấy giá mới button makes. A market with no session never
// closes, so it is always trading.
function useLiveWhileTrading(
  { ticker, market }: { readonly ticker: string; readonly market: string },
  { quote, live }: { readonly quote: TradingQuoteWire | undefined; readonly live: LiveQuote }
): void {
  const isBoardKnown = quotesBlock.view.value.data !== undefined
  const held = findMarket(market)
  const isOpen =
    held !== undefined &&
    (held.hasBoard === true || held.session === undefined || held.session.phase === 'open')
  const canQuote = state.value?.capabilities.quotes !== false
  const isClose = quote === undefined || quote.closedOn !== undefined

  useEffect(() => {
    if (isBoardKnown && isOpen && canQuote && isClose) {
      live.refresh()
    }
  }, [ticker, market, isBoardKnown, isOpen])
}

interface PriceBodyProps extends PriceBlockProps {
  readonly bars: readonly TradingCandleWire[]
  readonly quote: TradingQuoteWire | undefined
}

function PriceBody({ ticker, market, bars, levels, quote }: PriceBodyProps) {
  const facts = resolvePrice({ ticker, market }, quote, bars)

  if (facts === undefined) {
    return <NoPrice market={market} />
  }

  return (
    <>
      <PriceHead market={market} facts={facts} range={sessionRangeOf(quote, bars)} />
      {bars.length > 1 && (
        <>
          <PriceChart
            bars={bars}
            levels={levels}
            formatPrice={toTickFormatter(market, facts.kind)}
            formatDay={(day) => formatDay(locale.value, day)}
          />
          <p class="meta">
            {joinInline([
              tr('ui.office.ticker.sessions', { count: bars.length }),
              ...(levels.length > 0 ? [tr('ui.office.ticker.levelsNote')] : []),
            ])}
          </p>
        </>
      )}
    </>
  )
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

// The price with its move, a warning when it is stale, and where it comes from: scale, session, time.
interface PriceHeadProps {
  readonly market: string
  readonly facts: PriceFacts
  readonly range: SessionRangeWire | undefined
}

function PriceHead({ market, facts, range }: PriceHeadProps) {
  const timeZone = state.value?.timeZone
  const readText =
    facts.readAt === undefined || timeZone === undefined
      ? ''
      : tr('ui.office.today.readAt', { time: formatWhen(facts.readAt, timeZone) })
  const parts = [...boardScaleNotes([market]), facts.session, readText].filter(
    (part) => part !== ''
  )

  return (
    <>
      <p class="meta block-read">{joinInline(parts)}</p>
      {facts.staleAt !== undefined && timeZone !== undefined && (
        <p class="strip is-caution">
          {tr('ui.office.ticker.stale', { time: formatWhen(facts.staleAt, timeZone) })}
        </p>
      )}
      <p class="big-figure">
        {formatMarketPrice(market, facts.value, facts.kind)}{' '}
        {facts.changePct !== undefined && (
          <span class={`pill is-${toneOfPercent(facts.changePct)}`}>
            {formatSignedPercent(facts.changePct)}
          </span>
        )}
      </p>
      {facts.board !== undefined && <DealerLine market={market} board={facts.board} />}
      {range !== undefined && <p class="meta">{formatSessionRange(market, range)}</p>}
      {facts.close !== undefined && (
        <p class="meta">
          {tr('ui.office.ticker.closeRow', {
            day: formatDay(locale.value, facts.close.day),
            price: formatMarketPrice(market, facts.close.value, facts.kind),
          })}
        </p>
      )}
    </>
  )
}

function DealerLine({
  market,
  board,
}: {
  readonly market: string
  readonly board: DealerBoardWire
}) {
  const { sides, spread } = formatDealerBoard(market, board)

  return <p class="meta">{joinInline([sides, ...(spread === undefined ? [] : [spread])])}</p>
}

// A live session's range when the quote carries one, else the last settled bar's, dated either way.
function sessionRangeOf(
  quote: TradingQuoteWire | undefined,
  bars: readonly TradingCandleWire[]
): SessionRangeWire | undefined {
  if (quote?.session !== undefined) {
    return quote.session
  }

  const last = bars.at(-1)

  if (last === undefined) {
    return undefined
  }

  return {
    day: last.at,
    low: last.low,
    high: last.high,
    ...(last.volume > 0 ? { volume: last.volume } : {}),
  }
}

function formatSessionRange(market: string, range: SessionRangeWire): string {
  const display = printDisplayOf(market)
  const bounds = {
    day: formatDay(locale.value, range.day),
    low: formatPrice(range.low, display),
    high: formatPrice(range.high, display),
  }

  return range.volume === undefined
    ? tr('trading.render.quote.session', bounds)
    : tr('trading.render.quote.sessionVolume', {
        ...bounds,
        volume: formatCompactAmount(range.volume),
      })
}

// A name the daemon cannot find bars for has none to draw, which is an answer: the card says so.
function readBars(ticker: string, market: string): (abort: AbortSignal) => Promise<BarsRead> {
  return async (abort) => {
    const timeZone = state.value?.timeZone

    // A dealer's board has no series of its own: the bars held for it are world gold in USD.
    if (timeZone === undefined || findMarket(market)?.hasBoard === true) {
      return { bars: [] }
    }

    const toDay = buildDayKey(Date.now(), timeZone)

    try {
      const answer = await getJson(ROUTES.ohlcv, {
        query: { market, ticker, fromDay: shiftDay(toDay, -CHART_DAYS), toDay },
        signal: abort,
      })

      return { bars: answer.bars.slice(-CHART_SESSIONS) }
    } catch (error: unknown) {
      if (error instanceof ApiFailure && error.code === 'not_found') {
        return { bars: [] }
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
      kind: quote.kind,
      ...(quote.board === undefined ? {} : { board: quote.board }),
      session: describeSession(market, quote.closedOn),
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
