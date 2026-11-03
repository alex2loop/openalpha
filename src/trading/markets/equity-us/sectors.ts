import type { TradingDay } from '@/trading/kernel/instrument'
import type { MarketRequest, SectorStrengthResult } from '@/trading/kernel/market/market-capability'
import type { UsBoardCache, UsBoardName } from '@/trading/markets/equity-us/board'
import type { SectorMember } from '@/trading/markets/sector-strength'
import { dedupeProvenance } from '@/trading/kernel/source/source-result'
import { US_BENCHMARK_TICKER, US_SECTOR_POLICY } from '@/trading/markets/equity-us/policy'
import { usBarProvenance } from '@/trading/markets/equity-us/raws'
import { sectorCoveragePct, sectorStrength } from '@/trading/markets/sector-strength'

/** The board's names grouped by Nasdaq's sector, led against the benchmark fund. The US publishes
 *  no foreign flow, so no sector carries one. */
export async function runUsSectors(
  boards: UsBoardCache,
  request: MarketRequest
): Promise<SectorStrengthResult> {
  const board = await boards.get(request.asOf, request.signal)
  const members = board.names.map(toSectorMember)
  const coverage = sectorCoveragePct(members)

  if (coverage < US_SECTOR_POLICY.minimumCoverage) {
    return {
      asOf: request.asOf,
      sectors: [],
      provenance: [],
      caveats: [{ code: 'market-data.no-coverage', detail: { coverage } }],
    }
  }

  const benchmark = board.funds.find(
    (fund) => fund.record.instrument.ticker === US_BENCHMARK_TICKER
  )

  return {
    asOf: request.asOf,
    sectors: sectorStrength({
      members,
      benchmark: (benchmark?.bars ?? []).map((bar) => bar.candle),
      session: newestSession(members) ?? request.asOf,
      policy: US_SECTOR_POLICY,
    }),
    provenance: dedupeProvenance(board.names.flatMap((name) => usBarProvenance(name.bars))),
    caveats: [],
  }
}

/** The session the newest traded bar belongs to: a weekend or holiday read reports the last day the
 *  board traded rather than a session nobody traded. */
function newestSession(members: readonly SectorMember[]): TradingDay | undefined {
  return members.reduce<TradingDay | undefined>(
    (latest, member) =>
      member.at !== undefined && (latest === undefined || member.at > latest) ? member.at : latest,
    undefined
  )
}

function toSectorMember(name: UsBoardName): SectorMember {
  const newest = name.bars.at(-1)

  return {
    ticker: name.record.instrument.ticker,
    ...(name.record.sector === undefined ? {} : { sector: name.record.sector }),
    closes: name.bars.map((bar) => bar.candle.close),
    marketCap: name.marketCap,
    ...(newest === undefined || newest.candle.volume <= 0 ? {} : { at: newest.candle.at }),
  }
}
