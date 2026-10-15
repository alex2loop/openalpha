import type {
  PeRange,
  PricePart,
  ValuationPart,
} from '@/trading/features/themes/chain/company-market'
import type { CompanyInput, HeadlinesPart } from '@/trading/features/themes/chain/company-reads'
import type { ChainDeps } from '@/trading/features/themes/chain/deps'
import type { EvidencePart } from '@/trading/features/themes/evidence/deps'
import type {
  Crowding,
  EarningsSurprise,
  EvidenceItem,
  EvidenceKind,
  PricedAt,
} from '@/trading/features/themes/types'
import type { Ticker } from '@/trading/kernel/instrument'
import { readPricePart, readValuationPart } from '@/trading/features/themes/chain/company-market'
import { readAccountsPart, readHeadlinesPart } from '@/trading/features/themes/chain/company-reads'
import { guardChainRead } from '@/trading/features/themes/chain/context'
import { toEvidenceItems } from '@/trading/features/themes/evidence/bundle'

/** Ben-David et al.: thematic names were already overvalued when attention arrived. Both high
 *  together are crowded. */
const CROWDED_EXCESS_RETURN = 0.3
const CROWDED_PE_PERCENTILE = 80

export interface CompanyFacts {
  readonly ticker: Ticker
  readonly items: readonly EvidenceItem[]
  readonly missing: readonly EvidenceKind[]
  readonly crowding: Crowding
  readonly surprise?: EarningsSurprise
  readonly peRange?: PeRange
  readonly pe?: number
  readonly close?: PricedAt
  readonly benchmark?: PricedAt
}

export async function readCompanyFacts(
  deps: ChainDeps,
  input: CompanyInput
): Promise<CompanyFacts> {
  const { request, ticker } = input
  const [accounts, valuation, price, headlines] = await Promise.all([
    guardChainRead(deps, request, {
      kind: 'accounts',
      subject: ticker,
      read: () => readAccountsPart(deps, input),
    }),
    guardChainRead(deps, request, {
      kind: 'valuation',
      subject: ticker,
      read: () => readValuationPart(deps, input),
    }),
    guardChainRead(deps, request, {
      kind: 'price',
      subject: ticker,
      read: () => readPricePart(deps, input),
    }),
    guardChainRead(deps, request, {
      kind: 'headlines',
      subject: ticker,
      read: () => readHeadlinesPart(deps, input),
    }),
  ])
  const parts: readonly EvidencePart[] = [
    accounts ?? missingPart('accounts'),
    valuation ?? missingPart('valuation'),
    price ?? missingPart('price'),
    headlines ?? missingPart('headlines'),
  ]
  const benchmark = input.benchmark?.at(-1)

  return {
    ticker,
    items: parts.flatMap(toEvidenceItems),
    missing: parts.filter((part) => part.missing).map((part) => part.kind),
    crowding: toCrowding(price, valuation, headlines),
    ...(accounts?.surprise === undefined ? {} : { surprise: accounts.surprise }),
    ...(valuation?.peRange === undefined ? {} : { peRange: valuation.peRange }),
    ...(valuation?.pe === undefined ? {} : { pe: valuation.pe }),
    ...(price?.close === undefined ? {} : { close: price.close }),
    ...(benchmark === undefined
      ? {}
      : { benchmark: { day: benchmark.at, value: benchmark.close } }),
  }
}

/** Whether the read settles crowding either way: crowded, or a signal read below its line. A high
 *  signal beside one that could not be read settles nothing. */
export function isCrowdingDecided(crowding: Crowding): boolean {
  const { excessReturn, pePercentile } = crowding

  return (
    crowding.crowded ||
    (excessReturn !== undefined && excessReturn < CROWDED_EXCESS_RETURN) ||
    (pePercentile !== undefined && pePercentile < CROWDED_PE_PERCENTILE)
  )
}

function missingPart(kind: EvidenceKind): EvidencePart {
  return { kind, drafts: [], missing: true }
}

function toCrowding(
  price: PricePart | undefined,
  valuation: ValuationPart | undefined,
  headlines: HeadlinesPart | undefined
): Crowding {
  const excessReturn = price?.excessReturn
  const pePercentile = valuation?.pePercentile
  const recentHeadlines = headlines?.recent
  const crowded =
    excessReturn !== undefined &&
    excessReturn >= CROWDED_EXCESS_RETURN &&
    pePercentile !== undefined &&
    pePercentile >= CROWDED_PE_PERCENTILE

  return {
    ...(excessReturn === undefined ? {} : { excessReturn }),
    ...(pePercentile === undefined ? {} : { pePercentile }),
    ...(recentHeadlines === undefined ? {} : { recentHeadlines }),
    crowded,
  }
}
