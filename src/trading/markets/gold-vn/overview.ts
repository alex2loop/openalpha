import type { Caveat } from '@/trading/kernel/caveat'
import type { InstrumentRef, TradingDay, VnGoldForm } from '@/trading/kernel/instrument'
import type { GoldBoardPoint, GoldBoardRow } from '@/trading/kernel/market/market-data'
import type {
  MarketDataOverview,
  MarketDataOverviewRow,
} from '@/trading/kernel/market/market-overview'
import type { SourceProvenance, SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import type { BoardSnapshot } from '@/trading/markets/gold-vn/board'
import type { MarketManifest, TradingCalendar } from '@/trading/markets/types'
import { dedupeCaveats } from '@/trading/kernel/caveat'
import { ticker } from '@/trading/kernel/instrument'
import { provenanceOf } from '@/trading/kernel/source/source-result'
import { GOLD_VN_MARKET_REF, GOLD_VN_PREMIUM_FORM } from '@/trading/markets/gold-vn/policy'
import { readPremium } from '@/trading/markets/gold-vn/premium'
import { spreadPct } from '@/trading/markets/overview'
import { dayChangePct } from '@/trading/sources/rows/normalization'

const SJC_FALLBACK_SESSIONS = 5

interface VnGoldOverviewLoad {
  readonly snapshot: SourceResult<BoardSnapshot>
  readonly manifest: MarketManifest
  readonly deps: MarketDeps
  readonly asOf: TradingDay
  readonly signal: AbortSignal
}

/** Pure over a snapshot the caller already holds: the board, the world metal and the rate arrive in
 *  one cached read, so the whole board plus its premium costs nothing beyond the quote that a single
 *  form would have. Both sides of every row, because the gap between them is what a same-day round
 *  trip costs and a one-sided board hides it. */
export function runVnGoldOverview(load: VnGoldOverviewLoad): Promise<MarketDataOverview> {
  const { snapshot } = load

  return snapshot.kind === 'available' ? boardOverview(load, snapshot.value) : settledOverview(load)
}

async function boardOverview(
  load: VnGoldOverviewLoad,
  board: BoardSnapshot
): Promise<MarketDataOverview> {
  const { snapshot, deps, signal } = load
  // The board dates this block, not the calendar: the counters keep Sunday shut, so the request's
  // day would stamp a session none of these rows belongs to — and rank the board against the very
  // point the refresh stored from it.
  const premium = await readPremium(deps, {
    board: board.board,
    worldUsdPerOunce: board.worldUsdPerOunce,
    usdVnd: board.usdVnd,
    asOf: board.asOf,
    calendar: load.manifest.calendar,
    signal,
  })

  return {
    ...overviewHead(load, board.asOf),
    rows: board.board.rows.map((row) => toRow(row, board.observedAt)),
    ...(premium === undefined ? {} : { premium: premium.premium }),
    ...(premium?.ranking === undefined || deps.readingsOnly === true
      ? {}
      : { premiumRank: premium.ranking }),
    provenance: provenanceOf(snapshot),
    caveats: snapshot.caveats,
  }
}

/** The dealers have not revised yet, which is most mornings: the block carries the last settled
 *  SJC bar instead, dated by its day. No premium, because that needs a live board. */
async function settledOverview(load: VnGoldOverviewLoad): Promise<MarketDataOverview> {
  const settled = await readSettledBar(load)

  return {
    ...overviewHead(load, load.asOf),
    rows: settled.rows,
    provenance: settled.provenance,
    caveats: settled.caveats,
  }
}

function overviewHead(load: VnGoldOverviewLoad, asOf: TradingDay) {
  return {
    market: load.manifest.id,
    asOf,
    currency: load.manifest.currency,
    priceCurrency: load.manifest.currency,
    icon: load.manifest.icon,
  }
}

interface SettledBar {
  readonly rows: readonly MarketDataOverviewRow[]
  readonly caveats: readonly Caveat[]
  readonly provenance: readonly SourceProvenance[]
}

/** The newest SJC bar before today and the one before it, from giavang's dated history. A failed
 *  read leaves no row, and its caveats say why. */
async function readSettledBar(load: VnGoldOverviewLoad): Promise<SettledBar> {
  const { calendar, region } = load.manifest
  const history = await load.deps.sources.resolve({
    kind: 'goldBoardHistory',
    context: {
      market: GOLD_VN_MARKET_REF,
      region,
      fromDay: calendar.addTradingDays(load.asOf, -SJC_FALLBACK_SESSIONS),
      toDay: load.asOf,
    },
    signal: load.signal,
  })
  const bars =
    history.kind === 'available'
      ? history.value.filter(createSettledBarFilter(load.asOf, calendar))
      : []
  const settled = bars.at(-1)

  return {
    rows: settled === undefined ? [] : [toSettledRow(settled, bars.at(-2), calendar)],
    caveats: dedupeCaveats([...load.snapshot.caveats, ...history.caveats]),
    provenance: provenanceOf(history),
  }
}

/** The SJC bar on a day the counters were open, before today: today's board is still forming, the
 *  other forms are not the one the premium and the headline read against, and a shut day's carried
 *  price would date the bar to a session that never traded and show a flat move. */
function createSettledBarFilter(
  asOf: TradingDay,
  calendar: TradingCalendar
): (point: GoldBoardPoint) => boolean {
  return (point) =>
    point.form === GOLD_VN_PREMIUM_FORM && point.day < asOf && calendar.isTradingDay(point.day)
}

function toSettledRow(
  settled: GoldBoardPoint,
  prior: GoldBoardPoint | undefined,
  calendar: TradingCalendar
): MarketDataOverviewRow {
  const instrument = formInstrument(settled.form)
  const changePct = dayChangePct(settled.sellPricePerLuong, prior?.sellPricePerLuong)

  return {
    instrument,
    quote: {
      instrument,
      price: settled.sellPricePerLuong,
      observedAt: calendar.sessionCloseAt(settled.day),
    },
    closedOn: settled.day,
    ...(changePct === undefined ? {} : { changePct }),
  }
}

function formInstrument(form: VnGoldForm): InstrumentRef {
  return { market: GOLD_VN_MARKET_REF, ticker: ticker(form.toUpperCase()) }
}

function toRow(row: GoldBoardRow, observedAt: number): MarketDataOverviewRow {
  const instrument = formInstrument(row.form)
  const spread = spreadPct(row.buyPricePerLuong, row.sellPricePerLuong)

  return {
    instrument,
    // The sell side is what an operator pays, so it is the one price a reader compares to anything.
    quote: {
      instrument,
      price: row.sellPricePerLuong,
      observedAt,
      board: {
        buyPrice: row.buyPricePerLuong,
        sellPrice: row.sellPricePerLuong,
        ...(spread === undefined ? {} : { spreadPct: spread }),
      },
    },
  }
}
