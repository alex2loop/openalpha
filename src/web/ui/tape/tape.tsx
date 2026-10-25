import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'

import type { TradingQuoteWire } from '@/app/server/wire/trading'
import {
  freshCalls,
  heldPositions,
  keyOf,
  priceDisplayOf,
  quotesBlock,
  stopBreaches,
  stopsBlock,
} from '@/web/state/market'
import { reducedMotion } from '@/web/state/prefs'
import { isFirstRun } from '@/web/state/session'
import { formatPrice, formatSignedPercent, toneOfPercent } from '@/web/text/figures'
import { tr } from '@/web/text/tr'

import './tape.css'

const FLASH_MS = 900

interface TapeRow {
  readonly key: string
  readonly market: string
  readonly ticker: string
  readonly price?: number
  readonly changePct?: number
}

type Note = 'breach' | 'call' | undefined

/** The strip under the header: the watchlist and the holdings, scrolling by CSS alone. */
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
  readonly isCopy?: boolean
}

// The second copy makes the loop seamless and is hidden from screen readers.
function TapeRows({ rows, resolveNote, isCopy }: TapeRowsProps) {
  return (
    <div class="tape-rows" aria-hidden={isCopy === true ? 'true' : undefined}>
      {rows.map((row) => (
        <TapeCell key={row.key} row={row} note={resolveNote(row)} />
      ))}
    </div>
  )
}

function TapeCell({ row, note }: { readonly row: TapeRow; readonly note: Note }) {
  const flash = useFlash(row.price)
  const classes = [
    'tape-cell',
    note === 'breach' ? 'is-breach' : '',
    flash ? `is-flash-${flash}` : '',
  ]

  return (
    <span class={classes.filter(Boolean).join(' ')}>
      <b>{row.ticker}</b>
      <span class="tape-price">{formatPrice(row.price, priceDisplayOf(row.market))}</span>
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

// A price that moved flashes for `FLASH_MS`; a quiet page (reduced motion) never does.
function useFlash(price: number | undefined): 'up' | 'down' | undefined {
  const previous = useRef(price)
  const flash = useSignal<'up' | 'down' | undefined>(undefined)

  useEffect(() => {
    const before = previous.current

    previous.current = price

    if (before === undefined || price === undefined || price === before || reducedMotion.value) {
      return undefined
    }

    flash.value = price > before ? 'up' : 'down'

    const timer = setTimeout(() => {
      flash.value = undefined
    }, FLASH_MS)

    return () => {
      clearTimeout(timer)
      flash.value = undefined
    }
  }, [price])

  return flash.value
}

// The watchlist first (indices are not on the tape), then the holdings it does not already carry,
// priced at the mark their stop was measured from.
function buildRows(): readonly TapeRow[] {
  const quotes = (quotesBlock.view.value.data?.quotes ?? []).filter(
    (quote) => quote.kind !== 'index'
  )
  const rows = quotes.map(toQuoteRow)
  const known = new Set(rows.map((row) => row.key))
  const marks = new Map(
    (stopsBlock.view.value.data?.stops ?? []).map((stop) => [keyOf(stop.instrument), stop.price])
  )
  const held = heldPositions.value.flatMap(({ instrument }) => {
    const key = keyOf(instrument)
    const price = marks.get(key)

    return known.has(key) ? [] : [{ key, ...instrument, ...(price === undefined ? {} : { price }) }]
  })

  return [...rows, ...held]
}

function toQuoteRow(quote: TradingQuoteWire): TapeRow {
  return {
    key: keyOf(quote),
    market: quote.market,
    ticker: quote.ticker,
    price: quote.last,
    ...(quote.changePct === undefined ? {} : { changePct: quote.changePct }),
  }
}
