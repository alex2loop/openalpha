import type { Caveat } from '@/trading/kernel/caveat'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { MacroSeriesId } from '@/trading/kernel/market/macro-series'
import type { RegionRequest } from '@/trading/kernel/market/market-capability'
import type {
  FxQuote,
  MacroSnapshot,
  MarketRegime,
  NewsItem,
} from '@/trading/kernel/market/market-data'
import type { MacroRiskView } from '@/trading/kernel/market/market-macro'
import type { SourceId } from '@/trading/kernel/source/source-id'
import type { SourceProvenance, SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import type { CrossSection } from '@/trading/markets/equity-vn/factors/factors'
import type { TradingCalendar } from '@/trading/markets/types'
import { dedupeCaveats } from '@/trading/kernel/caveat'
import {
  available,
  dedupeProvenance,
  provenanceOf,
  unavailable,
} from '@/trading/kernel/source/source-result'
import { reportedCaveats } from '@/trading/markets/equity-vn/caveats'
import {
  deriveVnMacroRisk,
  foreignFlowStress,
  fxStress,
  marginStress,
  policyBias,
  tapeDriverValues,
} from '@/trading/markets/equity-vn/evidence/macro'
import {
  marketForeignFlowRatio,
  marketParticipationAboveTrend,
  sessionShares,
} from '@/trading/markets/equity-vn/factors/market-aggregates'
import {
  FX_STRESS_SCAN_SESSIONS,
  FX_STRESS_SESSIONS,
  HOSE_SHARE_TICK,
  POLICY_NEWS_ITEMS,
  VN_FX_PAIR,
  VN_FX_SERIES,
  VN_GLOBAL_MACRO_REGION,
  VN_MACRO_FORMULA_VERSION,
  VN_MARKET_REF,
  VN_MARKET_REGION,
} from '@/trading/markets/equity-vn/policy'
import { resolveBandReference, resolveTradeability } from '@/trading/markets/equity-vn/tradeability'
import { tickSizeFor } from '@/trading/markets/levels'
import { mergeMacroValues } from '@/trading/markets/macro'

/** The denominator guard for a name whose reference equals its floor. */
const SMALLEST_TICK = tickSizeFor(0, HOSE_SHARE_TICK)
/** A stored read older than this says nothing about today: the daemon was off, not the market calm. */
const REGIME_MEMORY_SESSIONS = 5
/** Refresh persists the values, the capability returns only the view, and neither re-runs the four
 *  reads the other already made. */
export interface VnMacroEvaluation {
  readonly values: Readonly<Partial<Record<MacroSeriesId, number>>>
  readonly view: MacroRiskView
}

export interface VnMacroCrossSection {
  get(asOf: TradingDay, signal: AbortSignal): Promise<CrossSection>
}

interface ResolveVnMacroRiskOptions {
  readonly deps: MarketDeps
  readonly crossSection: VnMacroCrossSection
  /** The market's own, so the FX window is counted in its sessions rather than in calendar days. */
  readonly calendar: TradingCalendar
  readonly request: RegionRequest
}

interface MacroReads {
  readonly local: SourceResult<MacroSnapshot>
  /** Complementary providers of one region's series set, in route order. */
  readonly global: readonly SourceResult<MacroSnapshot>[]
  readonly news: SourceResult<readonly NewsItem[]>
  readonly fx: SourceResult<FxQuote>
}

/** The one VN macro path. Local (VNDirect deposit rate) and global (FRED real-rate and US-yield)
 *  series are the two required subjects; a lost policy-news read is still reported through a caveat
 *  rather than silently reading as calm. */
export async function resolveVnMacroRisk(
  options: ResolveVnMacroRiskOptions
): Promise<SourceResult<VnMacroEvaluation>> {
  const { deps, request } = options
  const [local, global, news, fx, trailing, cross, previousScoreRegime] = await Promise.all([
    deps.sources.resolve({
      kind: 'macro',
      context: { market: VN_MARKET_REF, region: VN_MARKET_REGION },
      signal: request.signal,
    }),
    deps.macro.get(VN_GLOBAL_MACRO_REGION, request.asOf, request.signal),
    deps.sources.resolve({
      kind: 'news',
      context: {
        market: VN_MARKET_REF,
        region: VN_MARKET_REGION,
        limit: POLICY_NEWS_ITEMS,
      },
      signal: request.signal,
    }),
    deps.fx.convert({ ...VN_FX_PAIR, asOf: request.asOf, signal: request.signal }),
    resolveTrailingFxRate(options),
    options.crossSection.get(request.asOf, request.signal),
    resolvePreviousScoreRegime(options),
  ])
  const reads: MacroReads = { local, global, news, fx }
  const caveats = readCaveats(reads)
  const globalValues = mergeMacroValues(global)
  const readSubjects = [local.kind === 'available', Object.keys(globalValues.values).length > 0]

  if (!readSubjects.some(Boolean)) {
    return unavailable('failed', attemptedSourceIds(reads), caveats)
  }

  const evaluation = buildEvaluation({
    reads,
    globalValues,
    cross,
    news,
    trailingFxRate: trailing,
    asOf: request.asOf,
    previousScoreRegime,
  })
  return available(evaluation, readProvenance(reads), caveats)
}

async function resolvePreviousScoreRegime(
  options: ResolveVnMacroRiskOptions
): Promise<MarketRegime | undefined> {
  const { calendar, request } = options
  const previous = await options.deps.marketDataStore.findMacroRiskBefore({
    region: VN_MARKET_REGION,
    formulaVersion: VN_MACRO_FORMULA_VERSION,
    beforeDay: request.asOf,
    signal: request.signal,
  })
  const oldest = calendar.addTradingDays(request.asOf, -REGIME_MEMORY_SESSIONS)

  return previous !== null && previous.asOf >= oldest ? previous.scoreRegime : undefined
}

/** The rate as it stood one window ago, read off the series the refresh fetches. Dated rather than
 *  counted back through rows: the window is a span of sessions, and counting rows would compare
 *  against whatever point happened to sit twenty places down. The scan window behind it covers a
 *  far end the FX tape did not print, and `listSeriesPoints` answers oldest first. */
async function resolveTrailingFxRate(
  options: ResolveVnMacroRiskOptions
): Promise<number | undefined> {
  const { calendar, request } = options
  const toDay = calendar.addTradingDays(request.asOf, -FX_STRESS_SESSIONS)
  const points = await options.deps.marketDataStore.listSeriesPoints({
    seriesId: VN_FX_SERIES,
    fromDay: calendar.addTradingDays(toDay, -FX_STRESS_SCAN_SESSIONS),
    toDay,
    signal: request.signal,
  })

  return points.at(-1)?.value
}

interface BuildEvaluationInput {
  readonly reads: MacroReads
  readonly globalValues: ReturnType<typeof mergeMacroValues>
  readonly cross: CrossSection
  readonly news: SourceResult<readonly NewsItem[]>
  readonly trailingFxRate: number | undefined
  readonly asOf: TradingDay
  readonly previousScoreRegime: MarketRegime | undefined
}

/** The VN-owned local series wins if the two scopes ever publish the same id, and its observation
 *  dates are kept too — the brief carries the per-driver stamp even though only one of the scopes
 *  answered. */
function buildEvaluation(input: BuildEvaluationInput): {
  readonly values: Readonly<Partial<Record<MacroSeriesId, number>>>
  readonly view: MacroRiskView
} {
  const { reads, globalValues, cross, news, trailingFxRate, asOf } = input
  const local = reads.local
  const fxRate = reads.fx.kind === 'available' ? reads.fx.value.rate : undefined

  const values = {
    ...globalValues.values,
    ...(local.kind === 'available' ? local.value.values : {}),
    ...(fxRate === undefined ? {} : { [VN_FX_SERIES]: fxRate }),
    ...tapeDriverValues({
      indexCloses: cross.indexBars.map((candle) => candle.close),
      participationAboveTrend: marketParticipationAboveTrend(cross),
    }),
  }
  const observationDates = local.kind === 'available' ? local.value.observationDates : {}

  const view = deriveVnMacroRisk({
    base: {
      values,
      observationDates: { ...globalValues.observationDates, ...observationDates },
      region: VN_MARKET_REGION,
      asOf,
      provenance: readProvenance(reads),
      ...(input.previousScoreRegime === undefined
        ? {}
        : { previousScoreRegime: input.previousScoreRegime }),
    },
    confirmers: [
      marginStress(bandInputs(cross), SMALLEST_TICK),
      foreignFlowStress(marketForeignFlowRatio(cross)),
      fxStress({ current: fxRate, trailing: trailingFxRate }),
    ],
    bias: news.kind === 'available' ? policyBias(news.value) : 'neutral',
  })

  return { values, view }
}

/** Both callers read through the same resolver, so a brief and a live macro call cannot
 *  disagree. */
export async function runMacroRisk(
  options: ResolveVnMacroRiskOptions
): Promise<SourceResult<MacroRiskView>> {
  const result = await resolveVnMacroRisk(options)

  return result.kind === 'unavailable'
    ? result
    : available(result.value.view, result.provenance, result.caveats)
}

function readCaveats(reads: MacroReads): readonly Caveat[] {
  return dedupeCaveats([
    ...readCaveatsOf(reads.local),
    ...globalCaveats(reads.global),
    ...readCaveatsOf(reads.news),
    ...readCaveatsOf(reads.fx),
  ])
}

/** Merged providers report one absence for the whole scope: the substitution belongs to a route
 *  where nothing answered, never to one where a provider answered without serving every series.
 *
 *  A provider that missed while another answered is not reported at all, the same way failover
 *  stays quiet about a primary it passed over. What the merge ended up without is the composite's
 *  coverage check to state, in the name of the driver that is absent rather than the vendor that
 *  refused — a reader cannot act on either, but only one of them is the fact. */
function globalCaveats(reads: readonly SourceResult<MacroSnapshot>[]): readonly Caveat[] {
  const served = reads.filter((read) => read.kind === 'available')

  return served.length > 0
    ? served.flatMap((read) => read.caveats)
    : reportedCaveats(
        reads.flatMap((read) => read.caveats),
        'macro'
      )
}

function readCaveatsOf(result: SourceResult<unknown>): readonly Caveat[] {
  return result.kind === 'available' ? result.caveats : reportedCaveats(result.caveats, 'macro')
}

function readProvenance(reads: MacroReads): readonly SourceProvenance[] {
  return dedupeProvenance([
    ...provenanceOf(reads.local),
    ...reads.global.flatMap(provenanceOf),
    ...provenanceOf(reads.news),
    ...provenanceOf(reads.fx),
  ])
}

function attemptedSourceIds(reads: MacroReads): readonly SourceId[] {
  const ids = [reads.local, ...reads.global].flatMap((read) =>
    read.kind === 'unavailable' ? read.attemptedSourceIds : []
  )

  return [...new Set(ids)]
}

/** Each name's newest session against the band it traded in: the close before it is that session's
 *  reference. Read off the run's own day instead, a weekend or pre-open run takes the newest close
 *  as the reference and every name reads as sitting at the top of its band. */
function bandInputs(
  cross: CrossSection
): readonly { readonly last: number; readonly reference: number; readonly floor: number }[] {
  const rows: { readonly last: number; readonly reference: number; readonly floor: number }[] = []

  for (const name of sessionShares(cross)) {
    const candles = name.bars.map((bar) => bar.candle)
    const newest = candles.at(-1)
    const reference = newest === undefined ? undefined : resolveBandReference(candles, newest.at)

    if (newest === undefined || reference === undefined) {
      continue
    }

    rows.push({
      last: newest.close,
      reference,
      floor: resolveTradeability({ record: name.record, reference, asOf: newest.at }).dailyBand
        .floor,
    })
  }

  return rows
}
