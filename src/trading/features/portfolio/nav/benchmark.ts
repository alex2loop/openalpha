import type {
  BenchmarkLeg,
  NavBarReader,
  NavBenchmark,
  NavHistory,
} from '@/trading/features/portfolio/nav/types'
import type { PortfolioSegment, TradingDay } from '@/trading/kernel/instrument'
import type { MarketRegistry } from '@/trading/markets/types'
import { CASH_SEGMENT, portfolioSegment } from '@/trading/kernel/instrument'
import { shiftCalendarDay } from '@/trading/markets/calendar'

/** How far a close may sit from a snapshot day and still price it: wide enough for a weekend or a
 *  holiday run, narrow enough that a series which stopped mid-window is not read as flat. */
const CLOSE_LEAD_DAYS = 10

interface BenchmarkDeps {
  readonly markets: MarketRegistry
  readonly marketDataStore: NavBarReader
}

interface BenchmarkRead {
  readonly days: readonly TradingDay[]
  readonly signal: AbortSignal
}

type BenchmarkResult =
  | { readonly kind: 'ready'; readonly benchmark: NavBenchmark }
  | { readonly kind: 'gap'; readonly gap: NonNullable<NavHistory['benchmarkGap']> }

type Closes = ReadonlyMap<TradingDay, number>

/** `undefined` is the cash leg, which earns nothing. */
type LegCloses = Closes | undefined

function resolveLegs(
  markets: MarketRegistry,
  targets: Readonly<Record<PortfolioSegment, number>>
): readonly BenchmarkLeg[] {
  const kept = Object.entries(targets).flatMap(([segment, weight]): BenchmarkLeg[] => {
    if (weight <= 0) {
      return []
    }

    if (segment === CASH_SEGMENT) {
      return [{ segment: CASH_SEGMENT, weight }]
    }

    const benchmark = markets.list().find((market) => market.manifest.segment === segment)
      ?.manifest.benchmark

    return benchmark === undefined
      ? []
      : [{ segment: portfolioSegment(segment), weight, instrument: benchmark }]
  })
  const total = kept.reduce((sum, leg) => sum + leg.weight, 0)

  return kept.map((leg) => ({ ...leg, weight: leg.weight / total }))
}

function closeOnOrBefore(closes: Closes, day: TradingDay): number | undefined {
  let found: { readonly day: TradingDay; readonly close: number } | undefined

  for (const [at, close] of closes) {
    if (at <= day && (found === undefined || at > found.day)) {
      found = { day: at, close }
    }
  }

  return found?.close
}

/** `undefined` for the cash leg, `null` when a leg's closes do not span the snapshot days. */
async function readCloses(
  deps: BenchmarkDeps,
  leg: BenchmarkLeg,
  read: BenchmarkRead
): Promise<LegCloses | null> {
  const first = read.days[0]
  const last = read.days.at(-1)

  if (leg.instrument === undefined) {
    return undefined
  }

  if (first === undefined || last === undefined) {
    return null
  }

  const bars = await deps.marketDataStore.listBars({
    instrument: leg.instrument,
    fromDay: shiftCalendarDay(first, -CLOSE_LEAD_DAYS),
    toDay: last,
    signal: read.signal,
  })
  const closes = new Map(bars.map((bar) => [bar.candle.at, bar.candle.close]))
  const latest = bars.at(-1)?.candle.at

  return closeOnOrBefore(closes, first) === undefined ||
    latest === undefined ||
    latest < shiftCalendarDay(last, -CLOSE_LEAD_DAYS)
    ? null
    : closes
}

function legReturn(closes: LegCloses, from: TradingDay, to: TradingDay): number {
  const start = closes === undefined ? undefined : closeOnOrBefore(closes, from)
  const end = closes === undefined ? undefined : closeOnOrBefore(closes, to)

  return start === undefined || end === undefined || start <= 0 ? 0 : end / start - 1
}

/** Rebalanced to the target mix each snapshot, the same chaining the book's own index uses. */
function toBenchmarkPoints(
  legs: readonly BenchmarkLeg[],
  closes: readonly LegCloses[],
  days: readonly TradingDay[]
): NavBenchmark['points'] {
  const points: { day: TradingDay; index: number }[] = []

  for (const [position, day] of days.entries()) {
    const previous = points.at(-1)
    const prior = days[position - 1]

    if (previous === undefined || prior === undefined) {
      points.push({ day, index: 1 })
      continue
    }

    const step = legs.reduce(
      (sum, leg, legPosition) => sum + leg.weight * legReturn(closes[legPosition], prior, day),
      0
    )

    points.push({ day, index: previous.index * (1 + step) })
  }

  return points
}

/** The operator's own target mix, held passively: each segment earns its market's benchmark and cash
 *  earns nothing. A segment whose market names no benchmark is left out and the rest are scaled
 *  back to one, cash included. */
export async function buildBenchmark(
  deps: BenchmarkDeps,
  targets: Readonly<Record<PortfolioSegment, number>>,
  read: BenchmarkRead
): Promise<BenchmarkResult> {
  const legs = resolveLegs(deps.markets, targets)

  if (!legs.some((leg) => leg.instrument !== undefined)) {
    return { kind: 'gap', gap: 'unbenchmarked' }
  }

  const series = await Promise.all(legs.map((leg) => readCloses(deps, leg, read)))
  const closes: LegCloses[] = []

  for (const entry of series) {
    if (entry === null) {
      return { kind: 'gap', gap: 'short-history' }
    }

    closes.push(entry)
  }

  const points = toBenchmarkPoints(legs, closes, read.days)
  const benchmark: NavBenchmark = { legs, points, periodReturn: (points.at(-1)?.index ?? 1) - 1 }

  return { kind: 'ready', benchmark }
}
