import { useEffect, useRef } from 'preact/hooks'

import type { ScreenResponse } from '@/app/server/wire/market'
import type { SuggestionWire } from '@/app/server/wire/trading'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { type BlockReading, useBlock, useBlockRead } from '@/web/state/block'
import { onWireEvent } from '@/web/state/events'
import { screenMarket } from '@/web/state/ideas'
import { openTicker } from '@/web/state/known-tickers'
import { boardMarkets } from '@/web/state/market'
import { isAdvanced } from '@/web/state/prefs'
import { formatPrice, WHOLE_DISPLAY } from '@/web/text/figures'
import { isInfoLine, joinInline, splitInline, withoutLeadingIcon } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { TrendIcon } from '@/web/ui/kit/icons'
import { Segmented } from '@/web/ui/kit/segmented'
import { AnalyzeButton, isStoredAnswer } from '@/web/ui/ticker/analyze-button'
import { BlockFrame } from '@/web/ui/today/block-frame'

const FRESH_FLAG = '1'
const MARKET_SEPARATOR = ':'
// The newest calls of every market (the list filters by name, not by market alone), read to tell
// which ranked names were already analyzed on the board's day. A busy day stores about 30 across
// markets, and each row carries its whole call, so the read stays near two days.
const DAY_CALLS_READ = 50

/** Cơ hội: the names the daemon ranked best in a market, as it words them. A score is a rank, not
 *  advice, and a call is one tap away. */
export function Opportunities() {
  const markets = boardMarkets.value
  const market = markets.find((held) => held.market === screenMarket.value) ?? markets[0]

  if (market === undefined) {
    return <p class="empty-note">{tr('ui.office.today.empty')}</p>
  }

  return (
    <>
      {markets.length > 1 && (
        <Segmented
          label={tr('ui.office.ideas.screen')}
          value={market.market}
          options={markets.map((held) => ({ value: held.market, label: held.label }))}
          onChange={(value) => {
            screenMarket.value = value
          }}
        />
      )}
      <Board key={market.market} market={market.market} />
    </>
  )
}

// Mounted per market, so its read ends with the tab or the market.
function Board({ market }: { readonly market: string }) {
  const reading = useBoard(market)
  const calls = useBlock(ROUTES.suggestions, {
    query: { status: 'all', limit: DAY_CALLS_READ },
  })

  // A run that reported on names may have stored a call, which turns its row's button into a fresh
  // analysis.
  useEffect(
    () =>
      onWireEvent('run_finished', (event) => {
        if (event.tickers !== undefined) {
          calls.retry()
        }
      }),
    []
  )

  return (
    <BlockFrame
      title={tr('ui.office.ideas.screen')}
      colour="teal"
      icon={<TrendIcon />}
      reading={reading}
      dataTo={reading.data?.dataThroughDay ?? reading.data?.asOf}
      action={<Rerun reading={reading} />}
    >
      {(board) => (
        <BoardBody
          board={board}
          analyzed={analyzedOn(calls.data?.suggestions ?? [], { market, day: board.asOf })}
        />
      )}
    </BlockFrame>
  )
}

interface BoardReading extends BlockReading<ScreenResponse> {
  /** Ranks the board again, past the one the daemon already read, and shows it in place. */
  readonly rerank: () => void
}

function useBoard(market: string): BoardReading {
  const isFresh = useRef(false)
  const reading = useBlockRead(
    (abort) => {
      const query = isFresh.current ? { market, fresh: FRESH_FLAG } : { market }

      isFresh.current = false

      return getJson(ROUTES.screen, { query, signal: abort })
    },
    { capability: ROUTES.screen.capability }
  )

  return {
    ...reading,
    rerank: () => {
      isFresh.current = true
      reading.retry()
    },
  }
}

// No model runs: the board is ranked from stored data, so this is a plain button, busy while read.
function Rerun({ reading }: { readonly reading: BoardReading }) {
  return (
    <Button size="small" disabled={reading.state === 'loading'} onClick={reading.rerank}>
      {tr('ui.office.ideas.screenRerun')}
    </Button>
  )
}

// The names `/suggest` would answer from a call already stored: those analyzed on the board's day,
// or later where the board was read before the day turned, and a buy still open from an earlier
// day, which a round-the-clock market hands back while it can be taken.
function analyzedOn(
  calls: readonly SuggestionWire[],
  board: { readonly market: string; readonly day: string }
): ReadonlySet<string> {
  return new Set(
    calls
      .filter((call) => call.instrument.market === board.market && isStoredAnswer(call))
      .filter(
        (call) => call.at >= board.day || (call.action === 'buy' && call.outcome === undefined)
      )
      .map((call) => call.instrument.ticker)
  )
}

interface BoardBodyProps {
  readonly board: ScreenResponse
  readonly analyzed: ReadonlySet<string>
}

function BoardBody({ board, analyzed }: BoardBodyProps) {
  const { card } = board

  if (card.rows.length === 0) {
    return <p class="empty-note">{tr('ui.office.today.empty')}</p>
  }

  return (
    <>
      <p class="funnel">
        {tr('ui.office.ideas.screenFunnel', {
          universe: formatPrice(board.universeSize, WHOLE_DISPLAY),
          kept: formatPrice(card.rows.length, WHOLE_DISPLAY),
        })}
      </p>
      {card.rows.map((row) => (
        <Opportunity key={row.key} row={row} analyzed={analyzed} />
      ))}
      {card.caveats.map((caveat) => (
        <p key={caveat} class={isInfoLine(caveat) ? 'meta' : 'strip is-caution'}>
          {withoutLeadingIcon(caveat)}
        </p>
      ))}
      {card.notes.map((note) => (
        <p key={note} class="meta">
          {note}
        </p>
      ))}
      <p class="meta">{tr('ui.office.ideas.screenNote')}</p>
    </>
  )
}

type Row = ScreenResponse['card']['rows'][number]

// The score is one segment of the daemon's row line; simple drops it and keeps every other.
function lineOf(row: Row): string {
  if (isAdvanced.value) {
    return row.line
  }

  const scoreLead = tr('trading.render.screen.score', { score: '' }).trim()

  return joinInline(splitInline(row.line).filter((segment) => !segment.startsWith(scoreLead)))
}

function Opportunity({
  row,
  analyzed,
}: {
  readonly row: Row
  readonly analyzed: ReadonlySet<string>
}) {
  const [market, ticker] = row.key.split(MARKET_SEPARATOR)
  const head = lineOf(row)

  return (
    <div class="opportunity">
      <div class="opportunity-main">
        {ticker === undefined ? (
          <b>{head}</b>
        ) : (
          <button type="button" class="opportunity-line" onClick={() => openTicker(ticker, market)}>
            {head}
          </button>
        )}
        {row.evidence.map((line) => (
          <p key={line} class="opportunity-evidence">
            {line}
          </p>
        ))}
      </div>
      <div class="opportunity-ask">
        <AnalyzeButton
          name={row.key}
          isAnalyzed={ticker !== undefined && analyzed.has(ticker)}
          size="small"
        />
      </div>
    </div>
  )
}
