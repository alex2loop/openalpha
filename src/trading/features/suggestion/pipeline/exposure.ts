import type { SuggestionPortfolioContext } from '@/trading/features/suggestion/pipeline/types'
import type { StoredSuggestion, SuggestionRunResult } from '@/trading/features/suggestion/types'
import type { PortfolioSegment } from '@/trading/kernel/instrument'
import type { CapBreach } from '@/trading/kernel/operator/exposure'
import type { MarketRegistry } from '@/trading/markets/types'
import { tradedWeightPctNav } from '@/trading/features/suggestion/pipeline/concentration'
import { ETF_KIND } from '@/trading/kernel/instrument'
import { etfBreaches, isBreached } from '@/trading/kernel/operator/exposure'

/** One buy against a ceiling is the sizer's own answer, and repeating it here would second-guess
 *  it. A cap is only reported once two of the batch's buys land under it, which is the fact no
 *  individual row can carry. */
const MINIMUM_BUYS = 2

interface BatchExposureInput {
  readonly results: readonly SuggestionRunResult[]
  readonly markets: MarketRegistry
  /** Asked for only once the set has two sized buys. The shared reader memoises by the batch's one
   *  clock read, so this costs nothing when any item already read the book, and a batch every name
   *  of which was gated never pays for it. */
  readContext(): Promise<SuggestionPortfolioContext>
}

/** A completed row the run sized, buy or reduce. A reused row counts — today's, or a buy still
 *  standing, either one the operator may act on today — and a cooldown row does not. */
type SizedCall = StoredSuggestion & {
  readonly action: 'buy' | 'reduce'
  readonly sizePctNav: number
  readonly units: number
}

interface CapKey<K> {
  readonly key: K
}

interface Capped<K> extends CapKey<K> {
  readonly heldPctNav: number
  readonly capPctNav: number
}

/** A capped weight with what the set's calls add to it. */
type Netted<S> = S & {
  netPctNav: number
  buys: number
}

/** Where one call lands: the cap and what the book already holds under it, or nothing when the row
 *  names no cap of this kind. */
type CappedOf<S extends CapKey<unknown>> = (call: SizedCall) => S | undefined

/** Every item in a batch sizes against the same pre-batch book, so each row's own concentration
 *  note is right about that row and silent about the set. This is the only reader of the set: buys
 *  add, reduces take away, and a cap is named when what is left crosses its ceiling. */
export async function breachedCaps(input: BatchExposureInput): Promise<readonly CapBreach[]> {
  const calls = input.results.flatMap((result) =>
    result.kind === 'completed' && isSizedCall(result.suggestion) ? [result.suggestion] : []
  )

  if (calls.filter((call) => call.action === 'buy').length < MINIMUM_BUYS) {
    return []
  }

  const context = await input.readContext()

  return [
    ...breachedBy(calls, sectorOf(context)).map(
      (capped): CapBreach => ({ kind: 'sector', sector: capped.key, ...combinedOf(capped) })
    ),
    ...breachedBy(calls, segmentOf(context, input.markets)).map(
      (capped): CapBreach => ({ kind: 'segment', segment: capped.key, ...combinedOf(capped) })
    ),
    ...etfBreachedBy(calls, context, input.markets),
  ]
}

function isSizedCall(suggestion: StoredSuggestion): suggestion is SizedCall {
  return (
    suggestion.action !== 'hold' &&
    suggestion.sizePctNav !== undefined &&
    suggestion.units !== undefined
  )
}

/** The sector the row's own note names, weighed against what the book holds there — the same two
 *  reads `concentrationOf` makes, so the set and each row are measured by one rule. */
function sectorOf(context: SuggestionPortfolioContext): CappedOf<Capped<string>> {
  return (call) => {
    const sector = call.concentration?.sector

    if (sector === undefined) {
      return undefined
    }

    return {
      key: sector,
      heldPctNav:
        context.book.sectorValues.find((value) => value.sector === sector)?.weightPctNav ?? 0,
      capPctNav: context.profile.maximumSectorPctNav,
    }
  }
}

function segmentOf(
  context: SuggestionPortfolioContext,
  markets: MarketRegistry
): CappedOf<Capped<PortfolioSegment>> {
  return (call) => {
    const segment = markets.find(call.instrument.market)?.manifest.segment

    if (segment === undefined) {
      return undefined
    }

    return {
      key: segment,
      heldPctNav:
        context.book.segmentValues.find((value) => value.segment === segment)?.weightPctNav ?? 0,
      capPctNav: context.profile.caps[segment]?.maximumSegmentPctNav ?? 0,
    }
  }
}

/** The same segment as `segmentOf`, measured over its ETF share alone, by the reading a single order
 *  makes of it. */
function etfBreachedBy(
  calls: readonly SizedCall[],
  context: SuggestionPortfolioContext,
  markets: MarketRegistry
): readonly CapBreach[] {
  return nettedCaps(calls, etfSegmentOf(markets)).flatMap((capped) =>
    etfBreaches({
      segment: capped.key,
      segmentValue: context.book.segmentValues.find((value) => value.segment === capped.key),
      addedPctNav: capped.netPctNav,
      ceilingPctNav: context.profile.caps[capped.key]?.maximumEtfPctNav,
    })
  )
}

/** The segment a row's ETF share is measured in: only an ETF adds to it, so a row of any other kind
 *  names no segment here and one whose kind never resolved names none either. */
function etfSegmentOf(markets: MarketRegistry): CappedOf<CapKey<PortfolioSegment>> {
  return (call) => {
    const segment =
      call.instrumentKind === ETF_KIND
        ? markets.find(call.instrument.market)?.manifest.segment
        : undefined

    return segment === undefined ? undefined : { key: segment }
  }
}

function breachedBy<K>(
  calls: readonly SizedCall[],
  cappedOf: CappedOf<Capped<K>>
): readonly Netted<Capped<K>>[] {
  return nettedCaps(calls, cappedOf).filter((capped) =>
    isBreached(capped.heldPctNav + capped.netPctNav, capped.capPctNav)
  )
}

/** Every cap two or more of the set's buys land under, with the net the set adds to it. */
function nettedCaps<S extends CapKey<unknown>>(
  calls: readonly SizedCall[],
  cappedOf: CappedOf<S>
): readonly Netted<S>[] {
  const byKey = new Map<S['key'], Netted<S>>()

  for (const call of calls) {
    const found = cappedOf(call)

    if (found === undefined) {
      continue
    }

    const capped = byKey.get(found.key) ?? { ...found, netPctNav: 0, buys: 0 }

    const tradedPctNav = tradedWeightPctNav({
      held: call.held,
      units: call.units,
      sizePctNav: call.sizePctNav,
    })

    capped.netPctNav += call.action === 'reduce' ? -tradedPctNav : tradedPctNav
    capped.buys += call.action === 'buy' ? 1 : 0
    byKey.set(found.key, capped)
  }

  return [...byKey.values()].filter((capped) => capped.buys >= MINIMUM_BUYS)
}

function combinedOf<K>(capped: Netted<Capped<K>>): {
  readonly combinedPctNav: number
  readonly capPctNav: number
} {
  return { combinedPctNav: capped.heldPctNav + capped.netPctNav, capPctNav: capped.capPctNav }
}
