import type { TradingCandleWire, TradingQuoteWire } from '@/app/server/wire/trading'
import { formatDay, translateDisplayText } from '@/i18n'
import { ApiFailure, getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { useBlockRead } from '@/web/state/block'
import { runCommand } from '@/web/state/command'
import { findMarket, findQuote, keyOf, stopsBlock } from '@/web/state/market'
import { REFRESH_COMMAND } from '@/web/state/refresh'
import { locale, state } from '@/web/state/session'
import { useRetryWhenKnown } from '@/web/state/use-retry-when-known'
import { formatSignedPercent, toneOfPercent } from '@/web/text/figures'
import { joinInline } from '@/web/text/glyphs'
import { boardScaleNotes, formatBarePrice, formatMarketPrice } from '@/web/text/market-price'
import { buildDayKey, formatWhen } from '@/web/text/time'
import { shiftDay } from '@/web/text/time-units'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { TrendIcon } from '@/web/ui/kit/icons'
import { type ChartLevel, PriceChart } from '@/web/ui/ticker/chart'
import { useLiveQuote } from '@/web/ui/ticker/live-quote'
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
}

/** The name, its price with the session it belongs to, and the last 30 sessions with the plan's
 *  levels on them. Without any price it says so and offers `/refresh`; its head button reads this
 *  one name's price live, then the bars again. */
export function PriceBlock({ ticker, market, levels }: PriceBlockProps) {
  const reading = useBlockRead(readBars(ticker, market), { capability: ROUTES.ohlcv.capability })
  const live = useLiveQuote(ticker, market, reading.retry)

  useRetryWhenKnown(state.value?.timeZone !== undefined, reading.retry)

  const board = findQuote(ticker, market)
  const quote = newerQuote(live.quote, board)
  const label = board?.label

  return (
    <BlockFrame
      title={label === undefined ? ticker : `${ticker} · ${label}`}
      colour="teal"
      icon={<TrendIcon />}
      reading={reading}
      showReadLine={false}
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

interface PriceBodyProps extends PriceBlockProps {
  readonly bars: readonly TradingCandleWire[]
  readonly quote: TradingQuoteWire | undefined
}

function PriceBody({ ticker, market, bars, levels, quote }: PriceBodyProps) {
  const facts = resolvePrice({ ticker, market }, quote, bars)

  if (facts === undefined) {
    return (
      <>
        <p class="meta">{tr('ui.office.ticker.noData')}</p>
        <Button size="small" onClick={() => runCommand(REFRESH_COMMAND)}>
          {REFRESH_COMMAND}
        </Button>
      </>
    )
  }

  return (
    <>
      <PriceHead market={market} facts={facts} />
      {bars.length > 1 && (
        <>
          <PriceChart
            bars={bars}
            levels={levels}
            formatPrice={(value) => formatBarePrice(market, value, facts.kind)}
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

// The price with its move, a warning when it is stale, and where it comes from: scale, session, time.
function PriceHead({ market, facts }: { readonly market: string; readonly facts: PriceFacts }) {
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
    </>
  )
}

// A name the daemon cannot find bars for has none to draw, which is an answer: the card says so.
function readBars(ticker: string, market: string): (abort: AbortSignal) => Promise<BarsRead> {
  return async (abort) => {
    const timeZone = state.value?.timeZone

    if (timeZone === undefined) {
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
      session: describeSession(market, quote.closedOn),
      ...toQuoteTimes(quote),
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
