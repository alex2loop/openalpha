import type { HeldPosition } from '@/trading/features/suggestion/exposure'
import type {
  DraftDirection,
  FinalizeInput,
  ResolvedDebate,
  SuggestionRunDeps,
} from '@/trading/features/suggestion/pipeline/types'
import type {
  ActionableSuggestion,
  CalculationVersion,
  HoldSuggestion,
  PullbackStat,
  StoredSuggestion,
  Suggestion,
  SuggestionDirection,
  SuggestionQuote,
  SuggestionRequest,
} from '@/trading/features/suggestion/types'
import type { Caveat, HoldReasonCode } from '@/trading/kernel/caveat'
import type { DebateMode } from '@/trading/kernel/config'
import type { ConvictionBand } from '@/trading/kernel/conviction'
import type { FactorComposite, FactorResult, TradeLevels } from '@/trading/kernel/factor'
import type { InstrumentKind, InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { InvestmentHorizon, ProfileStamp } from '@/trading/kernel/operator/profile'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'
import type { MarketManifest } from '@/trading/markets/types'
import { invalidatorsOf, probabilityOf } from '@/trading/features/suggestion/debate/types'
import { bankedShareOf, firstExitOf } from '@/trading/features/suggestion/exit-plan/first-exit'
import { levelDirectionFor, targetWeightOf } from '@/trading/features/suggestion/pipeline/direction'
import {
  priceBandOf,
  resolveSettlementNote,
  restingEntryField,
} from '@/trading/features/suggestion/pipeline/draft-order'
import { sizeDraft, sizedFields } from '@/trading/features/suggestion/pipeline/draft-sizing'
import {
  declineReasonOf,
  holdReasonsFor,
  toHold,
} from '@/trading/features/suggestion/pipeline/hold'
import { isLevelRestatement } from '@/trading/features/suggestion/pipeline/level-restatement'
import { sizeCaveats } from '@/trading/features/suggestion/pipeline/sizing'
import { BAND_RANK, lowerBand } from '@/trading/kernel/conviction'
import { strategyId } from '@/trading/kernel/instrument'
import { orderSessionOf } from '@/trading/markets/calendar'
import { formatPrice } from '@/trading/render/money'

type LevelField = 'entry' | 'stop' | 'target' | 'takeProfit' | 'riskReward'

/** What a hold and an actionable suggestion both carry once the debate has been read. */
interface FinalizeParts {
  readonly conviction: ConvictionBand
  readonly caveats: readonly Caveat[]
  readonly versions: readonly CalculationVersion[]
  readonly invalidators: readonly string[]
}

export interface DraftInput {
  readonly request: SuggestionRequest
  /** Read once by `prepare` and carried, so every arm below - hold included - names the same
   *  policy it was gated under. */
  readonly profile: ProfileStamp
  /** The profile's share banked at the take-profit, stamped on every row framed as a buy. */
  readonly takeProfitTranchePct: number
  readonly horizon: InvestmentHorizon
  readonly manifest: MarketManifest
  readonly instrument: InstrumentRef
  readonly asOf: TradingDay
  readonly direction: DraftDirection
  readonly conviction: ConvictionBand
  readonly factors: readonly FactorResult[]
  readonly composite: FactorComposite
  readonly indexTier?: string
  readonly instrumentKind?: InstrumentKind
  readonly held?: HeldPosition
  readonly levels?: TradeLevels
  readonly quote?: SuggestionQuote
  readonly pullback?: PullbackStat
  readonly raisedStopFrom?: number
  readonly standingExit?: StoredSuggestion['standingExit']
  readonly standingTakeProfit?: number
  readonly evidenceThrough?: TradingDay
  readonly caveats: readonly Caveat[]
  readonly holdReasonCodes: readonly HoldReasonCode[]
}

/** Actionable drafts carry a zero size until `finalize` computes one: sizing runs after every stage
 *  has had its say, so no stage can react to a number the risk pass might still remove. */
export function buildDraft(input: DraftInput): Suggestion {
  const base = {
    instrument: input.instrument,
    at: input.asOf,
    authoredLocale: input.request.locale,
    profile: input.profile,
    horizon: input.horizon,
    strategyId: strategyId(input.manifest.id),
    strategyVersion: input.manifest.strategyVersion,
    focusKey: input.request.focus.key,
    calculationVersions: input.manifest.calculationVersions,
    conviction: input.conviction,
    citations: [],
    composite: input.composite,
    ...(input.indexTier === undefined ? {} : { indexTier: input.indexTier }),
    ...(input.instrumentKind === undefined ? {} : { instrumentKind: input.instrumentKind }),
    ...(input.levels?.reviewOnly === undefined ? {} : { reviewOnly: input.levels.reviewOnly }),
    ...(input.held === undefined ? {} : { held: input.held }),
    provenance: provenanceOf(input.factors),
    caveats: input.caveats,
    factorScores: input.factors,
    ...(input.quote === undefined ? {} : { quote: input.quote }),
    ...(input.pullback === undefined ? {} : { pullback: input.pullback }),
    ...(input.raisedStopFrom === undefined ? {} : { raisedStopFrom: input.raisedStopFrom }),
    ...(input.standingExit === undefined ? {} : { standingExit: input.standingExit }),
    ...(input.standingTakeProfit === undefined
      ? {}
      : { standingTakeProfit: input.standingTakeProfit }),
    ...(input.evidenceThrough === undefined ? {} : { evidenceThrough: input.evidenceThrough }),
  }

  if (input.direction.action === 'hold' || input.levels === undefined) {
    return { ...base, ...holdFields(input) }
  }

  return {
    ...base,
    action: input.direction.action,
    thesis: '',
    entry: input.levels.entry,
    stop: input.levels.stop,
    target: input.levels.target,
    takeProfit: input.levels.takeProfit,
    riskReward: input.levels.riskReward,
    ...trancheField(input, input.direction.action),
    ...(input.direction.action === 'reduce'
      ? { reduceReasonCode: input.direction.reasonCode }
      : {}),
  }
}

/** Maps an invalid or blocking model result to hold with no levels and no size, applies the one
 *  deterministic sizing formula, and rejects any conviction raise. Actionable output requires a
 *  validated non-empty thesis; nothing here invents prose. */
export function finalize(input: FinalizeInput): Suggestion {
  const { draft, debate } = input
  const parts: FinalizeParts = {
    conviction: riskAdjustedConviction(draft.conviction, debate),
    caveats: [...draft.caveats, ...debate.caveats],
    versions: calculationVersionsFor(draft.calculationVersions, input.deps, debate.result.mode),
    invalidators: checkedInvalidators(input, invalidatorsOf(debate.result)),
  }
  const decline = declineReasonOf(
    debate.result,
    plannedFirstExitRiskReward(
      input.levels,
      bankedShareOf(draft, input.trailsStop),
      input.deps.roundTripFeeFraction(input.manifest.id)
    ),
    input.direction.action === 'buy' && input.direction.coreFill === true
  )
  // An actionable draft holding on nothing but an empty thesis has no other reason on record: the
  // debate ran and produced no prose, which is `debate-unresolved`, not a silent unexplained hold.
  const undecided = draft.action !== 'hold' && decline === undefined && debate.thesis.length === 0

  if (draft.action === 'hold' || decline !== undefined || undecided) {
    return toHold({
      draft,
      debate,
      ...parts,
      holdReasonCodes: holdReasonsFor(draft, undecided ? 'debate-unresolved' : decline),
    })
  }

  return toActionable(input, draft, parts)
}

/** The ratio the plan was designed to pay at its first exit, net of the round trip: over the
 *  entry-relative risk, before a trail or a ratchet moved the stop closer, because the probability
 *  an expectancy floor weighs does not move when the stop does. At the first exit rather than the
 *  far target, because that is where most entries bank and a target few reach would set the floor
 *  under the trade. The cost comes off the reward and onto the risk, since the probability is the
 *  chance of closing positive after it, as the scorer grades. Absent where the distance cannot
 *  carry a ratio, which leaves the floor with nothing to test. */
function plannedFirstExitRiskReward(
  levels: TradeLevels | undefined,
  banked: number,
  roundTripFeeFraction: number
): number | undefined {
  if (levels === undefined || !(levels.riskDistance > 0)) {
    return undefined
  }

  const cost = levels.entry * roundTripFeeFraction
  const reward = Math.abs(firstExitOf(levels, banked) - levels.entry)

  return (reward - cost) / (levels.riskDistance + cost)
}

/** Sizes the draft and prices its order; a size that cannot be computed holds instead. */
function toActionable(
  input: FinalizeInput,
  draft: ActionableSuggestion,
  parts: FinalizeParts
): Suggestion {
  const { debate } = input
  const sized = sizeDraft(input, parts.conviction)
  const orderSession = orderSessionOf(input.manifest.calendar, input.now)
  const settlement = resolveSettlementNote(draft, input, orderSession)
  const caveats = [...parts.caveats, ...restatedLevelCaveats(input)]
  const { invalidators } = parts

  if (sized.result.kind === 'unavailable') {
    return toHold({ draft, debate, ...parts, caveats, holdReasonCodes: [sized.result.reasonCode] })
  }

  return {
    ...draft,
    conviction: parts.conviction,
    caveats: [...caveats, ...sizeCaveats(sized.result, input.manifest), ...sized.caveats],
    calculationVersions: parts.versions,
    citations: debate.citations,
    headlinesRead: debate.headlinesRead,
    thesis: debate.thesis,
    probability: probabilityOf(debate.result),
    ...(invalidators.length === 0 ? {} : { invalidators }),
    ...(debate.invalidatedPrior === undefined ? {} : { invalidatedPrior: debate.invalidatedPrior }),
    ...sizedFields(input, draft, sized.result),
    ...targetWeightField(input, draft),
    ...(input.levels === undefined ? {} : { atr: input.levels.atr }),
    orderSession,
    ...restingEntryField(input, orderSession),
    ...(settlement === undefined ? {} : { settlement }),
    ...(input.dailyBand === undefined ? {} : { priceBand: priceBandOf(input.dailyBand) }),
  }
}

function restatedLevelCaveats(input: FinalizeInput): readonly Caveat[] {
  const rendered = renderedLevels(input)
  const count = invalidatorsOf(input.debate.result).filter((text) =>
    isLevelRestatement(text, rendered)
  ).length

  return count === 0 ? [] : [{ code: 'suggestion.invalidator-restates-level', detail: { count } }]
}

/** The invalidators a row may carry: those that restate the stop or the target are removed, and
 *  the removal is reported as a caveat so the operator can see the manager wrote one. */
function checkedInvalidators(
  input: FinalizeInput,
  invalidators: readonly string[]
): readonly string[] {
  const rendered = renderedLevels(input)

  return rendered.length === 0
    ? invalidators
    : invalidators.filter((text) => !isLevelRestatement(text, rendered))
}

/** The stop and target exactly as the evidence bundle stated them to the personas: the bare board
 *  form, with no currency, because that is the text the model copies. Empty without levels, so both
 *  readers above agree on what counts as a restatement. */
function renderedLevels(input: FinalizeInput): readonly string[] {
  const { levels, manifest } = input

  if (levels === undefined) {
    return []
  }

  return [levels.stop, levels.target].map((level) =>
    formatPrice(input.draft.authoredLocale, level, manifest.priceDisplay)
  )
}

/** A draft the direction or the levels already declined, framed on the side its levels were read. */
function holdFields(
  input: DraftInput
): Pick<
  HoldSuggestion,
  | 'action'
  | 'direction'
  | 'holdReasonCodes'
  | LevelField
  | 'takeProfitTranchePct'
  | 'reduceReasonCode'
> {
  const direction = levelDirectionFor(input.direction)
  const sold = input.direction.action === 'hold' ? input.direction.reduceReasonCode : undefined

  return {
    action: 'hold',
    direction,
    holdReasonCodes:
      input.direction.action === 'hold'
        ? [...input.holdReasonCodes, input.direction.reasonCode]
        : input.holdReasonCodes,
    ...levelFields(input.levels),
    ...trancheField(input, direction),
    ...(sold === undefined ? {} : { reduceReasonCode: sold }),
  }
}

/** Only a buy's levels have a take-profit to bank at; a reduce sells toward its target outright. */
function trancheField(
  input: DraftInput,
  direction: SuggestionDirection
): { readonly takeProfitTranchePct?: number } {
  return direction === 'buy' && input.levels !== undefined
    ? { takeProfitTranchePct: input.takeProfitTranchePct }
    : {}
}

/** The levels a hold reports when the market computed them; the actionable arm carries the
 *  same names as required fields, so one vocabulary describes levels on either arm. */
function levelFields(levels: TradeLevels | undefined): Pick<HoldSuggestion, LevelField> {
  return levels === undefined
    ? {}
    : {
        entry: levels.entry,
        stop: levels.stop,
        target: levels.target,
        takeProfit: levels.takeProfit,
        riskReward: levels.riskReward,
      }
}

/** The risk role may lower conviction or block; it can never raise. A band above the current one is
 *  discarded rather than applied. A material claim the evidence did not carry costs a band too:
 *  the case survived verification, but on less than it claimed to stand on. So does an earlier
 *  thesis on this name that has since broken. */
function riskAdjustedConviction(current: ConvictionBand, debate: ResolvedDebate): ConvictionBand {
  const risked = riskBand(current, debate)
  const claimed = debate.unverifiedClaims === 0 ? risked : lowerBand(risked)

  return debate.invalidatedPrior === undefined ? claimed : lowerBand(claimed)
}

/** A `lower` verdict can arrive without a band, or naming one that is not below the current band. It
 *  still lowers by one: a downgrade the risk role asked for must never read as an accept. */
function riskBand(current: ConvictionBand, debate: ResolvedDebate): ConvictionBand {
  if (debate.result.mode !== 'full') {
    return current
  }

  const { verdict, conviction } = debate.result.risk
  const named = conviction !== undefined && isBelow(conviction, current) ? conviction : current

  return verdict === 'lower' && named === current ? lowerBand(current) : named
}

/** The versions reporting groups by. The debate mode is one of them, so a full-mode and a
 *  lean-mode population can never blend silently; the skill set is hashed rather than listed
 *  because the tuple is an identity for grouping, not an inventory. */
export function calculationVersionsFor(
  base: readonly CalculationVersion[],
  deps: SuggestionRunDeps,
  mode: DebateMode
): readonly CalculationVersion[] {
  return [
    ...base,
    { name: 'debate', version: mode },
    ...hashedVersion('skills', deps.skillVersions ?? []),
    ...hashedVersion('personas', deps.personaVersions ?? []),
  ]
}

function hashedVersion(name: string, versions: readonly string[]): readonly CalculationVersion[] {
  return versions.length === 0 ? [] : [{ name, version: hashVersions(versions) }]
}

function hashVersions(versions: readonly string[]): string {
  const sorted = [...versions].sort()
  let hash = 0

  for (const entry of sorted.join('|')) {
    hash = (hash * 31 + entry.charCodeAt(0)) % 2_147_483_647
  }

  return hash.toString(36)
}

function provenanceOf(factors: readonly FactorResult[]): readonly SourceProvenance[] {
  const seen = new Map<string, SourceProvenance>()

  for (const entry of factors.flatMap((factor) => factor.provenance)) {
    seen.set(`${entry.sourceId}:${entry.fetchedAt}`, entry)
  }

  return [...seen.values()]
}

/** Only a reduce is trimming toward anything: on a buy the plan's target is a ceiling the sizer
 *  already applied, and restating it would read as a second size. */
function targetWeightField(
  input: FinalizeInput,
  draft: Suggestion
): { readonly targetPctNav?: number } {
  if (draft.action !== 'reduce') {
    return {}
  }

  const target = targetWeightOf(input.context, draft.instrument)

  return target === undefined ? {} : { targetPctNav: target }
}

function isBelow(candidate: ConvictionBand, current: ConvictionBand): boolean {
  return BAND_RANK[candidate] < BAND_RANK[current]
}
