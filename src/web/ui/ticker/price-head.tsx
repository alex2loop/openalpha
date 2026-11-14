import type { DealerBoardWire, SessionRangeWire } from '@/app/server/wire/quote-detail'
import type { TradingCandleWire, TradingQuoteWire } from '@/app/server/wire/trading'
import { formatDay } from '@/i18n'
import { locale, state } from '@/web/state/session'
import { formatCompactAmount, formatSignedPercent, toneOfPercent } from '@/web/text/figures'
import { joinInline } from '@/web/text/glyphs'
import {
  boardScaleNotes,
  formatDealerBoard,
  formatMarketPrice,
  formatMarketRange,
} from '@/web/text/market-price'
import { formatWhen } from '@/web/text/time'
import { tr } from '@/web/text/tr'

/** What the card's head prints about a name's price. */
export interface PriceFacts {
  readonly value: number
  readonly changePct?: number
  /** The name publishes a level, not a price. */
  readonly isLevel?: boolean
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

interface PriceHeadProps {
  readonly market: string
  readonly facts: PriceFacts
  readonly range: SessionRangeWire | undefined
}

/** The price with its move, a warning when it is stale, and where it comes from. */
export function PriceHead({ market, facts, range }: PriceHeadProps) {
  const timeZone = state.value?.timeZone
  const readText =
    facts.readAt === undefined || timeZone === undefined
      ? ''
      : tr('ui.office.today.readAt', { time: formatWhen(facts.readAt, timeZone) })
  const scale = facts.isLevel === true ? [] : boardScaleNotes([market])
  const parts = [...scale, facts.session, readText].filter((part) => part !== '')

  return (
    <>
      <p class="meta block-read">{joinInline(parts)}</p>
      {facts.staleAt !== undefined && timeZone !== undefined && (
        <p class="strip is-caution">
          {tr('ui.office.ticker.stale', { time: formatWhen(facts.staleAt, timeZone) })}
        </p>
      )}
      {facts.board === undefined ? (
        <p class="big-figure">
          {formatMarketPrice(market, facts.value, facts)}{' '}
          {facts.changePct !== undefined && (
            <span class={`pill is-${toneOfPercent(facts.changePct)}`}>
              {formatSignedPercent(facts.changePct)}
            </span>
          )}
        </p>
      ) : (
        <DealerLine market={market} board={facts.board} />
      )}
      {range !== undefined && <p class="meta">{formatSessionRange(market, range, facts)}</p>}
      {facts.close !== undefined && (
        <p class="meta">
          {tr('ui.office.ticker.closeRow', {
            day: formatDay(locale.value, facts.close.day),
            price: formatMarketPrice(market, facts.close.value, facts),
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

  return (
    <>
      <p class="lead">{sides}</p>
      {spread !== undefined && <p class="meta">{spread}</p>}
    </>
  )
}

// A live session's range when the quote carries one, else the last settled bar's, dated either way.
export function sessionRangeOf(
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

function formatSessionRange(
  market: string,
  range: SessionRangeWire,
  reading: Pick<PriceFacts, 'isLevel'>
): string {
  const bounds = {
    day: formatDay(locale.value, range.day),
    ...formatMarketRange(market, range, reading),
  }

  return range.volume === undefined
    ? tr('trading.render.quote.session', bounds)
    : tr('trading.render.quote.sessionVolume', {
        ...bounds,
        volume: formatCompactAmount(range.volume),
      })
}
