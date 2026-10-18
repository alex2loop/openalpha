import type { Locale } from '@/core/types/locale'
import type { StoredSuggestion } from '@/trading/features/suggestion/types'
import type { TradeCost } from '@/trading/markets/cost'
import type { QuotedIn } from '@/trading/render/money'
import { formatDay, t } from '@/i18n'
import { bankedShareOf, firstExitOf } from '@/trading/features/suggestion/exit-plan/first-exit'
import { armsExit } from '@/trading/features/suggestion/types'
import { isBookCall } from '@/trading/kernel/operator/focus'
import { costBreakevenPrice, estimatedFee, roundTripRate } from '@/trading/markets/cost'
import {
  formatAmount,
  formatFraction,
  formatPercent,
  formatRatio,
  renderProvidedValue,
} from '@/trading/render/format'
import { INDENT } from '@/trading/render/layout'
import { formatMoney, formatPriceIn } from '@/trading/render/money'

interface OrderNotesInput {
  readonly locale: Locale
  readonly suggestion: StoredSuggestion
  /** How the suggestion's market prints a price, as far as the surface knows it. */
  readonly quote?: QuotedIn
  /** What the operator's broker charges in this market. Absent when they have not configured it. */
  readonly cost?: TradeCost
  /** Whether the market raises the stop as the price runs, which decides whether a tranche banks. */
  readonly trailsStop: boolean
}

type StakeKey =
  | 'stake'
  | 'stakeRunner'
  | 'stakeFund'
  | `${'stake' | 'stakeRunner' | 'stakeFund'}AfterFees`
  | 'stakeReduce'

/** What acting on this order costs, when it settles, and where it leaves the book. The plan block
 *  above says what to do with the price; these are the consequences of the quantity. */
export function renderOrderNotes(orderInput: OrderNotesInput): readonly string[] {
  const input = withChargedCost(orderInput)
  const { suggestion } = input

  // A second opinion opens no position that any plan watches, so there is nothing to act on.
  if (suggestion.action === 'hold' || !isBookCall(suggestion)) {
    return []
  }

  return [
    ...renderStakeLine(input, suggestion),
    ...renderCostLine(input, suggestion),
    ...renderVolatilityLine(input, suggestion),
    ...renderPriceBandLine(input, suggestion),
    ...renderConcentrationLine(input, suggestion),
    ...renderSettlementLine(input, suggestion),
    // A sale releases cash rather than spending it, so the margin note only fits a buy.
    ...(suggestion.action !== 'buy' || suggestion.units === undefined
      ? []
      : [`${INDENT[1]}${t(input.locale, 'trading.render.suggestion.cashOnly')}`]),
  ]
}

/** A venue that bills nothing, like a gold shop whose spread is already in its prices, has no fee to
 *  state, so the cost line drops and the stake line makes no claim about fees. */
function withChargedCost(input: OrderNotesInput): OrderNotesInput {
  const { cost, ...rest } = input

  return cost === undefined || roundTripRate(cost) === 0 ? rest : input
}

type Actionable = Extract<StoredSuggestion, { readonly action: 'buy' | 'reduce' }>

/** The two amounts the levels commit the operator to. Sizing is a risk budget divided by the stop
 *  distance, and this is the money that formula arrived at. The reward is the whole position marked
 *  at the plan's first exit, since a runner riding the stop has no price to state in advance. Fees
 *  come out of both where the market's rates are configured. */
function renderStakeLine(input: OrderNotesInput, suggestion: Actionable): readonly string[] {
  const { locale, cost } = input
  const { units, sizePctNav, entry, stop } = suggestion

  if (units === undefined || sizePctNav === undefined || entry <= 0) {
    return []
  }

  const currency = suggestion.quote?.currency
  const amount = (value: number): string =>
    currency === undefined ? formatAmount(locale, value) : formatMoney(locale, value, currency)
  const isBuy = suggestion.action === 'buy'
  const banked = bankedShareOf(suggestion, input.trailsStop)
  const feePerUnit = isBuy && cost !== undefined ? entry * roundTripRate(cost) : 0
  const risk = Math.abs(entry - stop) + feePerUnit
  const reward = Math.abs(firstExitOf(suggestion, banked) - entry) - feePerUnit

  return [
    `${INDENT[1]}${t(locale, `trading.render.suggestion.${stakeKeyOf(suggestion, banked, cost)}`, {
      risk: amount(units * risk),
      riskPct: formatFraction(locale, (sizePctNav * risk) / entry),
      reward: amount(units * reward),
      rewardPct: formatFraction(locale, (sizePctNav * reward) / entry),
    })}`,
  ]
}

function stakeKeyOf(suggestion: Actionable, banked: number, cost: TradeCost | undefined): StakeKey {
  if (suggestion.action === 'reduce') {
    return 'stakeReduce'
  }

  const key = stakeBuyKeyOf(suggestion, banked)

  return cost === undefined ? key : `${key}AfterFees`
}

