import type { SizingIntent } from '@/trading/features/suggestion/debate/types'
import type { SizingResult } from '@/trading/features/suggestion/pipeline/sizing'
import type { SizingScale } from '@/trading/features/suggestion/pipeline/sizing-scale'
import type { FinalizeInput, ResolvedDebate } from '@/trading/features/suggestion/pipeline/types'
import type { ActionableSuggestion } from '@/trading/features/suggestion/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { ConvictionBand } from '@/trading/kernel/conviction'
import type { RiskCapSet } from '@/trading/kernel/operator/profile'
import type { MarketManifest } from '@/trading/markets/types'
import {
  concentrationOf,
  etfHeadroomPctNavOf,
  heldPositionOf,
  sectorHeadroomPctNavOf,
  segmentHeadroomPctNavOf,
  tradedWeightPctNav,
} from '@/trading/features/suggestion/pipeline/concentration'
import { sizeBuy, sizeReduce } from '@/trading/features/suggestion/pipeline/sizing'
import { resolveSizingScale } from '@/trading/features/suggestion/pipeline/sizing-scale'
import { armsExit } from '@/trading/features/suggestion/types'
import { positionCapOf } from '@/trading/kernel/operator/profile'

/** What the size is, and what it says about how it was reached. The two travel together because a
 *  smaller-than-policy order is only legible beside the reason it is smaller. */
interface DraftSizing {
  readonly result: SizingResult
  readonly caveats: readonly Caveat[]
}

/** The band's realized scale resolved once, applied once, and reported once. `finalize` asks for a
 *  size and gets back what to say about it, rather than holding the scale to caveat it later. */
export function sizeDraft(input: FinalizeInput, conviction: ConvictionBand): DraftSizing {
  const bucket = input.calibration.find((entry) => entry.convictionBand === conviction)
  const scale = resolveSizingScale({
    conviction,
    profile: input.context.profile,
    ...(bucket === undefined ? {} : { bucket }),
  })
  const result = sizeFor(input, scale.scale)
  const unplanned = input.openRisk?.unplanned.length ?? 0
  // A held name with no planned stop is downside the open-risk ceiling did not see, so the ceiling
  // it produced is a floor: the reader is told rather than shown a number that reads as complete.
  const floor =
    input.draft.action === 'buy' && unplanned > 0
      ? [{ code: 'suggestion.open-risk-unplanned', detail: { count: unplanned } } as const]
      : []

  return {
    result,
    caveats: [...floor, ...(input.draft.action === 'buy' ? scaleCaveats(scale) : [])],
  }
}

function sizeFor(input: FinalizeInput, convictionScale: number): SizingResult {
  const { draft, context, manifest } = input
  const navBase = context.book.navBase ?? 0
  const rate = context.rateToBase.get(manifest.currency)

  // Unconverted, a reduce clamps to the whole position while reporting a fraction of a percent.
  if (rate === undefined) {
    return { kind: 'unsized', reason: 'fx-rate-unavailable' }
  }

  const entryBase = draft.action === 'hold' ? 0 : draft.entry * rate

  if (draft.action === 'reduce') {
    return reduceFor(input, entryBase)
  }

  // A buy is sized on the level read's own risk distance; without levels there is no number to
  // divide the risk budget by.
  if (input.levels === undefined) {
    return { kind: 'unavailable', reasonCode: 'insufficient-data' }
  }

  const cap = context.profile.caps[manifest.segment]

  // A sizer that cannot see a limit must not act as if none applies; a profile saved before this
  // market was registered names none for it.
  if (cap === undefined) {
    return { kind: 'unsized', reason: 'segment-uncapped' }
  }

  return sizeBuy({
    navBase,
    entryBase,
    convictionScale,
    sizingIntent: sizingIntentOf(input.debate),
    riskDistanceBase: input.levels.riskDistance * rate,
    spendableCashBase: spendableCashOf(input, navBase),
    cashDrawMultiple: input.deps.buyCashMultiple(manifest.id),
    openRiskHeadroomPctNav:
      input.openRisk === undefined
        ? Number.POSITIVE_INFINITY
        : Math.max(context.profile.maximumOpenRiskPctNav - input.openRisk.pctNav, 0),
    maximumPositionPctNav: positionHeadroomPctNavOf(input, cap),
    sectorHeadroomPctNav: sectorHeadroomPctNavOf(context, input.sector),
    etfHeadroomPctNav: etfHeadroomPctNavOf(context, manifest.segment, input.instrumentKind),
    armsExit: armsExit(input.draft),
    segmentHeadroomPctNav: segmentHeadroomPctNavOf(context, manifest.segment),
    smallestTick: smallestTickOf(manifest) * rate,
    boardLot: manifest.boardLot,
    regimeScale: input.regimeScale,
    profile: context.profile,
    ...(input.medianTurnover === undefined
      ? {}
      : { medianTurnoverBase: input.medianTurnover * rate }),
  })
}

