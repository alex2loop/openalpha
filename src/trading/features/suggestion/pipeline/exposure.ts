import type { SuggestionPortfolioContext } from '@/trading/features/suggestion/pipeline/types'
import type { StoredSuggestion, SuggestionRunResult } from '@/trading/features/suggestion/types'
import type { PortfolioSegment } from '@/trading/kernel/instrument'
import type { SleeveBreach } from '@/trading/kernel/operator/exposure'
import type { MarketRegistry } from '@/trading/markets/types'
import { ETF_KIND } from '@/trading/kernel/instrument'
import { etfBreaches, isBreached } from '@/trading/kernel/operator/exposure'

/** One buy against a ceiling is the sizer's own answer, and repeating it here would second-guess
 *  it. A sleeve is only reported once two of the batch's buys land in it, which is the fact no
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
}

interface SleeveKey<K> {
  readonly key: K
}

interface Sleeve<K> extends SleeveKey<K> {
  readonly heldPctNav: number
  readonly capPctNav: number
}

/** A sleeve with what the set's calls add to it. */
type Netted<S> = S & {
  netPctNav: number
  buys: number
}

/** Where one call lands: the sleeve and what the book already holds there, or nothing when the row
 *  names no sleeve of this kind. */
type SleeveOf<S extends SleeveKey<unknown>> = (call: SizedCall) => S | undefined

/** Every item in a batch sizes against the same pre-batch book, so each row's own concentration
 *  note is right about that row and silent about the set. This is the only reader of the set: buys
 *  add, reduces take away, and a sleeve is named when what is left crosses its ceiling. */
export async function breachedSleeves(input: BatchExposureInput): Promise<readonly SleeveBreach[]> {
  const calls = input.results.flatMap((result) =>
    result.kind === 'completed' && isSizedCall(result.suggestion) ? [result.suggestion] : []
  )

  if (calls.filter((call) => call.action === 'buy').length < MINIMUM_BUYS) {
    return []
  }

  const context = await input.readContext()

  return [
    ...breachedBy(calls, sectorOf(context)).map(
      (sleeve): SleeveBreach => ({ kind: 'sector', sector: sleeve.key, ...combinedOf(sleeve) })
    ),
    ...breachedBy(calls, segmentOf(context, input.markets)).map(
      (sleeve): SleeveBreach => ({ kind: 'segment', segment: sleeve.key, ...combinedOf(sleeve) })
    ),
    ...etfBreachedBy(calls, context, input.markets),
  ]
}

function isSizedCall(suggestion: StoredSuggestion): suggestion is SizedCall {
  return suggestion.action !== 'hold' && suggestion.sizePctNav !== undefined
}

/** The sector the row's own note names, weighed against what the book holds there — the same two
 *  reads `concentrationOf` makes, so the set and each row are measured by one rule. */
function sectorOf(context: SuggestionPortfolioContext): SleeveOf<Sleeve<string>> {
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
): SleeveOf<Sleeve<PortfolioSegment>> {
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

/** The same sleeve as `segmentOf`, measured over its ETF share alone, by the reading a single order
 *  makes of it. */
function etfBreachedBy(
  calls: readonly SizedCall[],
  context: SuggestionPortfolioContext,
  markets: MarketRegistry
): readonly SleeveBreach[] {
  return nettedSleeves(calls, etfSegmentOf(markets)).flatMap((sleeve) =>
    etfBreaches({
      segment: sleeve.key,
      sleeve: context.book.segmentValues.find((value) => value.segment === sleeve.key),
      addedPctNav: sleeve.netPctNav,
      ceilingPctNav: context.profile.caps[sleeve.key]?.maximumEtfPctNav,
    })
  )
}

/** The sleeve a row's ETF share is measured in: only an ETF adds to it, so a row of any other kind
 *  names no sleeve here and one whose kind never resolved names none either. */
function etfSegmentOf(markets: MarketRegistry): SleeveOf<SleeveKey<PortfolioSegment>> {
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
  sleeveOf: SleeveOf<Sleeve<K>>
): readonly Netted<Sleeve<K>>[] {
  return nettedSleeves(calls, sleeveOf).filter((sleeve) =>
    isBreached(sleeve.heldPctNav + sleeve.netPctNav, sleeve.capPctNav)
  )
}

/** Every sleeve two or more of the set's buys land in, with the net the set adds to it. */
function nettedSleeves<S extends SleeveKey<unknown>>(
  calls: readonly SizedCall[],
  sleeveOf: SleeveOf<S>
): readonly Netted<S>[] {
  const sleeves = new Map<S['key'], Netted<S>>()

  for (const call of calls) {
    const found = sleeveOf(call)

    if (found === undefined) {
      continue
    }

    const sleeve = sleeves.get(found.key) ?? { ...found, netPctNav: 0, buys: 0 }

    sleeve.netPctNav += call.action === 'reduce' ? -call.sizePctNav : call.sizePctNav
    sleeve.buys += call.action === 'buy' ? 1 : 0
    sleeves.set(found.key, sleeve)
  }

  return [...sleeves.values()].filter((sleeve) => sleeve.buys >= MINIMUM_BUYS)
}

function combinedOf<K>(sleeve: Netted<Sleeve<K>>): {
  readonly combinedPctNav: number
  readonly capPctNav: number
} {
  return { combinedPctNav: sleeve.heldPctNav + sleeve.netPctNav, capPctNav: sleeve.capPctNav }
}
