import type { Caveat, CaveatCode } from '@/trading/kernel/caveat'
import type {
  InstrumentRef,
  PortfolioSegment,
  Ticker,
  TradingDay,
} from '@/trading/kernel/instrument'
import type { ScreenResult } from '@/trading/kernel/market/market-capability'
import type { Market, MarketRegistry } from '@/trading/markets/types'
import { isAbortError } from '@/core/errors'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { CAVEAT_SUBJECT_SEPARATOR } from '@/trading/render/format'

/** A sleeve short of its target because the operator has named too few instruments for it. Both
 *  read "go and find some", which is the question this module answers with names. */
const SHORTFALL_CODES: ReadonlySet<CaveatCode> = new Set([
  'portfolio.segment-no-candidates',
  'portfolio.too-few-candidates',
])
/** Enough to close a sleeve at the usual per-name cap, and still a line the operator can retype. */
const MAXIMUM_SUGGESTED_NAMES = 5
/** Deep enough that the names already held or watched do not crowd out every fresh one. */
const SCREEN_BOARD_LIMIT = 20

interface SleeveCandidateDeps {
  readonly markets: MarketRegistry
}

export interface SleeveCandidateOptions {
  readonly caveats: readonly Caveat[]
  /** Everything the plan already weighed, so a name it holds is never offered as new. */
  readonly considered: readonly InstrumentRef[]
  readonly asOf: TradingDay
  readonly now: number
  readonly signal: AbortSignal
}

/** The plan sizes what the operator chose, so a sleeve with too few chosen names resolves to cash
 *  and says so. The shortfall caveats state that gap and nothing else, because the way out of it
 *  belongs to the market: these carry the top of its ranked board where it has one and the manual
 *  route where it has none. Either way the operator still adds each name. */
export async function sleeveCandidateCaveats(
  deps: SleeveCandidateDeps,
  options: SleeveCandidateOptions
): Promise<readonly Caveat[]> {
  const segments = shortfallSegments(options.caveats)

  if (segments.length === 0) {
    return []
  }

  const known = new Set(options.considered.map(buildInstrumentKey))
  const found = await Promise.all(
    segments.map((segment) => sleeveNames(deps, { segment, known, options }))
  )

  return found.filter((caveat): caveat is Caveat => caveat !== null)
}

function shortfallSegments(caveats: readonly Caveat[]): readonly PortfolioSegment[] {
  const segments = caveats
    .filter((caveat) => SHORTFALL_CODES.has(caveat.code))
    .map((caveat) => caveat.detail?.segment)
    .filter((segment): segment is PortfolioSegment => typeof segment === 'string')

  return [...new Set(segments)]
}

interface SleeveNamesInput {
  readonly segment: PortfolioSegment
  readonly known: ReadonlySet<string>
  readonly options: SleeveCandidateOptions
}

/** Names where the board can offer them, and the manual route where it cannot. `null` only for a
 *  segment no registered market owns, where neither route leads anywhere. */
async function sleeveNames(
  deps: SleeveCandidateDeps,
  input: SleeveNamesInput
): Promise<Caveat | null> {
  const market = deps.markets.list().find((entry) => entry.manifest.segment === input.segment)

  if (market === undefined) {
    return null
  }

  const names = await freshNames(market, input)

  return names.length === 0
    ? { code: 'portfolio.candidates-by-name', detail: { segment: input.segment } }
    : {
        code: 'portfolio.candidates-available',
        detail: { segment: input.segment, names: names.join(CAVEAT_SUBJECT_SEPARATOR) },
      }
}

/** The top of the market's own board, less everything the plan already weighed. Empty for a market
 *  with no screen — domestic gold ranks nothing against anything — and for a board that failed or
 *  held only names the plan has seen. */
async function freshNames(market: Market, input: SleeveNamesInput): Promise<readonly Ticker[]> {
  const screen = market.capabilities.screen

  if (screen === undefined) {
    return []
  }

  const board = await screenBoard(screen, market, input.options)

  return (board?.candidates ?? [])
    .map((candidate) => candidate.instrument)
    .filter((instrument) => !input.known.has(buildInstrumentKey(instrument)))
    .slice(0, MAXIMUM_SUGGESTED_NAMES)
    .map((instrument) => instrument.ticker)
}

/** Advice is never withheld over a board that failed to build: the shortfall caveat still states
 *  the gap, and a plan the operator can act on beats an error about the names that might close it.
 *  An abort is shutdown rather than a failure, so it propagates. */
async function screenBoard(
  screen: NonNullable<Market['capabilities']['screen']>,
  market: Market,
  options: SleeveCandidateOptions
): Promise<ScreenResult | null> {
  try {
    return await screen.run({
      market: market.manifest.id,
      limit: SCREEN_BOARD_LIMIT,
      asOf: options.asOf,
      now: options.now,
      signal: options.signal,
    })
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    return null
  }
}
