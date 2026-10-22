import type { PortfolioCandidate } from '@/trading/features/portfolio/folds/candidate'
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

const NO_CANDIDATES_CODE: CaveatCode = 'portfolio.segment-no-candidates'
const SHARED_CAP_CODE: CaveatCode = 'portfolio.shared-cap-full'
/** A segment short of its target because the operator has named too few instruments for it. Both
 *  read "go and find some", which is the question this module answers with names. */
const SHORTFALL_CODES: ReadonlySet<CaveatCode> = new Set([
  NO_CANDIDATES_CODE,
  'portfolio.too-few-candidates',
  SHARED_CAP_CODE,
])
/** Enough to close a segment at the usual per-name cap, and still a line the operator can retype. */
const MAXIMUM_SUGGESTED_NAMES = 5
/** Deep enough that the names already held or watched do not crowd out every fresh one. */
const SCREEN_BOARD_LIMIT = 20

interface SegmentCandidateDeps {
  readonly markets: MarketRegistry
}

export interface SegmentCandidateOptions {
  readonly caveats: readonly Caveat[]
  /** Everything the plan already weighed, so a name it holds is never offered as new. */
  readonly considered: readonly InstrumentRef[]
  /** The names the plan sized, whose sectors a full sector cap closes to every name offered. */
  readonly weighed: readonly Pick<PortfolioCandidate, 'segment' | 'sector'>[]
  readonly asOf: TradingDay
  readonly now: number
  readonly signal: AbortSignal
}

/** The plan sizes what the operator chose, so a segment with too few chosen names resolves to cash
 *  and says so. The shortfall caveats state that gap and nothing else, because the way out of it
 *  belongs to the market: these carry the top of its ranked board where it has one and the manual
 *  route where it has none. Either way the operator still adds each name. */
export async function withSegmentCandidateCaveats(
  deps: SegmentCandidateDeps,
  options: SegmentCandidateOptions
): Promise<readonly Caveat[]> {
  const segments = shortfallSegments(options.caveats)

  if (segments.length === 0) {
    return options.caveats
  }

  const known = new Set(options.considered.map(buildInstrumentKey))
  const found = await Promise.all(
    segments.map((segment) => {
      const sharedCap = options.caveats.find(
        (caveat) => caveat.code === SHARED_CAP_CODE && caveat.detail?.segment === segment
      )

      return segmentNames(deps, {
        segment,
        known,
        ...(sharedCap === undefined ? {} : { closedSectors: closedSectorsOf(sharedCap, options) }),
        options,
      })
    })
  )
  const suggested = found.filter((caveat): caveat is Caveat => caveat !== null)

  if (suggested.length === 0) {
    return options.caveats
  }

  // A segment's names line already says it has nothing to buy, so it stands in for the bare one.
  const named = new Set(suggested.map((caveat) => caveat.detail?.segment))
  const kept = options.caveats.filter(
    (caveat) => caveat.code !== NO_CANDIDATES_CODE || !named.has(caveat.detail?.segment)
  )

  return [...kept, ...suggested]
}

function shortfallSegments(caveats: readonly Caveat[]): readonly PortfolioSegment[] {
  const segments = caveats
    .filter((caveat) => SHORTFALL_CODES.has(caveat.code))
    .map((caveat) => caveat.detail?.segment)
    .filter((segment): segment is PortfolioSegment => typeof segment === 'string')

  return [...new Set(segments)]
}

/** Where a sector cap is what left the segment short, a name from a sector the plan already sized
 *  would meet the same cap, so only names outside those sectors are worth offering. An ETF cap
 *  closes no sector: the board offered is the segment's default kind, never a fund. */
function closedSectorsOf(sharedCap: Caveat, options: SegmentCandidateOptions): ReadonlySet<string> {
  if (sharedCap.detail?.limit !== 'sector') {
    return new Set()
  }

  return new Set(
    options.weighed
      .filter((candidate) => candidate.segment === sharedCap.detail?.segment)
      .map((candidate) => candidate.sector)
      .filter((sector): sector is string => sector !== undefined)
  )
}

interface SegmentNamesInput {
  readonly segment: PortfolioSegment
  readonly known: ReadonlySet<string>
  /** Present where a shared cap, not a short list, left the segment short: the names offered are
   *  then the ones that cap does not reach. */
  readonly closedSectors?: ReadonlySet<string>
  readonly options: SegmentCandidateOptions
}

/** Names where the board can offer them, and the manual route where it cannot. `null` for a
 *  segment no registered market owns, where neither route leads anywhere, and for a shared cap the
 *  board has nothing outside of: the cap's own line already says what fills the segment. */
async function segmentNames(
  deps: SegmentCandidateDeps,
  input: SegmentNamesInput
): Promise<Caveat | null> {
  const market = deps.markets.list().find((entry) => entry.manifest.segment === input.segment)

  if (market === undefined) {
    return null
  }

  const names = await freshNames(market, input)
  const sharedCap = input.closedSectors !== undefined

  if (names.length === 0) {
    return sharedCap
      ? null
      : { code: 'portfolio.candidates-by-name', detail: { segment: input.segment } }
  }

  const detail = { segment: input.segment, names: names.join(CAVEAT_SUBJECT_SEPARATOR) }

  return sharedCap
    ? { code: 'portfolio.candidates-outside-cap', detail }
    : { code: 'portfolio.candidates-available', detail }
}

/** The top of the market's own board, less everything the plan already weighed. Empty for a market
 *  with no screen — domestic gold ranks nothing against anything — and for a board that failed or
 *  held only names the plan has seen. */
async function freshNames(market: Market, input: SegmentNamesInput): Promise<readonly Ticker[]> {
  const screen = market.capabilities.screen

  if (screen === undefined) {
    return []
  }

  const board = await screenBoard(screen, market, input.options)

  return (board?.candidates ?? [])
    .filter(
      (candidate) =>
        !input.known.has(buildInstrumentKey(candidate.instrument)) &&
        (candidate.sector === undefined || !input.closedSectors?.has(candidate.sector))
    )
    .slice(0, MAXIMUM_SUGGESTED_NAMES)
    .map((candidate) => candidate.instrument.ticker)
}

/** Advice is never withheld over a board that failed to build: the shortfall caveat still states
 *  the gap, and a plan the operator can act on beats an error about the names that might close it.
 *  An abort is shutdown rather than a failure, so it propagates. */
async function screenBoard(
  screen: NonNullable<Market['capabilities']['screen']>,
  market: Market,
  options: SegmentCandidateOptions
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
