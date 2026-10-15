import type { Booted } from '@/app/api'
import type { ConvictionBand } from '@/trading/kernel/conviction'
import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { ScreenCandidate } from '@/trading/kernel/market/market-capability'
import { ticker as brandTicker } from '@/trading/kernel/instrument'
import { VN_INDEX_TICKER, VN_MARKET_REF } from '@/trading/markets/equity-vn/policy'

const SCREEN_LIMIT = 2_000
/** Past the VN tape's settle on the board's own day, so the screen reads that session as settled. */
const SETTLED_UTC_HOUR = 13
const QUANTILE_SHARE = 0.2
const PERCENT_SCALE = 100
const MINIMUM_RANKED = 20

interface Row {
  readonly composite: number
  readonly bucket: string
  /** Each fired factor's score and its share of the composite. */
  readonly factors: ReadonlyMap<string, FiredFactor>
  /** Return over the horizon less the index's over the same sessions. */
  readonly excess: number
}

interface FiredFactor {
  readonly score: number
  readonly weight: number
}

interface Board {
  readonly day: TradingDay
  readonly rows: readonly Row[]
}

export interface MeasureScope {
  readonly booted: Booted
  /** Every stored session, ascending. */
  readonly sessions: readonly TradingDay[]
  readonly boards: readonly TradingDay[]
  readonly horizon: number
}

type Closes = Map<Ticker, ReadonlyMap<TradingDay, number>>

export async function measureBoards(scope: MeasureScope): Promise<readonly Board[]> {
  const { marketData } = scope.booted.app.resolve('tradingServices')
  const closes: Closes = new Map()
  const boards: Board[] = []

  for (const day of scope.boards) {
    const end = scope.sessions[scope.sessions.indexOf(day) + scope.horizon]

    if (end === undefined) {
      continue
    }

    const screen = await marketData.screen({
      market: VN_MARKET_REF,
      limit: SCREEN_LIMIT,
      now: Date.parse(`${day}T${String(SETTLED_UTC_HOUR).padStart(2, '0')}:00:00Z`),
      signal: scope.booted.app.signal,
    })

    if (screen.dataThroughDay !== day) {
      process.stderr.write(`${day}: skipped, board reads ${screen.dataThroughDay ?? 'nothing'}\n`)
      continue
    }

    const window = { day, end }
    const index = await returnOf(scope, closes, { ticker: brandTicker(VN_INDEX_TICKER), ...window })
    const rows = await Promise.all(
      screen.candidates.map((candidate) => rowOf(scope, closes, { candidate, index, ...window }))
    )
    const scored = rows.flatMap((row) => (row === undefined ? [] : [row]))

    process.stderr.write(`${day}: ${scored.length} names\n`)

    // A board too thin to rank would put a hole in the series the Newey-West lags are spaced on.
    if (scored.length >= MINIMUM_RANKED) {
      boards.push({ day, rows: scored })
    }
  }

  return boards
}

interface RowInput {
  readonly candidate: ScreenCandidate
  readonly index: number | undefined
  readonly day: TradingDay
  readonly end: TradingDay
}

async function rowOf(
  scope: MeasureScope,
  closes: Closes,
  input: RowInput
): Promise<Row | undefined> {
  const { candidate, index } = input
  const own = await returnOf(scope, closes, { ticker: candidate.instrument.ticker, ...input })

  if (own === undefined || index === undefined || candidate.composite.coverageBelowMinimum) {
    return undefined
  }

  return {
    composite: candidate.composite.score,
    bucket: bucketOf(candidate.composite.bullish, candidate.composite.band),
    factors: new Map(
      candidate.factors.flatMap((factor) =>
        factor.weight === undefined
          ? []
          : [[factor.id, { score: factor.score, weight: factor.weight }] as const]
      )
    ),
    excess: own - index,
  }
}

function bucketOf(bullish: boolean, band: ConvictionBand): string {
  return bullish ? `buy-${band}` : 'no-buy'
}

