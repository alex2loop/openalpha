import type { Locale } from '@/core/types/locale'
import type { MarketRef, TradingDay } from '@/trading/kernel/instrument'
import type {
  BriefField,
  BriefSectionKind,
  BriefSectionResult,
  BriefSectionRow,
} from '@/trading/kernel/operator/brief-section'
import type { RenderContext } from '@/trading/render/format'
import { formatShortDay, t } from '@/i18n'
import { marketRef } from '@/trading/kernel/instrument'
import { INLINE_SEPARATOR } from '@/trading/render/layout'
import { ABSENT_CELL } from '@/trading/render/number'
import { renderHeadlineCells } from '@/trading/render/price-pair'
import { toPricePair } from '@/trading/render/section-price'
import { renderValue } from '@/trading/render/section-values'

/** The market whose prices date the session the brief describes. */
const SESSION_MARKET = marketRef('equity-vn')

type ReadySection = Extract<BriefSectionResult, { readonly status: 'ready' }>

/** Where a figure's reading comes from: a section kind, and the field of its row that states it.
 *  A price row has no field, because its reading is the headline the section prints. */
interface StripSource {
  readonly kind: BriefSectionKind
  readonly field?: BriefField
}

type StripId = 'vn-index' | 'vn30' | 'sjc' | 'world-gold' | 'btc' | 'usd-vnd'

/** What a figure reads, and the day it settled on when that is not the brief's session. */
interface StripReading {
  readonly amount: string
  readonly settledOn?: TradingDay
}

interface StripFigure {
  readonly id: StripId
  readonly market: MarketRef
  readonly ticker: string
  readonly sources: readonly StripSource[]
}

const MARKET_PRICES: StripSource = Object.freeze({ kind: 'market-prices' })

/** The six figures a reader checks first, in the order they are read: the two indices, the gold
 *  Vietnamese buyers pay for and the world's, the coin, and the dollar. The SJC bar reads off the
 *  dealer board when it is live and off the last settled bar when the dealers have not revised. */
const STRIP_FIGURES: readonly StripFigure[] = Object.freeze([
  { id: 'vn-index', market: SESSION_MARKET, ticker: 'VNINDEX', sources: [MARKET_PRICES] },
  { id: 'vn30', market: SESSION_MARKET, ticker: 'VN30', sources: [MARKET_PRICES] },
  {
    id: 'sjc',
    market: marketRef('gold-vn'),
    ticker: 'SJC-BAR',
    sources: [{ kind: 'market-board', field: 'sellPrice' }, MARKET_PRICES],
  },
  { id: 'world-gold', market: marketRef('gold'), ticker: 'XAUUSD', sources: [MARKET_PRICES] },
  { id: 'btc', market: marketRef('crypto'), ticker: 'BTC', sources: [MARKET_PRICES] },
  {
    id: 'usd-vnd',
    market: SESSION_MARKET,
    ticker: 'USD/VND',
    sources: [{ kind: 'fx', field: 'rate' }],
  },
] as const satisfies readonly StripFigure[])

/** One cell per figure of a market the brief has a block for. A figure whose market has none is
 *  left out, so a brief without gold in Vietnam does not announce its absence; one whose market is
 *  there but gave no reading says so, because a missing price is not a price of zero. A close from
 *  a day other than the session carries its date, so an older bar never reads as this morning's. */
export function renderBriefStrip(
  locale: Locale,
  sections: readonly BriefSectionResult[],
  context: RenderContext
): readonly string[] {
  const session = briefSessionOf(sections)

  return STRIP_FIGURES.filter((figure) =>
    sections.some((section) => section.market === figure.market)
  ).map((figure) => {
    const label = t(locale, `trading.brief.strip.${figure.id}`)
    const reading = readingOf(locale, sections, { figure, session, context })

    return reading === undefined ? `${label} ${ABSENT_CELL}` : toCell(locale, label, reading)
  })
}

/** The session the prices describe: the day the Vietnam index prices are stated for, or the first
 *  market's where the brief has none. */
export function briefSessionOf(sections: readonly BriefSectionResult[]): TradingDay | undefined {
  const prices = sections.filter(
    (section) => section.status === 'ready' && section.kind === 'market-prices'
  )

  return (prices.find((section) => section.market === SESSION_MARKET) ?? prices[0])?.asOf
}

/** The first source that reads. A section that did not come back counts as no reading. */
function readingOf(
  locale: Locale,
  sections: readonly BriefSectionResult[],
  place: {
    readonly figure: StripFigure
    readonly session: TradingDay | undefined
    readonly context: RenderContext
  }
): StripReading | undefined {
  const { figure, session, context } = place

  for (const source of figure.sources) {
    const section = sections.find(
      (candidate): candidate is ReadySection =>
        candidate.status === 'ready' &&
        candidate.kind === source.kind &&
        candidate.market === figure.market
    )
    const row = section?.rows.find((candidate) => candidate.ticker === figure.ticker)
    const reading =
      section === undefined || row === undefined
        ? undefined
        : readRow(locale, { section, row, field: source.field, session }, context)

    if (reading !== undefined) {
      return reading
    }
  }

  return undefined
}

/** A price row reads as the section prints it, with the date of a close the session does not own.
 *  A board or fx row has one number worth stating and no move: a dealer board keeps no close, and
 *  a rate carries none. */
function readRow(
  locale: Locale,
  place: {
    readonly section: ReadySection
    readonly row: BriefSectionRow
    readonly field: BriefField | undefined
    readonly session: TradingDay | undefined
  },
  context: RenderContext
): StripReading | undefined {
  const { section, row, field, session } = place
  const currency = section.currency === undefined ? {} : { currency: section.currency }

  if (field !== undefined) {
    const value = row[field]

    return value === undefined
      ? undefined
      : { amount: renderValue(locale, [field, value], currency) }
  }

  const pair = toPricePair(row, { timezone: context.timezone, ...currency })
  const { cells, settledOn } =
    pair === undefined
      ? { cells: [] }
      : renderHeadlineCells(locale, pair, session === undefined ? {} : { statedDay: session })
  const [amount] = cells

  if (amount === undefined) {
    return undefined
  }

  return session !== undefined && settledOn !== undefined ? { amount, settledOn } : { amount }
}

/** The label, the amount and, for a close of another day, its date without the year: the session
 *  the brief names is this year's, and a cell that fits one line never needs a width branch. */
function toCell(locale: Locale, label: string, reading: StripReading): string {
  const { amount, settledOn } = reading
  const cell = `${label} ${amount}`

  return settledOn === undefined
    ? cell
    : `${cell}${INLINE_SEPARATOR}${formatShortDay(locale, settledOn)}`
}
