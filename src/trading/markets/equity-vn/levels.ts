import type { Caveat } from '@/trading/kernel/caveat'
import type {
  LevelPolicy,
  LevelResult,
  MarketLevelRequest,
  TradeLevels,
} from '@/trading/kernel/factor'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { Candle, InstrumentRecord } from '@/trading/kernel/market/market-data'
import type { MarketDeps } from '@/trading/markets/deps'
import type { CrossSection, NameEvidence } from '@/trading/markets/equity-vn/factors/factors'
import type { Tradeability } from '@/trading/markets/equity-vn/tradeability'
import { ETF_KIND } from '@/trading/kernel/instrument'
import {
  VN_FUND_LEVEL_POLICY,
  VN_LEVEL_POLICY,
  VN_MARKET_REF,
  VN_MARKET_REGION,
} from '@/trading/markets/equity-vn/policy'
import {
  hasForeignRoom,
  resolveBandReference,
  resolveDirectionBlock,
  resolveTradeability,
} from '@/trading/markets/equity-vn/tradeability'
import { resolveLevelPolicy } from '@/trading/markets/level-settings'
import { buildLevels } from '@/trading/markets/levels'

const HISTORY_NOT_ADJUSTED: LevelResult = Object.freeze({
  kind: 'unavailable',
  reasonCode: 'history-not-adjusted',
})

interface PricedEntry {
  readonly price: number
  readonly session: TradingDay
}

/** The band the order fills under, and the band of the session its entry price printed in. */
interface SessionBands {
  readonly order: Tradeability
  readonly priced: Tradeability
}

/** Resolves the instrument's own tick, band, direction, and ownership-room policy before the
 * shared level formula runs. */
export function buildVnLevels(
  deps: MarketDeps,
  cross: CrossSection,
  request: MarketLevelRequest
): LevelResult {
  const evidence = cross.byTicker.get(request.instrument.ticker)
  const entry = entryOf(request)

  if (evidence === undefined || entry === undefined) {
    return { kind: 'unavailable', reasonCode: 'insufficient-data' }
  }

  const bands = sessionBandsOf(evidence.record, request, entry)

  if (bands === undefined) {
    return { kind: 'unavailable', reasonCode: 'insufficient-data' }
  }

  const placement = placementOf({ deps, request, evidence, entryPrice: entry.price, bands })

  if (placement.kind === 'refused') {
    return placement.result
  }

  const tradeability = bands.order
  const { roomCaveats } = placement
  const roomUnverified = unverifiedRoomCaveats(deps, request, tradeability)

  const result = buildLevels({
    ...request,
    policy: levelPolicyOf(deps, evidence.record),
    tickSize: tradeability.tickSize,
    dailyBand: tradeability.dailyBand,
  })

  if (result.kind !== 'available') {
    return result
  }

  // A VN fund is reviewed, never stopped: its wrapper trades too thinly to arm an exit against, and
  // the segment's own weight answers a drawdown in the index it tracks.
  return {
    ...result,
    ...(evidence.record.kind === ETF_KIND
      ? { levels: { ...result.levels, reviewOnly: true } }
      : {}),
    caveats: [
      ...tradeability.caveats,
      ...roomCaveats,
      ...roomUnverified,
      ...stopBeyondBandCaveats(result.levels, tradeability),
      ...result.caveats,
    ],
  }
}

interface PlacementInput {
  readonly deps: MarketDeps
  readonly request: MarketLevelRequest
  readonly evidence: NameEvidence
  readonly entryPrice: number
  readonly bands: SessionBands
}

type Placement =
  | { readonly kind: 'refused'; readonly result: LevelResult }
  | { readonly kind: 'open'; readonly roomCaveats: readonly Caveat[] }

/** Own band, direction and foreign room gate a new order. A held position's entry is a fill already
 *  made, so none of them applies. */
function placementOf(input: PlacementInput): Placement {
  const { deps, request, evidence, entryPrice, bands } = input

  if (request.forHolding === true) {
    return { kind: 'open', roomCaveats: [] }
  }

  if (isOutsideOwnBand(entryPrice, bands.priced)) {
    return { kind: 'refused', result: HISTORY_NOT_ADJUSTED }
  }

  const tradeability = bands.order
  const direction = resolveDirectionBlock(bands.priced, request.direction, entryPrice)

  if (direction.kind === 'blocked') {
    return {
      kind: 'refused',
      result: {
        kind: 'unavailable',
        reasonCode: 'market-not-tradeable',
        caveats: [...tradeability.caveats, direction.caveat],
      },
    }
  }

  const roomExhausted = isForeignRoomExhausted(request, tradeability, evidence)
  const roomCaveats: readonly Caveat[] = roomExhausted
    ? [{ code: 'market.foreign-room-exhausted', detail: { ticker: request.instrument.ticker } }]
    : []

  // The cap binds foreign buyers, so only a foreign operator is blocked by it. A domestic one still
  // sees the caveat: a full room is a crowding signal either way.
  if (roomExhausted && deps.config.defaultRegion !== VN_MARKET_REGION) {
    return {
      kind: 'refused',
      result: {
        kind: 'unavailable',
        reasonCode: 'market-not-tradeable',
        caveats: [...tradeability.caveats, ...roomCaveats],
      },
    }
  }

  return { kind: 'open', roomCaveats }
}