/** A fund's lower level is where it is looked at again, so its stake line never calls it a stop. */
function stakeBuyKeyOf(
  suggestion: Actionable,
  banked: number
): 'stake' | 'stakeRunner' | 'stakeFund' {
  if (!armsExit(suggestion)) {
    return 'stakeFund'
  }

  return banked < 1 ? 'stakeRunner' : 'stake'
}

/** What the round trip takes out of the order the stake line just sized. A buy states where the
 *  price has to reach; a reduce is itself the exit, so there is nothing to reach and only the sale
 *  is charged. Absent when the market has no configured rate. */
function renderCostLine(input: OrderNotesInput, suggestion: Actionable): readonly string[] {
  const { cost, locale } = input
  const { entry, units } = suggestion

  if (cost === undefined || entry <= 0) {
    return []
  }

  const notional = units === undefined ? undefined : units * entry
  const currency = suggestion.quote?.currency
  const amount = (value: number): string =>
    currency === undefined ? formatAmount(locale, value) : formatMoney(locale, value, currency)

  if (suggestion.action === 'reduce') {
    return notional === undefined
      ? []
      : [
          `${INDENT[1]}${t(locale, 'trading.render.suggestion.costReduce', {
            fee: amount(estimatedFee(notional, cost.sellRate)),
            pct: formatFraction(locale, cost.sellRate),
          })}`,
        ]
  }

  const pct = formatFraction(locale, roundTripRate(cost))
  const breakeven = formatPriceIn(locale, costBreakevenPrice(entry, cost), input.quote)

  if (notional === undefined) {
    return [`${INDENT[1]}${t(locale, 'trading.render.suggestion.costUnsized', { pct, breakeven })}`]
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.render.suggestion.cost', {
      fee: amount(estimatedFee(notional, roundTripRate(cost))),
      pct,
      breakeven,
    })}`,
  ]
}

/** How much this name moves on an ordinary session, which is what makes the stop's own percentage
 *  readable: 2.9% is room on a quiet name and one session's noise on a volatile one. The multiple
 *  is policy and barely varies — it says where the stop came from, not how wide it is. */
function renderVolatilityLine(input: OrderNotesInput, suggestion: Actionable): readonly string[] {
  const { locale, quote } = input
  const { atr, entry, stop } = suggestion

  if (atr === undefined || atr <= 0) {
    return []
  }

  const key = volatilityKeyOf(suggestion)

  return [
    `${INDENT[1]}${t(locale, `trading.render.suggestion.${key}`, {
      atr: formatPriceIn(locale, atr, quote),
      atrPct: formatFraction(locale, atr / entry),
      multiple: formatRatio(locale, Math.abs(entry - stop) / atr),
    })}`,
  ]
}

function volatilityKeyOf(
  suggestion: Actionable
): 'stopVolatility' | 'stopVolatilityReduce' | 'stopVolatilityFund' {
  if (suggestion.action === 'reduce') {
    return 'stopVolatilityReduce'
  }

  return armsExit(suggestion) ? 'stopVolatility' : 'stopVolatilityFund'
}

/** The caveat names the ceiling that bound the size; this says how full the segment is once the
 *  order is filled, which is what decides whether the next idea in the same sector can be taken. */
function renderConcentrationLine(
  input: OrderNotesInput,
  suggestion: Actionable
): readonly string[] {
  const { locale } = input
  const { concentration } = suggestion

  if (concentration === undefined) {
    return []
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.render.suggestion.concentration', {
      sector: renderProvidedValue(
        locale,
        `trading.sector.${concentration.sector}`,
        concentration.sector
      ),
      after: formatFraction(locale, concentration.afterPctNav),
      cap: formatFraction(locale, concentration.capPctNav),
    })}`,
  ]
}

/** Both bounds and both limits: a venue whose up and down limits differ makes a single ± wrong, and
 *  branching on symmetry buys nothing. The line states the band and claims nothing about the levels
 *  above it — a target is normally several sessions away and so outside one session's band, and
 *  the one level whose reach matters is already answered by `market.stop-beyond-band`. */
function renderPriceBandLine(input: OrderNotesInput, suggestion: Actionable): readonly string[] {
  const { priceBand } = suggestion

  if (priceBand === undefined) {
    return []
  }

  const { locale } = input

  return [
    `${INDENT[1]}${t(locale, 'trading.render.suggestion.priceBand', {
      floor: formatPriceIn(locale, priceBand.floor, input.quote),
      ceiling: formatPriceIn(locale, priceBand.ceiling, input.quote),
      up: formatFraction(locale, priceBand.maximumUpPct),
      down: formatFraction(locale, priceBand.maximumDownPct),
    })}`,
  ]
}

function renderSettlementLine(input: OrderNotesInput, suggestion: Actionable): readonly string[] {
  const { locale } = input
  const { settlement } = suggestion

  if (settlement === undefined) {
    return []
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.render.suggestion.settlement', {
      day: formatDay(locale, settlement.sellableFrom),
      pct: formatPercent(locale, settlement.worstCaseDrawdownPct),
    })}`,
  ]
}
