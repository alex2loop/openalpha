import type { StopsResponse } from '@/app/server/wire/money'
import type { AbsolutePositionWire } from '@/app/server/wire/trading'
import { keyOf, stopBreaches, stopsBlock } from '@/web/state/market'
import {
  formatFixedFraction,
  formatQuantity,
  formatSignedPercent,
  PERCENT,
  toneOfPercent,
} from '@/web/text/figures'
import { joinInline } from '@/web/text/glyphs'
import { boardScaleNotes, formatMarketPrice } from '@/web/text/market-price'
import { tr } from '@/web/text/tr'
import { toMovePercent } from '@/web/ui/book/unrealized'
import { TickerLink } from '@/web/ui/ticker/ticker-link'

type StopRow = StopsResponse['stops'][number]

/** One row per holding: quantity, the mark, its weight and its stop, with the unrealized move at
 *  the right. A fund's lower level reads as a review, never a stop. */
export function HoldingsList({
  positions,
}: {
  readonly positions: readonly AbsolutePositionWire[]
}) {
  const stops = new Map(
    (stopsBlock.view.value.data?.stops ?? []).map((stop) => [keyOf(stop.instrument), stop])
  )
  const breached = new Set(stopBreaches.value.map((stop) => keyOf(stop.instrument)))
  const notes = boardScaleNotes(positions.map((position) => position.instrument.market))

  return (
    <>
      <div class="row-list">
        {positions.map((position) => {
          const key = keyOf(position.instrument)

          return (
            <HoldingRow
              key={key}
              position={position}
              stop={stops.get(key)}
              isBreach={breached.has(key)}
            />
          )
        })}
      </div>
      {notes.length > 0 && <p class="meta">{joinInline(notes)}</p>}
    </>
  )
}

interface HoldingRowProps {
  readonly position: AbsolutePositionWire
  readonly stop: StopRow | undefined
  readonly isBreach: boolean
}

function HoldingRow({ position, stop, isBreach }: HoldingRowProps) {
  const { instrument } = position
  const move = toMovePercent(position)
  const weight = position.weightPctNav === undefined ? undefined : position.weightPctNav / PERCENT
  const facts = [
    formatQuantity(position.quantity),
    formatMarketPrice(instrument.market, stop?.price),
    formatFixedFraction(weight),
    ...(stop === undefined ? [] : describeStop(stop)),
    ...(isBreach ? [tr('ui.office.tape.breach')] : []),
  ]

  return (
    <div class={isBreach ? 'row is-breach' : 'row'}>
      <b>
        <TickerLink ticker={instrument.ticker} market={instrument.market} />
      </b>
      <span class="holding-facts">{joinInline(facts)}</span>
      <span class={`pill is-${toneOfPercent(move)}`}>{formatSignedPercent(move)}</span>
    </div>
  )
}

function describeStop(stop: StopRow): readonly string[] {
  if (stop.stop === undefined) {
    return []
  }

  const label = tr(stop.review ? 'ui.office.ticker.review' : 'ui.office.ticker.stop')

  return [`${label} ${formatMarketPrice(stop.instrument.market, stop.stop)}`]
}