/** A fund's levels are review points, a share's are exits; the operator's market settings apply to
 *  both. */
function levelPolicyOf(deps: MarketDeps, record: InstrumentRecord): LevelPolicy {
  return resolveLevelPolicy(
    record.kind === ETF_KIND ? VN_FUND_LEVEL_POLICY : VN_LEVEL_POLICY,
    deps.config.markets[VN_MARKET_REF]
  )
}

/** The price a position would open at and the session it printed in; the last close by default. */
function entryOf(request: MarketLevelRequest): PricedEntry | undefined {
  const newest = request.candles[request.candles.length - 1]
  const price = request.entry ?? newest?.close
  const session = request.entrySession ?? newest?.at

  return price === undefined || session === undefined ? undefined : { price, session }
}

/** A close read after the bell is judged at the edge of its own session's band: against the next
 *  session's, whose reference it is, it can never sit at one. */
function sessionBandsOf(
  record: InstrumentRecord,
  request: MarketLevelRequest,
  entry: PricedEntry
): SessionBands | undefined {
  const { candles, orderSession } = request
  const order = tradeabilityAt(record, orderReferenceOf(candles, orderSession, entry), orderSession)
  const priced =
    entry.session < orderSession
      ? tradeabilityAt(record, resolveBandReference(candles, entry.session), entry.session)
      : order

  return order === undefined || priced === undefined ? undefined : { order, priced }
}

/** Settled bars land a while after the bell, and until then the entry is the close the next
 *  session's band is priced from. */
function orderReferenceOf(
  candles: readonly Candle[],
  orderSession: TradingDay,
  entry: PricedEntry
): number | undefined {
  const newest = candles[candles.length - 1]
  const isNewerThanBars = newest === undefined || newest.at < entry.session

  return entry.session < orderSession && isNewerThanBars
    ? entry.price
    : resolveBandReference(candles, orderSession)
}

function tradeabilityAt(
  record: InstrumentRecord,
  reference: number | undefined,
  session: TradingDay
): Tradeability | undefined {
  return reference === undefined
    ? undefined
    : resolveTradeability({ record, reference, asOf: session })
}

/** No trade prints outside its own session's band, so a price that does was measured against a
 *  stored close the exchange no longer uses: an ex-rights day whose history has not been adjusted
 *  yet. Reading it as a halted name, or as one pinned at its floor, would misstate the market. */
function isOutsideOwnBand(price: number, tradeability: Tradeability): boolean {
  const { floor, ceiling } = tradeability.dailyBand

  return price < floor || price > ceiling
}

/** A buy is the only direction the cap binds: a sale releases room rather than taking it. */
function isForeignRoomExhausted(
  request: MarketLevelRequest,
  tradeability: Tradeability,
  evidence: NameEvidence
): boolean {
  return (
    request.direction === 'buy' &&
    !hasForeignRoom(
      tradeability,
      evidence.record.foreignOwnershipPct,
      evidence.fundamental?.marketCap
    )
  )
}

/** Never a block: a cap nobody measured is not an exhausted one. Only a foreign operator is told,
 *  because the cap binds nobody else. */
function unverifiedRoomCaveats(
  deps: MarketDeps,
  request: MarketLevelRequest,
  tradeability: Tradeability
): readonly Caveat[] {
  if (
    request.direction !== 'buy' ||
    tradeability.foreignRoomMeasured ||
    deps.config.defaultRegion === VN_MARKET_REGION
  ) {
    return []
  }

  return [{ code: 'market.foreign-room-unverified', detail: { ticker: request.instrument.ticker } }]
}

/** A stop further from entry than one session's band cannot be exited on the day it triggers.
 *  Measured against the band reference, the price the band is priced from — not against entry, and
 *  against the band side the stop trades through: a reduce's stop sits above entry, where a fixed
 *  `entry - stop` is negative and could never fire. */
function stopBeyondBandCaveats(levels: TradeLevels, tradeability: Tradeability): readonly Caveat[] {
  const { policy } = tradeability.dailyBand
  const distancePct = Math.abs(levels.entry - levels.stop) / tradeability.reference
  const limitPct = levels.stop < levels.entry ? policy.maximumDownPct : policy.maximumUpPct

  return distancePct > limitPct ? [{ code: 'market.stop-beyond-band' }] : []
}