async function returnOf(
  scope: MeasureScope,
  closes: Closes,
  at: { readonly ticker: Ticker; readonly day: TradingDay; readonly end: TradingDay }
): Promise<number | undefined> {
  const series = await seriesOf(scope, closes, at.ticker)
  const start = series.get(at.day)
  const end = series.get(at.end)

  return start === undefined || end === undefined || start <= 0 ? undefined : end / start - 1
}

async function seriesOf(
  scope: MeasureScope,
  closes: Closes,
  ticker: Ticker
): Promise<ReadonlyMap<TradingDay, number>> {
  const known = closes.get(ticker)

  if (known !== undefined) {
    return known
  }

  const { app } = scope.booted
  const first = scope.boards[0]
  const last = scope.sessions.at(-1)
  const bars =
    first === undefined || last === undefined
      ? []
      : await app.resolve('tradingStores').marketData.listBars({
          instrument: { market: VN_MARKET_REF, ticker },
          fromDay: first,
          toDay: last,
          signal: app.signal,
        })
  const series = new Map(bars.map((bar) => [bar.candle.at, bar.candle.close] as const))

  closes.set(ticker, series)

  return series
}

/** Boards closer than `independentEvery` share part of their holding window, so the t-statistic is
 *  Newey-West over that many lags rather than one that treats every board as independent. The two
 *  halves are printed apart because one regime can carry a whole-sample mean. */
export function report(boards: readonly Board[], independentEvery: number): void {
  const factorIds = [
    ...new Set(boards.flatMap((board) => board.rows.flatMap((row) => [...row.factors.keys()]))),
  ]

  console.log(`\n${boards.length} boards, ${boards[0]?.day ?? '-'}..${boards.at(-1)?.day ?? '-'}`)
  console.log(`overlap: ${independentEvery} boards per holding window`)
  console.log('\nrank IC against excess return     boards  mean IC   t(NW)  1st half  2nd half  >0')
  printIc(boards, { label: 'composite', every: independentEvery, read: (row) => row.composite })

  for (const id of factorIds.sort()) {
    printIc(boards, {
      label: id,
      every: independentEvery,
      read: (row) => row.factors.get(id)?.score,
    })
  }

  console.log('\ncomposite IC with one factor left out, the rest renormalized')

  for (const id of factorIds) {
    printIc(boards, {
      label: `without ${id}`,
      every: independentEvery,
      read: (row) => compositeWithout(row, id),
    })
  }

  printBuckets(boards)
  printSpread(boards, independentEvery)
}

/** The live composite less one factor's share, over the weight the rest fired with. */
function compositeWithout(row: Row, id: string): number | undefined {
  const left = row.factors.get(id)
  const rest = 1 - (left?.weight ?? 0)

  return rest <= 0 ? undefined : (row.composite - (left ? left.score * left.weight : 0)) / rest
}

interface IcLine {
  readonly label: string
  readonly every: number
  read(row: Row): number | undefined
}

function printIc(boards: readonly Board[], line: IcLine): void {
  const { label, every, read } = line
  const ics = boards.flatMap((board) => {
    const pairs = board.rows.flatMap((row) => {
      const value = read(row)

      return value === undefined ? [] : [[value, row.excess] as const]
    })

    return pairs.length < MINIMUM_RANKED ? [] : [spearman(pairs)]
  })
  const positive = ics.filter((ic) => ic > 0).length
  const half = Math.floor(ics.length / 2)

  console.log(
    `  ${label.padEnd(30)} ${String(ics.length).padStart(6)}  ${fixed(mean(ics)).padStart(7)}  ` +
      `${fixed(neweyWestT(ics, every)).padStart(6)}  ${fixed(mean(ics.slice(0, half))).padStart(8)}  ` +
      `${fixed(mean(ics.slice(half))).padStart(8)}  ${positive}/${ics.length}`
  )
}

/** Against the board's own equal-weighted mean as well as the index: the index is cap-weighted, so
 *  a tape led by a few large names puts every bucket below it and hides the order between them. */
