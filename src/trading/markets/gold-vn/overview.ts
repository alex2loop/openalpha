import type { TradingDay } from '@/trading/kernel/instrument'
import type { GoldBoardRow } from '@/trading/kernel/market/market-data'
import type {
  MarketDataOverview,
  MarketDataOverviewRow,
} from '@/trading/kernel/market/market-overview'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import type { BoardSnapshot } from '@/trading/markets/gold-vn/board'
import type { MarketManifest } from '@/trading/markets/types'
import { ticker } from '@/trading/kernel/instrument'
import { provenanceOf } from '@/trading/kernel/source/source-result'
import { GOLD_VN_MARKET_REF } from '@/trading/markets/gold-vn/policy'
import { readPremium } from '@/trading/markets/gold-vn/premium'
import { spreadPct } from '@/trading/markets/overview'

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
export async function runVnGoldOverview(load: VnGoldOverviewLoad): Promise<MarketDataOverview> {
  const { snapshot, deps, signal } = load
  const board = snapshot.kind === 'available' ? snapshot.value : undefined
  // The board dates this block, not the calendar: the counters keep Sunday shut, so the request's
  // day would stamp a session none of these rows belongs to — and rank the board against the very
  // point the refresh stored from it.
  const asOf = board?.asOf ?? load.asOf

  const premium =
    board === undefined
      ? undefined
      : await readPremium(deps, {
          board: board.board,
          worldUsdPerOunce: board.worldUsdPerOunce,
          usdVnd: board.usdVnd,
          asOf,
          calendar: load.manifest.calendar,
          signal,
        })

  return {
    market: load.manifest.id,
    asOf,
    currency: load.manifest.currency,
    priceCurrency: load.manifest.currency,
    icon: load.manifest.icon,
    rows: board === undefined ? [] : board.board.rows.map((row) => toRow(row, board.observedAt)),
    ...(premium === undefined ? {} : { premium: premium.premium }),
    ...(premium?.ranking === undefined ? {} : { premiumRank: premium.ranking }),
    provenance: provenanceOf(snapshot),
    caveats: snapshot.caveats,
  }
}

function toRow(row: GoldBoardRow, observedAt: number): MarketDataOverviewRow {
  const instrument = { market: GOLD_VN_MARKET_REF, ticker: ticker(row.form.toUpperCase()) }
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
