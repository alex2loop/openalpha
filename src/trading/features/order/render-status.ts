import type { Locale } from '@/core/types/locale'
import type {
  RestingExitRow,
  StagedOrder,
  TradeStatus,
  UnguardedPosition,
} from '@/trading/features/order/types'
import type { MarketRef } from '@/trading/kernel/instrument'
import type { QuoteConvention, QuotedIn } from '@/trading/render/money'
import { pluralKey, t } from '@/i18n'
import { renderUnmirroredLines } from '@/trading/features/order/render'
import { formatInstant } from '@/trading/render/datetime'
import {
  formatCount,
  formatQuantity,
  renderVenueName,
  SECTION_ICONS,
  SIDE_MARKS,
} from '@/trading/render/format'
import { INDENT, INLINE_SEPARATOR, renderSectionTitle } from '@/trading/render/layout'
import { formatQuotedPrice, quotedInOf } from '@/trading/render/money'

interface TradeStatusRender {
  readonly locale: Locale
  readonly status: TradeStatus
  readonly quoteConventions: ReadonlyMap<MarketRef, QuoteConvention>
  readonly timezone: string
}

/** What is outstanding, in the order the operator can act on it: orders waiting on a word from
 *  them, exits already standing at a venue, then the rows only they can settle. An empty section is
 *  absent rather than printed as a zero — the caller answers a wholly empty status in one line. */
export function renderTradeStatus(input: TradeStatusRender): string {
  return [
    renderSectionTitle(SECTION_ICONS.order, t(input.locale, 'trading.order.status.title')),
    ...haltedLine(input),
    ...stagedSection(input),
    ...exitSection(input),
    ...unguardedSection(input),
    ...unmirroredSection(input),
  ].join('\n')
}

/** First, because it changes what every other line means: nothing new can be bought. */
function haltedLine(input: TradeStatusRender): readonly string[] {
  const { haltedAt } = input.status

  if (haltedAt === undefined) {
    return []
  }

  const at = formatInstant(input.locale, haltedAt, input.timezone)

  return [`${INDENT[1]}${t(input.locale, 'trading.order.status.halted', { at })}`]
}

function stagedSection(input: TradeStatusRender): readonly string[] {
  const { locale, status } = input

  if (status.staged.length === 0) {
    return []
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.order.status.staged')}`,
    ...status.staged.flatMap((staged) => stagedLines(input, staged)),
  ]
}

/** The token rides its own line: it is what the operator retypes, and a handle buried in a row of
 *  figures is one they have to hunt for. */
function stagedLines(input: TradeStatusRender, staged: StagedOrder): readonly string[] {
  const { locale } = input
  const parts = [
    t(locale, 'trading.order.prompt.line', {
      side: t(locale, `trading.order.side.${staged.side}`),
      quantity: formatQuantity(locale, staged.quantity),
      ticker: staged.instrument.ticker,
    }),
    renderVenueName(locale, staged.venue),
    formatInstant(locale, staged.createdAt, input.timezone),
  ]

  return [
    `${INDENT[2]}${SIDE_MARKS[staged.side]} ${parts.join(INLINE_SEPARATOR)}`,
    `${INDENT[3]}${t(locale, 'trading.order.prompt.confirm', { token: staged.token })}`,
  ]
}

function exitSection(input: TradeStatusRender): readonly string[] {
  const { locale, status } = input

  if (status.exits.length === 0) {
    return []
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.order.status.exits')}`,
    ...status.exits.map((exit) => `${INDENT[2]}${exitRow(input, exit)}`),
  ]
}

function exitRow(input: TradeStatusRender, exit: RestingExitRow): string {
  const { locale } = input
  const covers = t(locale, 'trading.order.status.exitRow', {
    quantity: formatQuantity(locale, exit.quantity),
    ticker: exit.instrument.ticker,
    venue: renderVenueName(locale, exit.venue),
  })

  return [covers, ...levelCells(input, exit)].join(INLINE_SEPARATOR)
}

/** The triggers, where there is a convention to print them in. A market the registry no longer
 *  lists leaves the row without its levels rather than dropping it: the exit is still standing at
 *  the exchange, and a price with no currency is the one thing worse than no price. */
function levelCells(input: TradeStatusRender, exit: RestingExitRow): readonly string[] {
  const { locale } = input

  if (exit.currency === undefined) {
    return []
  }

  const quotedIn: QuotedIn = {
    currency: exit.currency,
    ...quotedInOf(input.quoteConventions.get(exit.instrument.market)),
  }

  return [
    ...(exit.takeProfit === undefined
      ? []
      : [
          t(locale, 'trading.order.exit.takeProfit', {
            price: formatQuotedPrice(locale, exit.takeProfit, quotedIn),
          }),
        ]),
    ...(exit.stopLoss === undefined
      ? []
      : [
          t(locale, 'trading.order.exit.stopLoss', {
            price: formatQuotedPrice(locale, exit.stopLoss, quotedIn),
          }),
        ]),
  ]
}

/** Stated after the exits that do stand, because it is the same fact from the other side: what the
 *  list above does not cover. The remedy names the command and the size, so the operator never has
 *  to work out which of the two numbers to type. */
function unguardedSection(input: TradeStatusRender): readonly string[] {
  const { locale, status } = input

  if (status.unguarded.length === 0) {
    return residueLine(input)
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.order.status.unguarded')}`,
    ...status.unguarded.map((row) => `${INDENT[2]}${unguardedRow(locale, row)}`),
    ...residueLine(input),
  ]
}

/** What the section did not list, and why: a holding under the venue's smallest order has no stop
 *  it could carry, and a row for it would ask the operator to place one that cannot be placed. */
function residueLine(input: TradeStatusRender): readonly string[] {
  const { locale, status } = input

  if (status.unguardedResidue.length === 0) {
    return []
  }

  const count = status.unguardedResidue.length
  const key = pluralKey(count, 'trading.order.status.residueOne', 'trading.order.status.residue')

  return [
    `${INDENT[1]}${t(locale, key, {
      count: formatCount(locale, count),
      names: status.unguardedResidue.join(INLINE_SEPARATOR),
    })}`,
  ]
}

function unguardedRow(locale: Locale, row: UnguardedPosition): string {
  const key = row.guarded > 0 ? 'trading.order.status.partlyGuarded' : 'trading.order.status.bare'

  return t(locale, key, {
    quantity: formatQuantity(locale, row.quantity - row.guarded),
    ticker: row.instrument.ticker,
    venue: renderVenueName(locale, row.venue),
  })
}

function unmirroredSection(input: TradeStatusRender): readonly string[] {
  const { locale, status } = input

  if (status.unmirrored.length === 0) {
    return []
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.order.unmirrored.title')}`,
    ...status.unmirrored.flatMap((intent) => indented(renderUnmirroredLines(input, intent))),
    `${INDENT[2]}${t(locale, 'trading.order.unmirrored.remedy')}`,
  ]
}

/** The same rows the reconcile surface prints, one level deeper: there they are the message and
 *  here they are one section of it. */
function indented(lines: readonly string[]): readonly string[] {
  return lines.map((line) => `${INDENT[1]}${line}`)
}
