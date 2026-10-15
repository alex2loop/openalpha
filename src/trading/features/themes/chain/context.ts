import type { ScreenedCandidate } from '@/trading/features/market-data/types'
import type { ChainDeps, ChainRequest } from '@/trading/features/themes/chain/deps'
import type { EvidenceKind, ThemeSector } from '@/trading/features/themes/types'
import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { QuarterlyAccounts } from '@/trading/kernel/market/annual-accounts'
import type { InstrumentRecord } from '@/trading/kernel/market/market-data'
import type { ValuationPoint } from '@/trading/kernel/market/valuation'
import { assertNotAborted, ValidationError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { THEME_MARKET } from '@/trading/features/themes/types'
import { ICB_SUPERSECTORS } from '@/trading/kernel/market/market-data'
import { median } from '@/trading/markets/timeseries'

/** The whole VN board: about 110 names clear its gates on a session. Above 50 the screen also
 *  skips its live-quote pass, which this read does not need. */
const BOARD_LIMIT = 500
const ACCOUNTS_GAP: readonly EvidenceKind[] = Object.freeze(['accounts'])
const VALUATION_GAP: readonly EvidenceKind[] = Object.freeze(['valuation'])

interface GuardedRead<T> {
  readonly kind: EvidenceKind
  readonly subject?: string
  read(): Promise<T>
}

/** One ratio's sector median, over the names that published it. */
export interface RatioMedian {
  readonly median: number
  readonly average5y?: number
  readonly names: number
}

export interface SectorValuation {
  /** The session the provider published, which can be the one before the board's. */
  readonly day: TradingDay
  readonly earnings?: RatioMedian
  readonly book?: RatioMedian
}

interface MarketValuations {
  readonly day: TradingDay
  readonly points: readonly ValuationPoint[]
}

/** What the sector and company steps read once per run. */
export interface ChainContext {
  /** The session the board and the valuations describe. */
  readonly day: TradingDay
  /** Names that cleared every screen gate, ranked. */
  readonly candidates: readonly ScreenedCandidate[]
  readonly sectorOf: ReadonlyMap<Ticker, ThemeSector>
  readonly quarters: ReadonlyMap<Ticker, readonly QuarterlyAccounts[]>
  readonly sectorValuations: ReadonlyMap<ThemeSector, SectorValuation>
  readonly gaps: readonly EvidenceKind[]
}

/** One unreadable provider or store never sinks the stage: the caller reports the kind missing. */
export async function guardChainRead<T>(
  deps: Pick<ChainDeps, 'logger'>,
  request: ChainRequest,
  guarded: GuardedRead<T>
): Promise<T | undefined> {
  try {
    return await guarded.read()
  } catch (err: unknown) {
    if (request.signal.aborted) {
      throw err
    }

    deps.logger.warn('trading.theme_chain_read_failed', {
      kind: guarded.kind,
      ...(guarded.subject === undefined ? {} : { subject: guarded.subject }),
      err: formatErrForLog(err),
    })

    return undefined
  }
}

/** Undefined when the board or the sectors cannot be read: the board and the sector roll-up are
 *  one cross-section, so the stage reports `sector` missing and runs nothing. */
export async function readChainContext(
  deps: ChainDeps,
  request: ChainRequest
): Promise<ChainContext | undefined> {
  const [screen, instruments, quarters] = await Promise.all([
    guardChainRead(deps, request, {
      kind: 'sector',
      read: () =>
        deps.marketData.screen({
          market: THEME_MARKET,
          limit: BOARD_LIMIT,
          now: request.now,
          signal: request.signal,
        }),
    }),
    guardChainRead(deps, request, {
      kind: 'sector',
      read: () => deps.listInstruments(request.signal),
    }),
    guardChainRead(deps, request, {
      kind: 'accounts',
      read: () => deps.listQuarters(request.signal),
    }),
  ])

  // An empty board or instrument list is a cold or failed refresh, not a market with no names.
  if (
    screen === undefined ||
    screen.candidates.length === 0 ||
    instruments === undefined ||
    instruments.length === 0
  ) {
    return undefined
  }

  const day = screen.dataThroughDay ?? screen.asOf
  const sectorOf = toSectorMap(instruments)
  const valuations = await guardChainRead(deps, request, {
    kind: 'valuation',
    read: () => readMarketValuations(deps, { day, request }),
  })

  return {
    day,
    candidates: screen.candidates,
    sectorOf,
    quarters: quarters ?? new Map(),
    sectorValuations:
      valuations === undefined ? new Map() : toSectorValuations(valuations, sectorOf),
    gaps: [
      ...(quarters === undefined ? ACCOUNTS_GAP : []),
      ...(valuations === undefined ? VALUATION_GAP : []),
    ],
  }
}

function toSectorMap(instruments: readonly InstrumentRecord[]): ReadonlyMap<Ticker, ThemeSector> {
  return new Map(
    instruments.flatMap((record): readonly (readonly [Ticker, ThemeSector])[] => {
      const sector = ICB_SUPERSECTORS.find((key) => key === record.sector)

      return sector === undefined ? [] : [[record.instrument.ticker, sector]]
    })
  )
}

/** The board's session, or the one before when the provider has not published it yet. */
async function readMarketValuations(
  deps: ChainDeps,
  input: { readonly day: TradingDay; readonly request: ChainRequest }
): Promise<MarketValuations> {
  for (const day of [input.day, deps.previousSession(input.day)]) {
    const result = await deps.sources.resolve({
      kind: 'valuationRatios',
      context: { market: THEME_MARKET, toDay: day },
      signal: input.request.signal,
    })

    // A cancelled read answers unavailable too; it must end the stage, not read as a missing day.
    assertNotAborted(input.request.signal)

    if (result.kind === 'available') {
      return { day, points: result.value.points }
    }
  }

  throw new ValidationError(`no market-wide valuation on or before ${input.day}`)
}

function toSectorValuations(
  valuations: MarketValuations,
  sectorOf: ReadonlyMap<Ticker, ThemeSector>
): ReadonlyMap<ThemeSector, SectorValuation> {
  return new Map(
    ICB_SUPERSECTORS.flatMap((sector): readonly (readonly [ThemeSector, SectorValuation])[] => {
      const members = valuations.points.filter((point) => sectorOf.get(point.ticker) === sector)
      const earnings = toRatioMedian(
        members.flatMap((point) => point.priceToEarnings ?? []),
        members.flatMap((point) => point.averagePriceToEarnings5y ?? [])
      )
      const book = toRatioMedian(
        members.flatMap((point) => point.priceToBook ?? []),
        members.flatMap((point) => point.averagePriceToBook5y ?? [])
      )

      return earnings === undefined && book === undefined
        ? []
        : [
            [
              sector,
              {
                day: valuations.day,
                ...(earnings === undefined ? {} : { earnings }),
                ...(book === undefined ? {} : { book }),
              },
            ],
          ]
    })
  )
}

function toRatioMedian(
  values: readonly number[],
  averages: readonly number[]
): RatioMedian | undefined {
  const middle = median(values)
  const average5y = median(averages)

  return middle === undefined
    ? undefined
    : {
        median: middle,
        names: values.length,
        ...(average5y === undefined ? {} : { average5y }),
      }
}
