import type { Locale } from '@/core/types/locale'
import type { StopCover, StopDistance } from '@/trading/kernel/operator/alert'
import type { RenderContext } from '@/trading/render/format'
import type { QuotedIn } from '@/trading/render/money'
import { pluralKey, t } from '@/i18n'
import { isNearStop, stopStandingOf } from '@/trading/kernel/operator/alert'
import { MAXIMUM_NAMES_PER_LIST } from '@/trading/markets/overview-rollups'
import { CHART_CELLS, renderLadder } from '@/trading/render/chart'
import { formatCount, formatFixedFraction, SEVERITY_MARKS } from '@/trading/render/format'
import { INDENT, INLINE_SEPARATOR } from '@/trading/render/layout'
import { formatPriceIn } from '@/trading/render/money'

/** Where a holding stands against its own stop. One dispatch, because the gather line and the row
 *  suffix answer the same question and would otherwise drift apart. */
type StopState =
  | { readonly kind: 'unplanned' }
  | { readonly kind: 'breached'; readonly ticker: string }
  | { readonly kind: 'near'; readonly ticker: string; readonly pct: number }
  | { readonly kind: 'clear'; readonly pct: number }
  | { readonly kind: 'unknown' }

type UrgentState = Extract<StopState, { kind: 'breached' | 'near' }>

function resolveStopState(distance: StopDistance): StopState {
  const { ticker } = distance.instrument

  if (distance.plan === 'none') {
    return { kind: 'unplanned' }
  }

  const pct = distance.distanceToStopPct

  if (pct === undefined) {
    return { kind: 'unknown' }
  }

  if (stopStandingOf(distance) === 'breached') {
    return { kind: 'breached', ticker }
  }

  return isNearStop(pct) ? { kind: 'near', ticker, pct } : { kind: 'clear', pct }
}

/** What needs acting on today, gathered above the rows. Only a stop already through or nearly so:
 *  a holding with no plan is a standing state its own row states, and naming every one of them here
 *  would restate the whole book under a heading that promises the exception. A fund's level is a
 *  point to review it, not an exit to act on, so no fund is named here. */
export function renderAttentionLines(
  locale: Locale,
  distances: readonly StopDistance[],
  isFund: (distance: StopDistance) => boolean
): readonly string[] {
  const urgent = distances
    .filter((distance) => !isFund(distance))
    .map(resolveStopState)
    .filter(isUrgent)

  if (urgent.length === 0) {
    return []
  }

  const named = urgent.slice(0, MAXIMUM_NAMES_PER_LIST).map((state) => urgentPhrase(locale, state))
  const overflow = urgent.length - named.length
  const parts =
    overflow === 0
      ? named
      : [
          ...named,
          t(locale, 'trading.render.layout.more', { count: formatCount(locale, overflow) }),
        ]

  return [
    `${INDENT[1]}${SEVERITY_MARKS.warn} ${t(locale, 'trading.render.portfolio.attention')}` +
      `${INLINE_SEPARATOR}${parts.join(INLINE_SEPARATOR)}`,
  ]
}

function isUrgent(state: StopState): state is UrgentState {
  return state.kind === 'breached' || state.kind === 'near'
}

function urgentPhrase(locale: Locale, state: UrgentState): string {
  return state.kind === 'near'
    ? t(locale, 'trading.render.portfolio.attentionStop', {
        ticker: state.ticker,
        pct: formatFixedFraction(locale, state.pct),
      })
    : t(locale, 'trading.render.portfolio.attentionBreached', { ticker: state.ticker })
}

/** What a position row states about its own stop. Empty for a holding whose distance is unknown:
 *  a row that says nothing about risk is better than one that implies none. */
interface RiskSuffixInput {
  readonly locale: Locale
  readonly distance: StopDistance | undefined
  /** Who stands behind the stop at the venue. Absent where no venue holding the name could carry one,
   *  or where its stops could not be read, which is not the same claim as none being there. */
  readonly resting: StopCover | undefined
  /** A fund's level is reviewed, never armed: it reads as a review level and no order is owed. */
  readonly fund: boolean
  /** The row's own price, which the ladder places between the stop and the take-profit. */
  readonly price: {
    readonly at: number
    readonly quote: Partial<QuotedIn>
    readonly context: RenderContext
  }
}

