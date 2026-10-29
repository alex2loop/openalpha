import type { DraftInput } from '@/trading/features/suggestion/pipeline/draft'
import type { PricedLevels } from '@/trading/features/suggestion/pipeline/levels'
import type {
  DraftDirection,
  SuggestionPortfolioContext,
} from '@/trading/features/suggestion/pipeline/types'
import type { SuggestionRequest } from '@/trading/features/suggestion/types'
import type { Caveat, CaveatCode } from '@/trading/kernel/caveat'
import type { ConvictionBand } from '@/trading/kernel/conviction'
import type { FactorScore, LevelResult } from '@/trading/kernel/factor'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { MarketEvent } from '@/trading/kernel/market/market-event'
import type { InvestmentHorizon } from '@/trading/kernel/operator/profile'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketResolution } from '@/trading/markets/types'
import { heldPositionOf } from '@/trading/features/suggestion/pipeline/concentration'
import { outcomeWindowSessions } from '@/trading/features/suggestion/pipeline/outcome-window'
import { lowerBand } from '@/trading/kernel/conviction'
import { factorComposite } from '@/trading/kernel/factor'
import { isEventSubject, isTradingEnd } from '@/trading/kernel/market/market-event'
import { toProfileStamp } from '@/trading/kernel/operator/profile'
import { regimeFor } from '@/trading/markets/macro-risk'

// What the scorer files when a read speaks for less than the whole model, or for too few factors to
// call consensus. Either one lowers the band.
const WEAK_FACTOR_CODES: ReadonlySet<CaveatCode> = new Set([
  'factor.coverage-below-minimum',
  'factor.agreement-below-minimum',
])
// The share of a segment's intended buying its macro read allows. Sized into a buy and nothing else.
const DEPLOYMENT_CEILING_CAVEAT: CaveatCode = 'portfolio.regime-risk'
const CHASING_GAP_CAVEAT: CaveatCode = 'suggestion.chasing-gap'

// Everything the draft is assembled from before the debate runs: the corporate calendar this name
// carries, the qualifications every read attached, and the conviction the factor score earns.

interface DraftPlanInput {
  readonly request: SuggestionRequest
  readonly resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>
  readonly asOf: TradingDay
  readonly direction: DraftDirection
  readonly factors: FactorScore
  readonly context: SuggestionPortfolioContext
  readonly horizon: InvestmentHorizon
  readonly priced: PricedLevels
  readonly events: readonly MarketEvent[]
  /** The margin-list row in force on `asOf`, when the calendar carried one. */
  readonly standingMargin?: MarketEvent
}

export function draftInputFor(input: DraftPlanInput): DraftInput {
  const { resolution, priced, factors, asOf, events } = input
  const levelResult = priced.result
  const levels = levelResult.kind === 'available' ? levelResult.levels : undefined

  return {
    asOf,
    request: input.request,
    profile: toProfileStamp({ profile: input.context.profile, saved: input.context.profileSaved }),
    takeProfitTranchePct: input.context.profile.takeProfitTranchePct,
    horizon: input.horizon,
    factors: factors.results,
    composite: factorComposite(factors),
    ...(resolution.indexTier === undefined ? {} : { indexTier: resolution.indexTier }),
    ...(resolution.instrumentKind === undefined
      ? {}
      : { instrumentKind: resolution.instrumentKind }),
    ...heldFields(input),
    manifest: resolution.market.manifest,
    instrument: resolution.instrument,
    direction: input.direction,
    conviction: convictionOf(factors),
    caveats: draftCaveats({
      asOf,
      events,
      factors,
      levelResult,
      resolution,
      context: input.context,
      direction: input.direction,
      horizon: input.horizon,
      ...(input.standingMargin === undefined ? {} : { standingMargin: input.standingMargin }),
    }),
    holdReasonCodes: levelResult.kind === 'unavailable' ? [levelResult.reasonCode] : [],
    ...(levels === undefined ? {} : { levels }),
    ...(priced.quote === undefined ? {} : { quote: priced.quote }),
    ...(priced.pullback === undefined ? {} : { pullback: priced.pullback }),
    ...(priced.raisedStopFrom === undefined ? {} : { raisedStopFrom: priced.raisedStopFrom }),
    ...(priced.standingExit === undefined ? {} : { standingExit: priced.standingExit }),
    ...(priced.standingTakeProfit === undefined
      ? {}
      : { standingTakeProfit: priced.standingTakeProfit }),
    ...(priced.evidenceThrough === undefined ? {} : { evidenceThrough: priced.evidenceThrough }),
  }
}

function heldFields(input: DraftPlanInput): Pick<DraftInput, 'held'> {
  const held = heldPositionOf(input.context, input.resolution.instrument)

  return held === undefined ? {} : { held }
}

/** Only this name's own dated events, soonest first. A market-wide row without an instrument is
 *  background, not a fact about this ticker. A failed read is degradation, not a block: an optional
 *  enrichment that could not answer must not noise every suggestion with its caveats. */
