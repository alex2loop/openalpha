import type { CompanyInput } from '@/trading/features/themes/chain/company-reads'
import type { ChainDeps, ChainRequest } from '@/trading/features/themes/chain/deps'
import type { EvidencePart } from '@/trading/features/themes/evidence/deps'
import type { EvidenceDraft, PricedAt } from '@/trading/features/themes/types'
import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { Candle } from '@/trading/kernel/market/market-data'
import type { ValuationPoint } from '@/trading/kernel/market/valuation'
import { MAXIMUM_TARGET_PE } from '@/trading/features/themes/analyst/schemas'
import { toSectorValuationDraft } from '@/trading/features/themes/chain/sector-facts'
import {
  formatFigure,
  formatShare,
  toDayBefore,
  toPercentRank,
} from '@/trading/features/themes/evidence/series'
import { THEME_MARKET } from '@/trading/features/themes/types'

const RETURN_WINDOW_DAYS = 366
/** A series whose first bar starts later than this into the window is a younger listing or a hole,
 *  and its return is not a twelve-month one. */
const RETURN_START_SLACK_DAYS = 10
/** A close or a ratio older than this against the board's session is a halted name or a stalled
 *  feed, and reads as no reading rather than as today's. */
const MAXIMUM_READING_AGE_DAYS = 7
const VALUATION_HISTORY_DAYS = 5 * 365 + 2
/** About two years of sessions: fewer daily P/E readings rank a young listing against itself. */
const MINIMUM_PE_READINGS = 500

export interface PeRange {
  readonly min: number
  readonly max: number
}

export interface ValuationPart extends EvidencePart {
  readonly pe?: number
  readonly pePercentile?: number
  readonly peRange?: PeRange
}

export interface PricePart extends EvidencePart {
  readonly excessReturn?: number
  readonly close?: PricedAt
}

interface PeReading {
  readonly current: number
  readonly day: TradingDay
  readonly percentile: number
  readonly range?: PeRange
}

export async function readBars(
  deps: ChainDeps,
  input: { readonly ticker: Ticker; readonly day: TradingDay; readonly request: ChainRequest }
): Promise<readonly Candle[] | undefined> {
  const result = await deps.marketData.bars({
    ticker: input.ticker,
    market: THEME_MARKET,
    fromDay: toDayBefore(input.day, RETURN_WINDOW_DAYS),
    toDay: input.day,
    now: input.request.now,
    signal: input.request.signal,
  })

  return result.kind === 'available' && result.value.length > 0 ? result.value : undefined
}

export async function readValuationPart(
  deps: ChainDeps,
  input: CompanyInput
): Promise<ValuationPart> {
  const result = await deps.sources.resolve({
    kind: 'valuationRatios',
    context: {
      market: THEME_MARKET,
      ticker: input.ticker,
      fromDay: toDayBefore(input.context.day, VALUATION_HISTORY_DAYS),
    },
    signal: input.request.signal,
  })
  const oldest = toDayBefore(input.context.day, MAXIMUM_READING_AGE_DAYS)
  const points = result.kind === 'available' ? result.value.points : []
  const book = points.findLast((point) => point.priceToBook !== undefined && point.day >= oldest)
  const earnings = toPeReading(points, oldest)
  const drafts = [...toValuationDrafts(earnings, book), ...toSectorDrafts(input)]

  return {
    kind: 'valuation',
    drafts,
    missing: earnings === undefined && book === undefined,
    ...(earnings === undefined
      ? {}
      : {
          pe: earnings.current,
          pePercentile: earnings.percentile,
          ...(earnings.range === undefined ? {} : { peRange: earnings.range }),
        }),
  }
}

/** The newest P/E, ranked against the name's own daily readings. A loss-making year publishes no
 *  P/E, so a fresh P/B can stand without one. */
