import type { TradingDay, VnGoldForm } from '@/trading/kernel/instrument'
import type { GoldBoard, GoldBoardRow } from '@/trading/kernel/market/market-data'
import type { MarketDeps } from '@/trading/markets/deps'
import type { TradingCalendar } from '@/trading/markets/types'
import { shiftCalendarDay } from '@/trading/markets/calendar'
import {
  GOLD_VN_PREMIUM_FORM,
  GOLD_VN_PREMIUM_MINIMUM_COVERAGE,
  GOLD_VN_PREMIUM_MINIMUM_HISTORY,
  GOLD_VN_PREMIUM_WINDOW_DAYS,
  MINIMUM_RING_PREMIUM_ADVANTAGE_FRACTION,
  PREFERRED_FORMS,
} from '@/trading/markets/gold-vn/policy'
import { percentileRank } from '@/trading/markets/timeseries'

/** Vietnamese lượng (cây, tael) = 37.5 g; a troy ounce = 31.1034768 g. A physical fact, not a
 *  tunable — it belongs beside the conversion, never in config. */
const TROY_OUNCES_PER_LUONG = 37.5 / 31.1034768

interface PremiumInput {
  readonly worldUsdPerOunce: number
  readonly usdVnd: number
  readonly formSellVndPerLuong: number
}

interface PremiumResult {
  readonly worldVndPerLuong: number
  readonly premium: number
}

/** Absent, not thrown: a non-positive operand here is bad market data, not a programming error, and
 *  every other bad-data condition in this market (stale board, cross-day operands, missing FX)
 *  already resolves to a hold. Throwing would force a try/catch onto a caller that needs none. */
function vnGoldPremium(input: PremiumInput): PremiumResult | undefined {
  if (
    input.formSellVndPerLuong <= 0 ||
    input.worldUsdPerOunce <= 0 ||
    input.usdVnd <= 0 ||
    !Number.isFinite(input.formSellVndPerLuong * input.worldUsdPerOunce * input.usdVnd)
  ) {
    return undefined
  }

  const worldVndPerLuong = input.worldUsdPerOunce * input.usdVnd * TROY_OUNCES_PER_LUONG

  return {
    worldVndPerLuong,
    premium: (input.formSellVndPerLuong - worldVndPerLuong) / worldVndPerLuong,
  }
}

export interface FormSelection {
  readonly row: GoldBoardRow
  readonly premium: number
}

interface SelectFormOptions {
  readonly board: GoldBoard
  readonly preferredForms: readonly VnGoldForm[]
  readonly worldUsdPerOunce: number
  readonly usdVnd: number
  /** Set when the caller named a form. Preference order answers "which form should I hold?",
   *  which is not what a named form is asking. */
  readonly form?: VnGoldForm
}

/** The configured preference wins ties; an alternative form displaces it only when it is materially
 *  cheaper, so a 0.01% difference cannot flip the pick from one day to the next. */
export function selectForm(options: SelectFormOptions): FormSelection | undefined {
  if (options.form !== undefined) {
    return namedForm(options.form, options)
  }

  const onBoard = options.preferredForms
    .map((form) => options.board.rows.find((row) => row.form === form))
    .filter((row): row is GoldBoardRow => row !== undefined)
  const [preferred] = onBoard

  if (preferred === undefined) {
    return undefined
  }

  const preferredPremium = premiumOf(preferred, options)
  const alternative = bestAlternative(onBoard, preferred, options)

  if (preferredPremium === undefined) {
    return alternative
  }

  return alternative !== undefined &&
    preferredPremium - alternative.premium >= MINIMUM_RING_PREMIUM_ADVANTAGE_FRACTION
    ? alternative
    : { row: preferred, premium: preferredPremium }
}

/** Absent means absent: another vendor's row would be an invisible substitution in the quote. */
function namedForm(form: VnGoldForm, options: SelectFormOptions): FormSelection | undefined {
  const row = options.board.rows.find((candidate) => candidate.form === form)

  if (row === undefined) {
    return undefined
  }

  const premium = premiumOf(row, options)

  return premium === undefined ? undefined : { row, premium }
}

function bestAlternative(
  onBoard: readonly GoldBoardRow[],
  preferred: GoldBoardRow,
  options: SelectFormOptions
): FormSelection | undefined {
  let best: FormSelection | undefined

  for (const row of onBoard) {
    const premium = row.form === preferred.form ? undefined : premiumOf(row, options)

    if (premium !== undefined && (best === undefined || premium < best.premium)) {
      best = { row, premium }
    }
  }

  return best
}

