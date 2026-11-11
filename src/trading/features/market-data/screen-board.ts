import type { MarketDataRunDeps } from '@/trading/features/market-data/market-data-run'
import type {
  MarketDataScreenRequest,
  ScreenedCandidate,
  ScreenView,
} from '@/trading/features/market-data/types'
import type { FactorId } from '@/trading/kernel/factor'
import type { FactorMetric, FactorMetricId } from '@/trading/kernel/factor-metric'
import type { ScreenCandidate } from '@/trading/kernel/market/market-capability'
import type { Market } from '@/trading/markets/types'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { resolveInstrument } from '@/trading/features/market-data/resolve'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { rankWithin } from '@/trading/markets/factor-scoring'
import { SURFACE_LIMITS } from '@/trading/surface-limits'

const PERCENT = 100
/** One reading has nothing to be placed against, so a factor that fired for fewer names has none. */
const MINIMUM_PEERS = 2
/** The price levels a name's entry and stop are read from: a board that rates nothing and advises
 *  nothing never lists them. */
const LEVEL_METRICS: ReadonlySet<FactorMetricId> = new Set(['breakout-trigger', 'trailing-low'])

/** The kind the board is read on: the one asked, else the named ticker's own where the market
 *  screens that kind, so a fund is found on the funds' board. A name that cannot be resolved reads
 *  the market's first kind and comes back missing, as any absent name does. */
export async function resolveScreenKind(
  deps: Pick<MarketDataRunDeps, 'markets' | 'logger'>,
  market: Market,
  request: MarketDataScreenRequest
): Promise<Pick<MarketDataScreenRequest, 'instrumentKind'>> {
  const { instrumentKind, ticker, signal } = request

  if (instrumentKind !== undefined || ticker === undefined) {
    return instrumentKind === undefined ? {} : { instrumentKind }
  }

  try {
    const resolved = await resolveInstrument(deps.markets, {
      ticker,
      market: request.market,
      signal,
    })
    const own = resolved.kind === 'resolved' ? resolved.instrumentKind : undefined

    return own !== undefined && market.manifest.screenableKinds?.includes(own) === true
      ? { instrumentKind: own }
      : {}
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }

    deps.logger.warn('trading.screen_kind_unresolved', { ticker, err: formatErrForLog(error) })

    return {}
  }
}

/** Whether a name with no live quote is quoted for the screen: on a ranked board short enough to
 *  quote whole, or when it is the one name asked for. A browse board prints settled closes. */
export function isQuotedOnScreen(
  candidate: ScreenCandidate,
  request: MarketDataScreenRequest,
  boardSize: number
): boolean {
  if (request.form === 'board') {
    return false
  }

  return request.ticker === undefined
    ? boardSize <= SURFACE_LIMITS.maximumScreenCandidates
    : candidate.instrument.ticker === request.ticker
}

/** The view in the form the request asks for, kept to the one name a `ticker` asks for once the
 *  board's places are read. */
export function toRequestedView(
  view: ScreenView,
  request: Pick<MarketDataScreenRequest, 'form' | 'ticker'>
): ScreenView {
  const shaped = request.form === 'board' ? toBoardView(view) : view

  if (request.ticker === undefined) {
    return shaped
  }

  return {
    ...shaped,
    candidates: shaped.candidates.filter(({ instrument }) => instrument.ticker === request.ticker),
  }
}

/** The whole priced board as a list to browse: ticker order, which says nothing about merit, and
 *  for each factor that fired where the name's reading sits among the board's. No reading is a
 *  price level (`LEVEL_METRICS`). A name with no price
 *  is left out and counted: the board prices what it lists, and a missing price is absent, not zero.
 *  The composite stays on the candidate for the callers that rank, and no renderer of this form
 *  reads it. */
function toBoardView(view: ScreenView): ScreenView {
  const priced = view.candidates.filter((candidate) => candidate.price !== undefined)
  const percentiles = factorPercentiles(priced)

  return {
    ...view,
    form: 'board',
    candidates: priced
      .map((candidate) =>
        withPercentiles(withoutLevels(candidate), percentiles.get(keyOf(candidate)))
      )
      .toSorted((left, right) => compareTickers(left, right)),
    unpriced: view.candidates.length - priced.length,
  }
}

function withoutLevels(candidate: ScreenedCandidate): ScreenedCandidate {
  const readings = candidate.readings?.filter(isNotLevel)

  return {
    ...candidate,
    ...(readings === undefined ? {} : { readings }),
    factors: candidate.factors.map((factor) =>
      factor.metrics === undefined
        ? factor
        : { ...factor, metrics: factor.metrics.filter(isNotLevel) }
    ),
  }
}

function isNotLevel({ id }: FactorMetric): boolean {
  return !LEVEL_METRICS.has(id)
}

function withPercentiles(
  candidate: ScreenedCandidate,
  percentiles: ScreenedCandidate['percentiles']
): ScreenedCandidate {
  return percentiles === undefined ? candidate : { ...candidate, percentiles }
}

/** Per name, each fired factor's percentile among the names it fired for: a factor that abstained
 *  has no reading to place. Ties share the mean position (`rankWithin`). The score is ranked, then
 *  turned round where a higher score is a lower reading, so the percentile is always the reading's. */
function factorPercentiles(
  candidates: readonly ScreenedCandidate[]
): ReadonlyMap<string, NonNullable<ScreenedCandidate['percentiles']>> {
  const readings = new Map<FactorId, number[]>()

  for (const candidate of candidates) {
    for (const factor of firedFactors(candidate)) {
      readings.set(factor.id, [...(readings.get(factor.id) ?? []), factor.score])
    }
  }

  return new Map(
    candidates.map((candidate) => {
      const placed: Partial<Record<FactorId, number>> = {}

      for (const factor of firedFactors(candidate)) {
        const peers = readings.get(factor.id) ?? []

        if (peers.length >= MINIMUM_PEERS) {
          const share = rankWithin(peers, factor.score) * PERCENT

          placed[factor.id] = factor.opposesReading === true ? PERCENT - share : share
        }
      }

      return [keyOf(candidate), placed]
    })
  )
}

// A factor that did not fire carries no weight: it moved nothing, so it has no reading to place.
function firedFactors(candidate: ScreenedCandidate): ScreenedCandidate['factors'] {
  return candidate.factors.filter((factor) => factor.weight !== undefined)
}

function keyOf(candidate: ScreenedCandidate): string {
  return buildInstrumentKey(candidate.instrument)
}

function compareTickers(left: ScreenedCandidate, right: ScreenedCandidate): number {
  const [a, b] = [left.instrument.ticker, right.instrument.ticker]

  if (a === b) {
    return 0
  }

  return a < b ? -1 : 1
}