function toPeReading(points: readonly ValuationPoint[], oldest: TradingDay): PeReading | undefined {
  const latest = points.findLast((point) => point.priceToEarnings !== undefined)
  const history = points.flatMap((point) => point.priceToEarnings ?? [])
  const current = latest?.priceToEarnings

  if (
    latest === undefined ||
    current === undefined ||
    latest.day < oldest ||
    history.length < MINIMUM_PE_READINGS
  ) {
    return undefined
  }

  const range = toPeRange(history)

  return {
    current,
    day: latest.day,
    percentile: toPercentRank(current, history),
    ...(range === undefined ? {} : { range }),
  }
}

/** The multiples a target may be held to. A year of near-zero earnings prints a P/E in the hundreds
 *  that no buyer ever paid for the business, so readings above the target cap stay out. */
function toPeRange(history: readonly number[]): PeRange | undefined {
  const paid = history.filter((value) => value <= MAXIMUM_TARGET_PE)

  return paid.length === 0 ? undefined : { min: Math.min(...paid), max: Math.max(...paid) }
}

function toValuationDrafts(
  earnings: PeReading | undefined,
  book: ValuationPoint | undefined
): readonly EvidenceDraft[] {
  const day = [earnings?.day, book?.day]
    .flatMap((entry) => entry ?? [])
    .toSorted()
    .at(-1)

  if (day === undefined) {
    return []
  }

  const facts = [
    ...(earnings === undefined
      ? []
      : [
          `P/E ${formatFigure(earnings.current)}, at or above ${earnings.percentile}% of its daily readings over five years${renderPeRange(earnings.range)}`,
        ]),
    ...(book?.priceToBook === undefined ? [] : [`P/B ${formatFigure(book.priceToBook)}`]),
  ]

  return [{ kind: 'valuation', origin: 'valuation', text: facts.join('; '), day }]
}

function renderPeRange(range: PeRange | undefined): string {
  return range === undefined
    ? ''
    : ` (range ${formatFigure(range.min)} to ${formatFigure(range.max)})`
}

/** The sector line beside the company's own, so the company step reads both percentiles the spec
 *  asks for: against the name's own history and against its sector. */
function toSectorDrafts(input: CompanyInput): readonly EvidenceDraft[] {
  const sector = input.context.sectorOf.get(input.ticker)
  const reading = sector === undefined ? undefined : input.context.sectorValuations.get(sector)

  return sector === undefined || reading === undefined
    ? []
    : toSectorValuationDraft(sector, reading)
}

export async function readPricePart(deps: ChainDeps, input: CompanyInput): Promise<PricePart> {
  const bars = await readBars(deps, {
    ticker: input.ticker,
    day: input.context.day,
    request: input.request,
  })
  const window = toReturnWindow(input.context.day)
  const last = bars?.at(-1)
  const own = bars === undefined ? undefined : toWindowReturn(bars, window)
  const index = input.benchmark === undefined ? undefined : toWindowReturn(input.benchmark, window)

  if (last === undefined || own === undefined) {
    return { kind: 'price', drafts: [], missing: true }
  }

  const text = [
    `Twelve months to ${last.at}: ${formatShare(own)}`,
    ...(index === undefined ? [] : [`against VN-Index ${formatShare(index)}`]),
  ].join(' ')

  return {
    kind: 'price',
    drafts: [{ kind: 'price', origin: 'price', text, day: last.at }],
    missing: false,
    close: { day: last.at, value: last.close },
    ...(index === undefined ? {} : { excessReturn: own - index }),
  }
}

interface ReturnWindow {
  readonly latestStart: TradingDay
  readonly earliestEnd: TradingDay
}

function toReturnWindow(day: TradingDay): ReturnWindow {
  return {
    latestStart: toDayBefore(day, RETURN_WINDOW_DAYS - RETURN_START_SLACK_DAYS),
    earliestEnd: toDayBefore(day, MAXIMUM_READING_AGE_DAYS),
  }
}

/** Both ends are held to the window, so a name and the index are measured over the same span. */
function toWindowReturn(bars: readonly Candle[], window: ReturnWindow): number | undefined {
  const first = bars[0]
  const last = bars.at(-1)

  return first === undefined ||
    last === undefined ||
    first.at > window.latestStart ||
    last.at < window.earliestEnd ||
    first.close <= 0
    ? undefined
    : last.close / first.close - 1
}
