import type { LevelPolicy, LevelRequest, LevelResult } from '@/trading/kernel/factor'
import { WORLD_TICK } from '@/trading/markets/gold/api'
import { VN_GOLD_TICK } from '@/trading/markets/gold-vn/policy'
import { buildLevels, buildRoundedLevels } from '@/trading/markets/levels'

/** World bars supply the percentage risk distance, the local board supplies the prices: world
 *  levels in USD per ounce would be the wrong currency and unit. The entry is what the shop charges,
 *  and a buy's stop and target sit on what the shop pays back, so the spread is already inside the
 *  risk, the reward and every ratio read off them. Without a board price there is no local level.
 *  The world read's caveats carry over: a capped stop is capped here too. */
export function vnGoldLevels(policy: LevelPolicy, request: LevelRequest): LevelResult {
  const { entry } = request

  if (entry === undefined || !(entry > 0)) {
    return { kind: 'unavailable', reasonCode: 'insufficient-data' }
  }

  const world = buildLevels({
    candles: request.candles,
    policy,
    tickSize: WORLD_TICK,
    direction: request.direction,
    horizon: request.horizon,
  })

  if (world.kind === 'unavailable') {
    return world
  }

  const stopFraction = (world.levels.entry - world.levels.stop) / world.levels.entry
  const exit = request.direction === 'buy' ? (request.exitPrice ?? entry) : entry

  const local = buildRoundedLevels({
    entry,
    stop: exit * (1 - stopFraction),
    atr: (world.levels.atr * entry) / world.levels.entry,
    tickSize: VN_GOLD_TICK,
    direction: request.direction,
    targetRiskMultiplier: policy.targetRiskMultiplier[request.horizon],
  })

  return local.kind === 'available'
    ? { ...local, caveats: [...local.caveats, ...world.caveats] }
    : local
}
