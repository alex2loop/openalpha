import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'

import type { MarketWire } from '@/app/server/wire/market'
import type { TradingQuoteWire } from '@/app/server/wire/trading'
import {
  freshCalls,
  keyOf,
  knownMarkets,
  overviewBlock,
  priceDisplayOf,
  quotesBlock,
  stopBreaches,
} from '@/web/state/market'
import { reducedMotion } from '@/web/state/prefs'
import { isFirstRun } from '@/web/state/session'
import { formatPrice, formatSignedPercent, toneOfPercent } from '@/web/text/figures'
import { tr } from '@/web/text/tr'
import { TickerLink } from '@/web/ui/ticker/ticker-link'

import './tape.css'

interface TapeRow {
  readonly key: string
  readonly market: string
  readonly ticker: string
  readonly price?: number
  readonly changePct?: number
  /** Absent for an index level, which prints bare. */
  readonly display?: MarketWire['priceDisplay']
}

type Note = 'breach' | 'call' | undefined

/** The strip under the header: each market's benchmark and the watchlist, scrolling by CSS alone. */
export function Tape() {
  const rows = buildRows()
  const breached = new Set(stopBreaches.value.map((stop) => keyOf(stop.instrument)))
  const called = new Set(freshCalls.value.map((call) => keyOf(call.instrument)))
  const resolveNote = (row: TapeRow): Note => {
    if (isFirstRun.value) {
      return undefined
    }

    if (breached.has(row.key)) {
      return 'breach'
    }

    return called.has(row.key) ? 'call' : undefined
  }

  return (
    <div class={rows.length === 0 ? 'tape is-empty' : 'tape'}>
      <div class="tape-track">
        <TapeRows rows={rows} resolveNote={resolveNote} />
        {!reducedMotion.value && <TapeRows rows={rows} resolveNote={resolveNote} isCopy />}
      </div>
    </div>
  )
}

interface TapeRowsProps {
  readonly rows: readonly TapeRow[]
  readonly resolveNote: (row: TapeRow) => Note
  readonly isCopy?: true
}

// The second copy makes the loop seamless and is hidden from screen readers.
function TapeRows({ rows, resolveNote, isCopy }: TapeRowsProps) {
  return (
    <div class="tape-rows" aria-hidden={isCopy === true ? 'true' : undefined}>
      {rows.map((row) => (
        <TapeCell key={row.key} row={row} note={resolveNote(row)} isCopy={isCopy} />
      ))}
    </div>
  )
}

interface TapeCellProps {
  readonly row: TapeRow
  readonly note: Note
  readonly isCopy: true | undefined
}

function TapeCell({ row, note, isCopy }: TapeCellProps) {
  const { flash, clearFlash } = useFlash(row.price)
  const classes = [
    'tape-cell',
    note === 'breach' ? 'is-breach' : '',
    flash ? `is-flash-${flash}` : '',
  ]

  return (
    <span class={classes.filter(Boolean).join(' ')} onAnimationEnd={clearFlash}>
      <b>
        <TickerLink ticker={row.ticker} market={row.market} isHidden={isCopy} />
      </b>
      <span class="tape-price">{formatPrice(row.price, row.display)}</span>
      <span class={`is-${toneOfPercent(row.changePct)}-text`}>
        {formatSignedPercent(row.changePct)}
      </span>
      {note !== undefined && (
        <span class="tape-note">
          {note === 'breach' ? tr('ui.office.tape.breach') : tr('ui.office.tape.call')}
        </span>
      )}
    </span>
  )
}

// A price that moved flashes until its CSS animation ends; a quiet page (reduced motion) never does.
function useFlash(price: number | undefined): {
  readonly flash: 'up' | 'down' | undefined
  readonly clearFlash: () => void
} {
  const previous = useRef(price)
  const flash = useSignal<'up' | 'down' | undefined>(undefined)

  useEffect(() => {
    const before = previous.current

    previous.current = price

    if (before !== undefined && price !== undefined && price !== before && !reducedMotion.value) {
      flash.value = price > before ? 'up' : 'down'
    }
  }, [price])

  return {
    flash: flash.value,
    clearFlash: () => {
      flash.value = undefined
    },
  }
}

// Each market's benchmark (VN-Index, BTC) off the overview, then the watchlist names it does not
// already carry.
function buildRows(): readonly TapeRow[] {
  const benchmarks = knownMarkets.value.flatMap(toBenchmarkRows)
  const known = new Set(benchmarks.map((row) => row.key))
  const watched = (quotesBlock.view.value.data?.quotes ?? [])
    .map(toQuoteRow)
    .filter((row) => !known.has(row.key))

  return [...benchmarks, ...watched]
}

function toBenchmarkRows(market: MarketWire): readonly TapeRow[] {
  const { benchmark } = market
  const block = overviewBlock.view.value.data?.markets.find((held) => held.market === market.market)
  const row = block?.rows.find(
    (overview) => benchmark !== undefined && keyOf(overview.instrument) === keyOf(benchmark)
  )

  if (benchmark === undefined || block === undefined || row === undefined) {
    return []
  }

  // A block with no price currency quotes index levels.
  const display = block.priceCurrency === undefined ? undefined : market.priceDisplay

  return [
    {
      key: keyOf(benchmark),
      market: benchmark.market,
      ticker: benchmark.ticker,
      ...(row.price === undefined ? {} : { price: row.price }),
      ...(row.changePct === undefined ? {} : { changePct: row.changePct }),
      ...(display === undefined ? {} : { display }),
    },
  ]
}

function toQuoteRow(quote: TradingQuoteWire): TapeRow {
  const display = quote.kind === 'index' ? undefined : priceDisplayOf(quote.market)

  return {
    key: keyOf(quote),
    market: quote.market,
    ticker: quote.ticker,
    price: quote.last,
    ...(quote.changePct === undefined ? {} : { changePct: quote.changePct }),
    ...(display === undefined ? {} : { display }),
  }
}