function premiumOf(row: GoldBoardRow, options: SelectFormOptions): number | undefined {
  return vnGoldPremium({
    worldUsdPerOunce: options.worldUsdPerOunce,
    usdVnd: options.usdVnd,
    formSellVndPerLuong: row.sellPricePerLuong,
  })?.premium
}

/** The stored premium history's series id. One id for the whole VN market, so gold and gold-vn overviews
 *  read and write the same percentile window. */
export const GOLD_VN_PREMIUM_SERIES = 'gold-vn.premium'

interface PremiumReading {
  readonly premium: number
  readonly ranking?: PremiumRanking
}

/** A percentile and the observations it was actually taken over. The two are published together
 *  because `GOLD_VN_PREMIUM_WINDOW_DAYS` is a lookback and the series may be half-empty inside it:
 *  a label naming the lookback claimed 108 sessions for a rank taken over 87, and the coverage floor
 *  admits as few as half of them. */
interface PremiumRanking {
  readonly percentile: number
  readonly sessions: number
}

interface PremiumOptions {
  readonly board: GoldBoard
  readonly worldUsdPerOunce: number
  readonly usdVnd: number
  readonly asOf: TradingDay
  readonly calendar: TradingCalendar
  readonly signal: AbortSignal
}

/** Computes the premium of the form the stored series holds and ranks it within that window, so the
 *  printed premium and its rank are one population. Read-only: the refresh pass owns every write to
 *  the series, so viewing a board can never move the history a percentile was taken from. Absent
 *  when the board lacks that form, which is bad board data rather than a number to invent. */
export async function readPremium(
  deps: MarketDeps,
  options: PremiumOptions
): Promise<PremiumReading | undefined> {
  const { board, worldUsdPerOunce, usdVnd, asOf, calendar, signal } = options
  const premium = historyPremiumOf({ board, worldUsdPerOunce, usdVnd })

  if (premium === undefined) {
    return undefined
  }

  const ranking = await rankPremium(deps, {
    board,
    worldUsdPerOunce,
    usdVnd,
    calendar,
    toDay: asOf,
    signal,
  })

  return ranking === undefined ? { premium } : { premium, ranking }
}

interface HistoryPremiumInput {
  readonly board: GoldBoard
  readonly worldUsdPerOunce: number
  readonly usdVnd: number
}

/** The premium of the one form the stored series holds, never the policy pick: a ring ranked against
 *  bar-only history would be two populations. Absent when the board lacks that row. */
export function historyPremiumOf(input: HistoryPremiumInput): number | undefined {
  return selectForm({
    ...input,
    preferredForms: PREFERRED_FORMS,
    form: GOLD_VN_PREMIUM_FORM,
  })?.premium
}

interface RankPremiumOptions extends HistoryPremiumInput {
  /** The window is this market's own, so it is stepped here rather than at each caller. */
  readonly calendar: TradingCalendar
  readonly toDay: TradingDay
  readonly signal: AbortSignal
}

/** Read-and-rank only — the factor path calls this without writing, so scoring a name can never
 *  mutate the stored history. Absent while the window holds fewer days than the minimum: a
 *  percentile against a handful of points would read as a real ranking. Also absent when the board
 *  has no row of the history's form, rather than ranked from another form.
 *
 *  Every caller passes today as `toDay`, and `listSeriesPoints` is inclusive: once `refresh.ts` has
 *  written today's point, the naive window would rank today's premium against itself. The window
 *  ends the day before instead, so today's reading is always ranked against prior history only. */
export async function rankPremium(
  deps: MarketDeps,
  options: RankPremiumOptions
): Promise<PremiumRanking | undefined> {
  const premium = historyPremiumOf(options)

  if (premium === undefined) {
    return undefined
  }

  const points = await deps.marketDataStore.listSeriesPoints({
    seriesId: GOLD_VN_PREMIUM_SERIES,
    fromDay: options.calendar.addTradingDays(options.toDay, -GOLD_VN_PREMIUM_WINDOW_DAYS),
    toDay: shiftCalendarDay(options.toDay, -1),
    signal: options.signal,
  })

  // Two floors, because a series that is still filling and one that has stalled fail differently:
  // too few points ranks against noise, and too sparse a window means nothing is feeding it.
  if (
    points.length < GOLD_VN_PREMIUM_MINIMUM_HISTORY ||
    points.length < GOLD_VN_PREMIUM_WINDOW_DAYS * GOLD_VN_PREMIUM_MINIMUM_COVERAGE
  ) {
    return undefined
  }

  const values = points.map((point) => point.value)
  const percentile = percentileRank(values, premium)

  return percentile === undefined ? undefined : { percentile, sessions: values.length }
}