export function riskFacts(input: RiskSuffixInput): readonly string[] {
  const { locale, distance } = input

  if (distance === undefined) {
    return []
  }

  const state = resolveStopState(distance)
  const phrase = riskPhrase(input, state)

  if (phrase === undefined) {
    return []
  }

  return input.fund
    ? [phrase]
    : [phrase, ...ladderFact(input), ...unplacedFact(locale, state, input.resting)]
}

/** Today's price between the stop and the take-profit the plan runs on. A plan whose stop is not
 *  below its take-profit is a sale, and drawing it would put the exit the reader fears on the side
 *  they want. */
function ladderFact(input: RiskSuffixInput): readonly string[] {
  const { locale, distance, price } = input
  const stop = distance?.stop
  const takeProfit = distance?.takeProfit

  if (stop === undefined || takeProfit === undefined || stop >= takeProfit) {
    return []
  }

  const ladder = renderLadder(
    {
      from: stop,
      to: takeProfit,
      at: price.at,
      fromLabel: t(locale, 'trading.render.portfolio.ladderStop', {
        price: formatPriceIn(locale, stop, price.quote),
      }),
      toLabel: t(locale, 'trading.render.portfolio.ladderTakeProfit', {
        price: formatPriceIn(locale, takeProfit, price.quote),
      }),
    },
    CHART_CELLS.fact,
    price.context
  )

  return ladder === undefined ? [] : [ladder]
}

/** One line under the rows for the holdings carrying no exit plan at all, named rather than
 *  counted: the operator acts on the name, and the count alone sends them back through the block
 *  to find which. */
export function renderUnplannedLine(
  locale: Locale,
  distances: readonly StopDistance[]
): readonly string[] {
  const unplanned = distances.filter((distance) => distance.plan === 'none')

  if (unplanned.length === 0) {
    return []
  }

  const named = unplanned.slice(0, MAXIMUM_NAMES_PER_LIST).map((one) => one.instrument.ticker)
  const overflow = unplanned.length - named.length
  const names = [
    ...named,
    ...(overflow === 0
      ? []
      : [t(locale, 'trading.render.layout.more', { count: formatCount(locale, overflow) })]),
  ]

  return [
    `${INDENT[1]}${t(
      locale,
      pluralKey(
        unplanned.length,
        'trading.render.portfolio.noExitPlanCountOne',
        'trading.render.portfolio.noExitPlanCount'
      ),
      { count: formatCount(locale, unplanned.length), names: names.join(INLINE_SEPARATOR) }
    )}`,
  ]
}

/** The one case where the row above overstates protection: the level is real, and nothing is
 *  standing behind it at the exchange. Silent where no stop is planned, and where the venues holding
 *  the name could carry no resting order at all. */
function unplacedFact(
  locale: Locale,
  state: StopState,
  resting: StopCover | undefined
): readonly string[] {
  return isPlanned(state) && resting === 'none'
    ? [t(locale, 'trading.render.portfolio.stopNotPlaced')]
    : []
}

function isPlanned(state: StopState): boolean {
  return state.kind === 'breached' || state.kind === 'near' || state.kind === 'clear'
}

function riskPhrase(input: RiskSuffixInput, state: StopState): string | undefined {
  const { locale } = input

  switch (state.kind) {
    // Counted once under the block instead: repeated per row, it buries the rows that do carry a
    // level.
    case 'unplanned':
      return undefined
    case 'breached':
      return t(
        locale,
        input.fund
          ? 'trading.render.portfolio.reviewBreached'
          : 'trading.render.portfolio.stopBreached'
      )
    case 'near':
    case 'clear':
      return t(
        locale,
        input.fund
          ? 'trading.render.portfolio.reviewDistance'
          : 'trading.render.portfolio.stopDistance',
        { pct: formatFixedFraction(locale, state.pct) }
      )
    case 'unknown':
      return undefined
    default: {
      const exhaustive: never = state
      return exhaustive
    }
  }
}
