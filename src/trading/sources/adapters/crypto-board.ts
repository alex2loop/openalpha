// The ranked board every crypto universe provider publishes, and the one market-cap source built
// over it. A provider contributes its request and a row mapping; the fold, the per-asset narrowing
// and the symbol claim rules are the same wherever the rows came from.
import type { MarketCapRecord } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { UniverseResolver } from '@/trading/sources/adapters/crypto-universe'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { SourceFetchOutcome, SourceRequest } from '@/trading/sources/types'
import { ValidationError } from '@/core/errors'
import { MS_PER_SECOND } from '@/core/utils/time'
import { ticker } from '@/trading/kernel/instrument'
import { sourceId as toSourceId } from '@/trading/kernel/source/source-id'
import { createUniverseResolver } from '@/trading/sources/adapters/crypto-universe'
import { createSource, mapOutcome, parsedSource } from '@/trading/sources/define'
import {
  boundedRowCount,
  dayFromEpochSeconds,
  dropInvalid,
  nonNegative,
  positive as positiveNumber,
  publishedChangePct,
  publishedWeekChangePct,
} from '@/trading/sources/rows/normalization'

/** One coin as every board publishes it, whatever the provider names its fields. `observedAt` is
 *  absent where a provider stamps nothing, and the fetch is then the observation — a continuously
 *  traded coin priced now was priced now. */
export interface BoardRow {
  readonly id: string
  readonly symbol: string
  /** The coin as its issuer names it, which is what a text search for the asset has to spell. */
  readonly name: string
  readonly rank: number | null
  readonly priceUsd: number | null
  readonly marketCapUsd: number | null
  readonly volumeUsd: number | null
  readonly changePct: number | null
  readonly change7dPct: number | null
  readonly observedAt?: number
}

/** A provider's ISO stamp as the row's observation, or nothing when it does not parse: the fold
 *  then dates the row by the fetch, which for a continuously traded coin is the honest reading. */
export function boardObservedAt(lastUpdated: string): Pick<BoardRow, 'observedAt'> {
  const observedAt = Date.parse(lastUpdated)

  return Number.isFinite(observedAt) ? { observedAt } : {}
}

export interface BoardSpec {
  readonly id: string
  readonly request: (signal: AbortSignal) => SourceRequest
  readonly parse: (raw: unknown) => readonly BoardRow[]
  /** How far down the board a symbol still names a coin, and how many rows a caller gets by
   *  default. Both are the provider's own reach, so neither can be shared. */
  readonly resolutionRankLimit: number
  readonly defaultRowCount: number
  /** Asks the provider for one named symbol, for a coin past the board's own window. */
  readonly lookup?: (symbol: string, signal: AbortSignal) => SourceRequest
}

interface CryptoBoard {
  readonly marketCap: RegisteredSource
  /** Shared with the provider's other sources so one listing serves them all. */
  readonly resolver: UniverseResolver<BoardRow>
}

export function createCryptoBoard(options: SourceAdapterOptions, spec: BoardSpec): CryptoBoard {
  const resolver = createUniverseResolver<BoardRow>(options, {
    request: spec.request,
    parse: spec.parse,
    identity: (row) => row,
    resolutionRankLimit: spec.resolutionRankLimit,
    ...(spec.lookup === undefined ? {} : { lookup: spec.lookup }),
  })

  return { marketCap: marketCapSource(options, resolver, spec), resolver }
}

function marketCapSource(
  options: SourceAdapterOptions,
  resolver: UniverseResolver<BoardRow>,
  spec: BoardSpec
): RegisteredSource {
  return createSource({
    id: toSourceId(spec.id),
    kind: 'marketCap',
    http: options.http,
    covers: () => true,
    load: (context, signal) => loadMarketCap({ resolver, spec }, context, signal),
  })
}

interface BoardDeps {
  readonly resolver: UniverseResolver<BoardRow>
  readonly spec: BoardSpec
}

function loadMarketCap(
  deps: BoardDeps,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<readonly MarketCapRecord[]>>> {
  return context.instrument === undefined
    ? loadBoard(deps, context, signal)
    : loadAsset(deps, context, signal)
}

async function loadBoard(
  deps: BoardDeps,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<readonly MarketCapRecord[]>>> {
  const outcome = await deps.resolver.universe(signal)

  if (outcome.kind === 'error') {
    return outcome
  }

  // The fold runs past the transport's parse wrapper, so its rejections are mapped here.
  return mapOutcome(outcome, (value) =>
    parsedSource(
      toRecords(deps, {
        rows: deps.resolver.uniqueRows(value.rows),
        context,
        fetchedAt: value.fetchedAt,
      })
    )
  )
}

/** A per-asset read answers that asset's row, never the head of the board: its consumer reads the
 *  first row and would otherwise score every coin off bitcoin. */
async function loadAsset(
  deps: BoardDeps,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<readonly MarketCapRecord[]>>> {
  const instrument = context.instrument

  if (instrument === undefined) {
    return { kind: 'error', code: 'source.symbol-not-found' }
  }

  const resolved = await deps.resolver.resolve(instrument.ticker, signal)

  if (resolved.kind === 'error') {
    return resolved
  }

  const held = await deps.resolver.rowById(resolved.coin.id, signal)

  if (held.kind === 'error') {
    return held
  }

  if (held.value === undefined) {
    return { kind: 'error', code: 'source.symbol-not-found' }
  }

  const { row, fetchedAt } = held.value

  return {
    kind: 'ok',
    value: parsedSource(toRecords(deps, { rows: [row], context, fetchedAt })),
    fetchedAt,
  }
}

interface BoardFold {
  readonly rows: readonly BoardRow[]
  readonly context: SourceContext
  readonly fetchedAt: number
}

function toRecords(deps: BoardDeps, fold: BoardFold): readonly MarketCapRecord[] {
  const market = fold.context.market

  if (!market) {
    throw new ValidationError(`${deps.spec.id} market cap request has no market`)
  }

  const source = toSourceId(deps.spec.id)
  const { fetchedAt } = fold

  return dropInvalid(fold.rows, (row) => {
    const observedAt = row.observedAt ?? fetchedAt

    return {
      instrument: { market, ticker: ticker(row.symbol) },
      name: row.name,
      asOf: dayFromEpochSeconds(observedAt / MS_PER_SECOND, 'UTC'),
      observedAt,
      marketCapUsd: positiveNumber(row.marketCapUsd, 'market cap'),
      totalVolumeUsd: nonNegative(row.volumeUsd, 'volume'),
      rank: positiveNumber(row.rank, 'rank'),
      priceUsd: positiveNumber(row.priceUsd, 'price'),
      ...publishedChangePct(row.changePct),
      ...publishedWeekChangePct(row.change7dPct),
      sourceId: source,
      fetchedAt,
    }
  }).slice(0, rowCount(deps.spec, fold.context.limit))
}

function rowCount(spec: BoardSpec, limit: number | undefined): number {
  return boundedRowCount(limit, {
    fallback: spec.defaultRowCount,
    maximum: spec.resolutionRankLimit,
  })
}
