import type { Caveat } from '@/trading/kernel/caveat'
import type { MarketCapRecord } from '@/trading/kernel/market/market-data'
import type {
  MarketBreadth,
  MarketMover,
  MarketMovers,
} from '@/trading/kernel/market/market-overview'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import {
  CRYPTO_MARKET_REF,
  CRYPTO_MOVERS_PER_SIDE,
  EXCLUDED_TICKERS,
  MAXIMUM_RESOLUTION_RANK,
  MAXIMUM_SCREEN_CANDIDATES,
  MINIMUM_DAILY_VOLUME_USD,
  MINIMUM_MARKET_CAP_USD,
  STABLECOIN_TICKERS,
} from '@/trading/markets/crypto/policy'

/** The issuer brand every tokenized-equity row carries in its name. Both routed providers spell it
 *  differently around the brand — "Tesla xStock" on one, "Tesla tokenized stock (xStock)" on the
 *  other — so the marker is matched inside the name rather than at either end of it. */
const TOKENIZED_EQUITY_NAME_MARKER = 'xstock'

/** A row carrying the session change every mover is ranked on. */
type Moving = MarketCapRecord & { readonly changePct: number }

/** The whole ranked board — the one read every crypto surface plans against, so the rank window
 *  they share is stated once rather than per caller. */
export function loadUniverseBoard(
  deps: MarketDeps,
  signal: AbortSignal
): Promise<SourceResult<readonly MarketCapRecord[]>> {
  return deps.sources.resolve({
    kind: 'marketCap',
    context: { market: CRYPTO_MARKET_REF, limit: MAXIMUM_RESOLUTION_RANK },
    signal,
  })
}

/** Which rows the screen may fetch evidence for: liquid, inside the ranked window, and large enough
 *  to size. Every fact is on the sweep row, so excluding on it costs nothing, and it is what keeps
 *  one screen run to a bounded number of provider calls. */
export function isEligibleUniverseRow(record: MarketCapRecord): boolean {
  return (
    isLiquidUniverseRow(record) &&
    record.rank <= MAXIMUM_RESOLUTION_RANK &&
    hasMinimumMarketCap(record)
  )
}

/** Large enough to size. Read by the universe filter over a whole board, and by the admission gates
 *  over the one name the operator asked about by ticker. */
export function hasMinimumMarketCap(record: MarketCapRecord): boolean {
  return record.marketCapUsd >= MINIMUM_MARKET_CAP_USD
}

/** Turns over enough real money to be worth reporting, let alone trading. */
export function hasMinimumVolume(record: MarketCapRecord): boolean {
  return record.totalVolumeUsd >= MINIMUM_DAILY_VOLUME_USD
}

/** Whether the board ran out before the size floor did. The routed providers publish different
 *  depths — 750 rows, 250 and 100 — so a run that failed over to a shallow one ranks a fraction of
 *  the field while every count it prints describes that fraction as the whole. The signature is
 *  exact and needs no second constant: if even the smallest row clears the floor, what ended the
 *  board was the provider's own row cap, and what it cut off was eligible. */
function isBoardShallow(records: readonly MarketCapRecord[]): boolean {
  return records.length > 0 && records.every(hasMinimumMarketCap)
}

/** What a shallow board costs whoever read it. One owner, so the surfaces folding over one sweep
 *  cannot disagree about whether to mention that it ended early. */
export function shallowBoardCaveats(records: readonly MarketCapRecord[]): readonly Caveat[] {
  return isBoardShallow(records)
    ? [{ code: 'market-data.universe-shallow', detail: { rows: records.length } }]
    : []
}

function movingRows(records: readonly MarketCapRecord[]): readonly Moving[] {
  return records
    .filter(isLiquidUniverseRow)
    .filter((record): record is Moving => record.changePct !== undefined)
}

/** Advancers and decliners over the provider's rolling day, across the same liquid board the movers
 *  read. `measured` is every name with a change, so an unchanged name counts in the denominator. */
export function boardBreadth(records: readonly MarketCapRecord[]): MarketBreadth | undefined {
  const moving = movingRows(records)

  if (moving.length === 0) {
    return undefined
  }

  const advancers = moving.filter((record) => record.changePct > 0).length
  const decliners = moving.filter((record) => record.changePct < 0).length
  const moved = advancers + decliners

  return {
    advancers,
    decliners,
    netAdvancers: advancers - decliners,
    measured: moving.length,
    ...(moved === 0 ? {} : { advanceRatio: advancers / moved }),
  }
}

/** What moved, over the whole liquid universe rather than the part the screen can trade. Ungated on
 *  purpose: a name here is not a candidate, and several will have failed a gate the board applied.
 *  Absent where nothing qualified — a market where nobody moved reports no movers, not empty lists.
 *  The board read carries no daily bar per coin, so the move is the provider's rolling day and the
 *  window says so rather than borrowing the session's name. */
export function cryptoMovers(records: readonly MarketCapRecord[]): MarketMovers | undefined {
  const moving = movingRows(records)
  const gainers = moving
    .filter((record) => record.changePct > 0)
    .toSorted((left, right) => right.changePct - left.changePct)
  const losers = moving
    .filter((record) => record.changePct < 0)
    .toSorted((left, right) => left.changePct - right.changePct)

  if (gainers.length === 0 && losers.length === 0) {
    return undefined
  }

  return {
    window: 'rolling-24h',
    gainers: gainers.slice(0, CRYPTO_MOVERS_PER_SIDE).map(toMover),
    losers: losers.slice(0, CRYPTO_MOVERS_PER_SIDE).map(toMover),
  }
}

/** The rows a run acts on, largest first. Size is the only key, and deliberately so: it is fixed
 *  before the run and independent of every factor the composite then scores, where a tail picked by
 *  weekly gain could only ever admit a name that had already moved and skewed the very percentiles
 *  those factors are normalized against. The screen scores these and the refresh warms these, so a
 *  name a suggestion will read is a name the sweep already fetched. */
export function examinedRows(eligible: readonly MarketCapRecord[]): readonly MarketCapRecord[] {
  return eligible
    .toSorted((left, right) => left.rank - right.rank)
    .slice(0, MAXIMUM_SCREEN_CANDIDATES)
}

function toMover(record: Moving): MarketMover {
  return {
    instrument: record.instrument,
    changePct: record.changePct,
    turnover: record.totalVolumeUsd,
  }
}

/** Tradeable enough to be worth reporting at all: it turns over real money and is neither a peg, a
 *  mirror of an asset priced elsewhere, nor a share wearing a crypto listing. Deliberately says
 *  nothing about size — a small coin the whole market is trading is exactly what the movers list
 *  exists to surface. */
function isLiquidUniverseRow(record: MarketCapRecord): boolean {
  const { ticker } = record.instrument

  return (
    hasMinimumVolume(record) &&
    !STABLECOIN_TICKERS.has(ticker) &&
    !EXCLUDED_TICKERS.has(ticker) &&
    !isTokenizedEquity(record)
  )
}

/** A tokenized equity prices a claim on a share, which is a thesis none of this market's factors
 *  can argue. The symbol cannot carry the rule — real coins end in X — so the provider's own name
 *  for the row is what answers. */
export function isTokenizedEquity(record: MarketCapRecord): boolean {
  return record.name.toLowerCase().includes(TOKENIZED_EQUITY_NAME_MARKER)
}