export function instrumentEvents(
  events: SourceResult<readonly MarketEvent[]> | undefined,
  instrument: InstrumentRef
): readonly MarketEvent[] {
  if (events?.kind !== 'available') {
    return []
  }

  return events.value
    .filter((event) => isEventSubject(event, instrument))
    .toSorted((left, right) => left.at.localeCompare(right.at))
}

/** The rows still ahead of the run. The read reaches back for the margin row in force, and a past
 *  ex-date or listing is history the hold codes and the personas must not act on. */
export function upcomingEvents(
  events: readonly MarketEvent[],
  asOf: TradingDay
): readonly MarketEvent[] {
  return events.filter((event) => event.at >= asOf)
}

/** A corporate action inside the holding window is a caveat, not a block - the levels stay valid,
 *  the reader is told the tape will reset under them. */
function eventCaveats(events: readonly MarketEvent[], windowEnd: TradingDay): readonly Caveat[] {
  return events.flatMap((event): readonly Caveat[] => {
    if (isTradingEnd(event)) {
      return [{ code: 'market.delisting-scheduled', detail: { day: event.at } }]
    }

    if (event.kind === 'margin-ineligible') {
      return [{ code: 'market.margin-list-removal', detail: { day: event.at } }]
    }

    const isExRight =
      event.kind === 'dividend-ex-date' || event.kind === 'split' || event.kind === 'rights-issue'

    return isExRight && event.at <= windowEnd
      ? [{ code: 'market.ex-date-upcoming', detail: { day: event.at } }]
      : []
  })
}

/** A name already off the margin list: the forced selling happened when it left, and a broker
 *  will not lend against a new position in it. */
function marginCaveats(standing: MarketEvent | undefined): readonly Caveat[] {
  return standing?.kind === 'margin-ineligible'
    ? [{ code: 'market.margin-ineligible', detail: { day: standing.at } }]
    : []
}

interface DraftCaveatsInput {
  readonly context: SuggestionPortfolioContext
  readonly resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>
  readonly factors: FactorScore
  readonly levelResult: LevelResult
  readonly events: readonly MarketEvent[]
  readonly asOf: TradingDay
  readonly direction: DraftDirection
  readonly horizon: InvestmentHorizon
  readonly standingMargin?: MarketEvent
}

/** Every qualification the draft starts with, in reading order: what each read reported about its
 *  own evidence. */
function draftCaveats(input: DraftCaveatsInput): readonly Caveat[] {
  return [
    ...riskFloorCaveats(input.resolution.market.manifest.minimumRiskReward),
    ...input.resolution.caveats,
    ...input.factors.results.flatMap((factor) => factor.caveats),
    ...levelCaveats(input),
    ...regimeCaveats(input),
    // The events that matter are the ones landing before this suggestion would have resolved.
    ...eventCaveats(
      input.events,
      input.resolution.market.manifest.calendar.addTradingDays(
        input.asOf,
        outcomeWindowSessions(input.resolution.market.manifest.defaultCalendar, input.horizon)
      )
    ),
    ...marginCaveats(input.standingMargin),
  ]
}

/** A hold carries buy-framed levels for reference only, so a chase note has no order to describe. */
function levelCaveats(input: DraftCaveatsInput): readonly Caveat[] {
  const caveats = input.levelResult.caveats ?? []

  return input.direction.action === 'buy'
    ? caveats
    : caveats.filter((caveat) => caveat.code !== CHASING_GAP_CAVEAT)
}

/** What the segment's macro read reported, less its deployment ceiling on anything but a buy: only
 *  `sizeBuy` reads the regime scale, so a sale sized by `sizeReduce` was never held to it and a
 *  line saying buying is capped at 60% describes a limit that did not apply. The macro's own
 *  qualifications stay on every direction — they describe the evidence the verdict rests on. */
function regimeCaveats(input: DraftCaveatsInput): readonly Caveat[] {
  const { caveats } = regimeFor(input.context.regimes, input.resolution.market.manifest.segment)

  return input.direction.action === 'buy'
    ? caveats
    : caveats.filter((caveat) => caveat.code !== DEPLOYMENT_CEILING_CAVEAT)
}

/** A market that checks its stored levels against the live price says so on every suggestion it
 *  prices: the levels below expire on a move rather than on a clock, and the operator is the one
 *  watching for it. */
function riskFloorCaveats(minimumRiskReward: number | undefined): readonly Caveat[] {
  return minimumRiskReward === undefined
    ? []
    : [{ code: 'suggestion.levels-minimum-rr', detail: { ratio: minimumRiskReward } }]
}

/** Thin coverage or weak agreement lowers the band by one; nothing raises it. Read off the caveats
 *  the scorer already filed rather than re-derived from the defaults: the minima belong to the
 *  market's own `FactorPolicy`, and a market that retunes them must move this band with them. */
function convictionOf(factors: FactorScore): ConvictionBand {
  const weak = factors.caveats.some((caveat) => WEAK_FACTOR_CODES.has(caveat.code))

  return weak ? lowerBand(factors.band) : factors.band
}
