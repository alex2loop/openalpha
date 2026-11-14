import type { Locale } from '@/core/types/locale'
import type { CurrencyCode, TradingDay } from '@/trading/kernel/instrument'
import type {
  FlowParty,
  FlowReading,
  FlowSide,
  MarketFlowBalance,
  SessionMean,
} from '@/trading/kernel/market/market-overview'
import type { RenderContext } from '@/trading/render/format'
import { formatDay, t } from '@/i18n'
import { formatCount, formatMultiple, renderDeclaredValue } from '@/trading/render/format'
import { INDENT, toRowLines } from '@/trading/render/layout'
import { formatFlowIn, formatSignedFlowIn } from '@/trading/render/money'

/** The balance with what it is read against: the overview's session and currency, which the balance
 *  itself does not repeat. */
interface FlowBalanceView {
  readonly balance: MarketFlowBalance
  readonly asOf: TradingDay
  readonly currency: CurrencyCode
}

interface PartyRow {
  readonly party: FlowParty
  readonly net: number
  readonly mean: SessionMean | undefined
}

/** The heading, one row per group with its net and its recent average, then the reading. */
export function renderFlowBalanceBlock(
  locale: Locale,
  view: FlowBalanceView,
  context: RenderContext
): readonly string[] {
  const { balance, currency } = view

  return [
    t(locale, 'trading.flow.heading', { day: formatDay(locale, balance.session) }),
    ...toPartyRows(balance).flatMap((row) =>
      toRowLines(partyFacts(locale, row, currency), context, 1)
    ),
    ...renderFlowBalanceReading(locale, view).map((line) => `${INDENT[1]}${line}`),
  ]
}

function toPartyRows(balance: MarketFlowBalance): readonly PartyRow[] {
  return [
    { party: 'foreign', net: balance.foreignNet, mean: balance.foreignMean },
    { party: 'proprietary', net: balance.proprietaryNet, mean: balance.proprietaryMean },
    { party: 'others', net: balance.othersNet, mean: undefined },
  ]
}

/** A group with no average states its net alone: a desk with no figures to average is absent, not
 *  an average of zero. */
function partyFacts(locale: Locale, row: PartyRow, currency: CurrencyCode): readonly string[] {
  const { party, net, mean } = row

  return [
    renderDeclaredValue(locale, `trading.flow.party.${party}`),
    formatSignedFlowIn(locale, net, currency),
    ...(mean === undefined
      ? []
      : [
          t(locale, 'trading.flow.mean', {
            sessions: formatCount(locale, mean.sessions),
            value: formatSignedFlowIn(locale, mean.value, currency),
          }),
        ]),
  ]
}

/** The sentences that say what the three nets mean, in the order a reader needs them: who bought
 *  and who sold, how big the gap is against a normal session, the foreign run, and, last, that the
 *  reading is for an earlier session than the block's own. */
export function renderFlowBalanceReading(locale: Locale, view: FlowBalanceView): readonly string[] {
  const { balance, asOf } = view

  return [
    renderWho(locale, view),
    ...renderSize(locale, balance),
    ...renderStreak(locale, balance),
    ...(balance.session === asOf
      ? []
      : [t(locale, 'trading.flow.desksAsOf', { day: formatDay(locale, balance.session) })]),
  ]
}

/** Everyone else is the opposite side of what the two groups did together, so a split reading names
 *  the side from the sign of `othersNet`. */
function renderWho(locale: Locale, view: FlowBalanceView): string {
  const { balance, currency } = view
  const amount = (value: number): string => formatFlowIn(locale, Math.abs(value), currency)

  return renderDeclaredValue(locale, `trading.flow.reading.${readingOf(balance)}`, {
    foreign: amount(balance.foreignNet),
    proprietary: amount(balance.proprietaryNet),
    others: amount(balance.othersNet),
    foreignAction: renderAction(locale, sideOf(balance.foreignNet)),
    proprietaryAction: renderAction(locale, sideOf(balance.proprietaryNet)),
    othersAction: renderAction(locale, sideOf(balance.othersNet)),
  })
}

function readingOf(balance: MarketFlowBalance): FlowReading {
  const { foreignNet, proprietaryNet } = balance

  if (foreignNet + proprietaryNet === 0) {
    return 'even'
  }

  if (foreignNet < 0 && proprietaryNet < 0) {
    return 'both-selling'
  }

  return foreignNet > 0 && proprietaryNet > 0 ? 'both-buying' : 'split'
}

function sideOf(net: number): FlowSide {
  return net > 0 ? 'buy' : 'sell'
}

/** The market decides `size`; the multiple printed is the same gap over the same normal. */
function renderSize(locale: Locale, balance: MarketFlowBalance): readonly string[] {
  const { normal, size } = balance

  if (normal === undefined || size === undefined) {
    return []
  }

  return [
    renderDeclaredValue(locale, `trading.flow.size.${size}`, {
      multiple: formatMultiple(locale, Math.abs(balance.othersNet) / normal.value),
      sessions: formatCount(locale, normal.sessions),
    }),
  ]
}

function renderStreak(locale: Locale, balance: MarketFlowBalance): readonly string[] {
  const { foreignStreak } = balance

  if (foreignStreak === undefined) {
    return []
  }

  return [
    t(locale, 'trading.flow.streak', {
      action: renderAction(locale, foreignStreak.side),
      sessions: formatCount(locale, foreignStreak.sessions),
    }),
  ]
}

function renderAction(locale: Locale, side: FlowSide): string {
  return renderDeclaredValue(locale, `trading.flow.action.${side}`)
}