/** The book's available cash less the operator's reserve, capped by what the routed market can
 *  reach. The reserve comes off the whole book, because it is one obligation. */
function spendableCashOf(input: FinalizeInput, navBase: number): number {
  const { context, manifest } = input
  const spendableBase = Math.max(
    context.book.book.availableCashBase - navBase * context.profile.reservePctNav,
    0
  )

  return Math.min(spendableBase, context.reachableCashBase.get(manifest.id) ?? spendableBase)
}

function reduceFor(input: FinalizeInput, entryBase: number): SizingResult {
  const { draft, context, manifest } = input
  const held = heldPositionOf(context, draft.instrument)

  return sizeReduce({
    navBase: context.book.navBase ?? 0,
    entryBase,
    boardLot: manifest.boardLot,
    heldUnits: held?.units ?? 0,
    settledUnits: held?.settledUnits ?? 0,
    saleFraction: input.direction.action === 'reduce' ? input.direction.saleFraction : 0,
  })
}

/** The advisory size and where it leaves the sector, present together or not at all. */
export function sizedFields(
  input: FinalizeInput,
  draft: ActionableSuggestion,
  sized: SizingResult
): Partial<Pick<ActionableSuggestion, 'sizePctNav' | 'units' | 'policyUnits' | 'concentration'>> {
  if (sized.kind !== 'available') {
    return {}
  }

  const concentration = concentrationOf(input.context, {
    sector: input.sector,
    action: draft.action,
    tradedPctNav: tradedWeightPctNav({
      held: heldPositionOf(input.context, draft.instrument),
      units: sized.units,
      sizePctNav: sized.sizePctNav,
    }),
  })

  return {
    sizePctNav: sized.sizePctNav,
    units: sized.units,
    ...(sized.policyUnits === undefined ? {} : { policyUnits: sized.policyUnits }),
    ...(concentration === undefined ? {} : { concentration }),
  }
}

/** A lean debate has no trader, so nothing asked for less than policy size. */
function sizingIntentOf(debate: ResolvedDebate): SizingIntent {
  return debate.result.mode === 'full' ? debate.result.trader.sizingIntent : 'full-policy-size'
}

/** Headroom, not the flat cap: a buy on a name the book already holds adds to that weight, so
 *  sizing against the whole cap would let the pair land past it. */
function positionHeadroomPctNavOf(input: FinalizeInput, cap: RiskCapSet): number {
  const held = heldPositionOf(input.context, input.draft.instrument)?.pctNav ?? 0

  return Math.max(0, positionCapOf(cap, input.instrumentKind) - held)
}

/** Says the size came from the record, and on how many rows, so a smaller-than-policy order is
 *  read as earned rather than as a cap. */
function scaleCaveats(scale: SizingScale): readonly Caveat[] {
  return scale.source === 'realized'
    ? [{ code: 'suggestion.size-realized-scale', detail: { n: scale.resolvedCount } }]
    : []
}

/** Zero for a market that declares no band, matching `tickSizeFor`: the two read one policy and
 *  must not answer differently. An infinity here would put every stop inside the minimum distance
 *  and refuse every buy. */
function smallestTickOf(manifest: MarketManifest): number {
  const ticks = manifest.tickSize.bands.map((band) => band.tickSize)

  return ticks.length === 0 ? 0 : Math.min(...ticks)
}