function printBuckets(boards: readonly Board[]): void {
  const rows = boards.flatMap((board) => {
    const average = mean(board.rows.map((row) => row.excess))

    return board.rows.map((row) => ({ ...row, relative: row.excess - average, day: board.day }))
  })
  const buckets = [...new Set(rows.map((row) => row.bucket))].sort()

  console.log('\nreturn over the horizon by what the board would suggest')

  for (const bucket of buckets) {
    const members = rows.filter((row) => row.bucket === bucket)
    const days = new Set(members.map((row) => row.day)).size

    console.log(
      `  ${bucket.padEnd(12)} n=${String(members.length).padStart(6)} on ${String(days).padStart(3)} boards  ` +
        `vs index ${percent(mean(members.map((row) => row.excess)))}  ` +
        `vs board ${percent(mean(members.map((row) => row.relative)))}`
    )
  }
}

function printSpread(boards: readonly Board[], every: number): void {
  const spreads = boards.map((board) => {
    const ranked = [...board.rows].sort((left, right) => right.composite - left.composite)
    const size = Math.max(1, Math.floor(ranked.length * QUANTILE_SHARE))

    return (
      mean(ranked.slice(0, size).map((row) => row.excess)) -
      mean(ranked.slice(-size).map((row) => row.excess))
    )
  })

  console.log(
    `\ntop fifth minus bottom fifth by composite: mean ${percent(mean(spreads))}, ` +
      `t(NW) ${fixed(neweyWestT(spreads, every))}`
  )
}

function spearman(pairs: readonly (readonly [number, number])[]): number {
  const left = ranks(pairs.map(([value]) => value))
  const right = ranks(pairs.map(([, value]) => value))
  const centre = (pairs.length - 1) / 2
  let covariance = 0
  let leftSpread = 0
  let rightSpread = 0

  for (const [index, rank] of left.entries()) {
    const other = (right[index] ?? centre) - centre

    covariance += (rank - centre) * other
    leftSpread += (rank - centre) ** 2
    rightSpread += other ** 2
  }

  // Both spreads, not one: a factor clipped at its bound ties many names, which narrows its ranks.
  return leftSpread === 0 || rightSpread === 0
    ? 0
    : covariance / Math.sqrt(leftSpread * rightSpread)
}

/** Average rank for ties, so a block of equal scores carries no order. */
function ranks(values: readonly number[]): readonly number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value)
  const result = new Array<number>(values.length).fill(0)
  let start = 0

  while (start < order.length) {
    let stop = start

    while (stop + 1 < order.length && order[stop + 1]?.value === order[start]?.value) {
      stop += 1
    }

    for (let position = start; position <= stop; position += 1) {
      result[order[position]?.index ?? 0] = (start + stop) / 2
    }

    start = stop + 1
  }

  return result
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? Number.NaN
    : values.reduce((sum, value) => sum + value, 0) / values.length
}

/** Bartlett-weighted autocovariances up to `lags`, the overlap between neighbouring boards. */
function neweyWestT(values: readonly number[], lags: number): number {
  const average = mean(values)
  const centred = values.map((value) => value - average)
  let variance = autocovariance(centred, 0)

  for (let lag = 1; lag <= Math.min(lags, values.length - 1); lag += 1) {
    variance += 2 * (1 - lag / (lags + 1)) * autocovariance(centred, lag)
  }

  return values.length < 2 || variance <= 0
    ? Number.NaN
    : average / Math.sqrt(variance / values.length)
}

function autocovariance(centred: readonly number[], lag: number): number {
  return (
    centred.slice(lag).reduce((sum, value, index) => sum + value * (centred[index] ?? 0), 0) /
    centred.length
  )
}

function fixed(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : 'n/a'
}

function percent(value: number): string {
  return Number.isFinite(value) ? `${(value * PERCENT_SCALE).toFixed(2)}%` : 'n/a'
}
