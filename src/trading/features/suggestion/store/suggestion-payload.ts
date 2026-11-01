import { z } from 'zod'

import {
  MANAGER_VERDICTS,
  RESEARCH_STANCES,
  RISK_VERDICTS,
  SIZING_INTENTS,
  TRADE_STANCES,
} from '@/trading/features/suggestion/debate/types'
import { SUGGESTION_DIRECTIONS } from '@/trading/features/suggestion/types'
import { HOLD_REASON_CODES } from '@/trading/kernel/caveat'
import { LEAN_DEBATE_REASONS } from '@/trading/kernel/config'
import { CONVICTION_BANDS } from '@/trading/kernel/conviction'
import { isFactorId } from '@/trading/kernel/factor'
import { FACTOR_METRIC_IDS } from '@/trading/kernel/factor-metric'
import { INSTRUMENT_KINDS } from '@/trading/kernel/instrument'
import {
  INVESTMENT_GOALS,
  INVESTMENT_HORIZONS,
  RISK_LEVELS,
} from '@/trading/kernel/operator/profile'
import { caveatsSchema, provenanceSchema } from '@/trading/kernel/store/store-payload'
import { parseJson } from '@/trading/kernel/store/store-row'

// The stored shape of a suggestion's aggregate, apart from the row mapper that reads and writes it:
// the schema is what a stored row is validated against, the mapping is what the domain does with it.

const citationSchema = z.strictObject({
  url: z.string(),
  title: z.string().optional(),
  publishedAt: z.number().finite().optional(),
})

const headlinesReadSchema = z.strictObject({
  own: z.number().int().nonnegative(),
  market: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().optional(),
})

const calculationVersionSchema = z.strictObject({ name: z.string(), version: z.string() })

const factorMetricSchema = z.strictObject({
  id: z.enum(FACTOR_METRIC_IDS),
  value: z.number().finite(),
  sessions: z.number().int().positive().optional(),
})

// A reading whose id this build no longer knows has no unit to print with, so it costs the line it
// printed and nothing more: the factor's score, weight and provenance are still what was stored.
// Rejecting the array instead would make one renamed metric id unread every suggestion written
// before the rename.
const factorMetricsSchema = z
  .array(z.unknown())
  .transform((entries) => readableMembers(entries, factorMetricSchema))

const holdReasonCodeSchema = z.enum(HOLD_REASON_CODES)
const convictionBandSchema = z.enum(CONVICTION_BANDS)
const horizonSchema = z.enum(INVESTMENT_HORIZONS)
const riskLevelSchema = z.enum(RISK_LEVELS)
const investmentGoalSchema = z.enum(INVESTMENT_GOALS)
const directionSchema = z.enum(SUGGESTION_DIRECTIONS)
const instrumentKindSchema = z.enum(INSTRUMENT_KINDS)

// A member with no absent state degrades to the reading that claims least rather than taking the
// row with it. The string arm is what makes this a rename and not a gap: the field must still hold
// a string, so a missing or non-string one is still the storage failure it always was.
const readableBandSchema = readableEnum(convictionBandSchema, 'low')
const readableHorizonSchema = readableEnum(horizonSchema, 'short')
const readableRiskLevelSchema = readableEnum(riskLevelSchema, 'conservative')
const readableGoalSchema = readableEnum(investmentGoalSchema, 'preserve')

// A hold row states the side it was framed against, so an unreadable one reads as the side that
// adds nothing. Absent stays absent: an actionable row carries its side as its action.
const readableDirectionSchema = readableEnum(directionSchema, 'reduce').optional()

// No kind can stand in for another - an ETF ceiling is not a stock's - so an unreadable one is
// dropped instead of guessed. The row then reads as a non-ETF, which is the ETF segment ceiling
// going unchecked for it; a renamed kind therefore still wants the stored rows migrated.
const readableInstrumentKindSchema = z
  .union([instrumentKindSchema, z.string().transform(() => undefined)])
  .optional()

// A retired hold reason costs the line it printed, the way a retired caveat does. Two of these
// codes carry logic rather than prose - `recorded-entry` and the undecided set - so renaming one of
// those still needs the stored rows migrated; dropping it here would let a plan read as a verdict.
const holdReasonCodesSchema = z
  .array(z.unknown())
  .transform((entries) => readableMembers(entries, holdReasonCodeSchema))

const factorResultSchema = z.strictObject({
  id: z.string(),
  score: z.number().finite(),
  weight: z.number().finite().optional(),
  metrics: factorMetricsSchema.optional(),
  provenance: z.array(provenanceSchema),
  caveats: caveatsSchema,
})

// A factor this build retired has no label to print under and no weight left in the policy, so it
// costs its row; a malformed one still fails the suggestion.
const factorScoresSchema = z
  .array(factorResultSchema)
  .transform((results) =>
    results.flatMap((result) => (isFactorId(result.id) ? [{ ...result, id: result.id }] : []))
  )

// The one payload branch that is not strict. Everything a report folds - outcome, conviction,
// levels, versions - lives outside it; this is the rendered record of what the roles said, so a
// field that is renamed or retired must cost the line it printed, never the whole suggestion and
// never the page it was read on. Unknown keys are dropped rather than rejected.
// The default keeps a debate block exported before claims were kept readable on import.
const storedClaimsSchema = z
  .array(z.strictObject({ id: z.string(), text: z.string() }))
  .default([])
  .readonly()

const storedDebateSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('full'),
    bullSummary: z.string(),
    bearSummary: z.string(),
    managerVerdict: z.enum(MANAGER_VERDICTS),
    managerRationale: z.string(),
    riskVerdict: z.enum(RISK_VERDICTS),
    riskConviction: z.enum(CONVICTION_BANDS).optional(),
    riskNote: z.string().optional(),
    traderStance: z.enum(TRADE_STANCES),
    traderTiming: z.string(),
    traderConditions: z.array(z.string()).readonly(),
    traderSizingIntent: z.enum(SIZING_INTENTS),
    claims: storedClaimsSchema,
    refutedIds: z.array(z.string()).readonly().optional(),
    playbook: z.array(z.string()).readonly().optional(),
    models: z.array(z.string()).readonly(),
  }),
  z.object({
    mode: z.literal('lean'),
    reason: z.enum(LEAN_DEBATE_REASONS),
    analystStance: z.enum(RESEARCH_STANCES),
    analystSummary: z.string(),
    claims: storedClaimsSchema,
    refutedIds: z.array(z.string()).readonly().optional(),
    playbook: z.array(z.string()).readonly().optional(),
    models: z.array(z.string()).readonly(),
  }),
])

// The debate is the rendered record of what the roles said, not what the run decided: a verdict or
// stance this build no longer knows costs the block it printed, and the action, levels and
// conviction it was argued for all live outside it.
const readableDebateSchema = z.unknown().transform(readableDebate)

// Everything a report groups, filters, or orders on is a column; the rest of the suggestion is
// this one aggregate, always read whole.
const quoteSchema = z.strictObject({
  price: z.number().finite(),
  changePct: z.number().finite().optional(),
  observedAt: z.number(),
  currency: z.string(),
  board: z
    .strictObject({
      buyPrice: z.number().finite(),
      sellPrice: z.number().finite(),
      spreadPct: z.number().finite().optional(),
    })
    .optional(),
})

const pullbackSchema = z.strictObject({
  waitSessions: z.number().int().positive(),
  holdSessions: z.number().int().positive(),
  medianBestPct: z.number().finite(),
  waitEdgePct: z.number().finite(),
})

// Dropped whole when it does not parse, the way a debate block is: the readings share one limit, so
// half of them is a statistic measured against a price this build cannot reconstruct. It costs the
// three lines it printed and nothing else - the levels, size and action never read it.
const readablePullbackSchema = z.unknown().transform(readablePullback)

const payloadSchema = z.strictObject({
  thesis: z.string().optional(),
  entry: z.number().finite().optional(),
  stop: z.number().finite().optional(),
  target: z.number().finite().optional(),
  takeProfit: z.number().finite().optional(),
  riskReward: z.number().finite().optional(),
  probability: z.number().min(0).max(1).optional(),
  sizePctNav: z.number().finite().optional(),
  units: z.number().finite().optional(),
  policyUnits: z.number().finite().optional(),
  reduceReasonCode: z.string().optional(),
  targetPctNav: z.number().finite().optional(),
  atr: z.number().finite().optional(),
  takeProfitTranchePct: z.number().finite().optional(),
  composite: z.strictObject({
    score: z.number().finite(),
    band: readableBandSchema,
    bearish: z.boolean(),
    bullish: z.boolean(),
    coverage: z.number().finite(),
    coverageBelowMinimum: z.boolean(),
    agreementBelowMinimum: z.boolean(),
    agreement: z.number().finite().optional(),
  }),
  indexTier: z.string().optional(),
  instrumentKind: readableInstrumentKindSchema,
  reviewOnly: z.literal(true).optional(),
  horizon: readableHorizonSchema,
  profile: z.strictObject({
    riskLevel: readableRiskLevelSchema,
    goal: readableGoalSchema,
    saved: z.boolean(),
  }),
  held: z
    .strictObject({
      units: z.number().finite(),
      unitCostNative: z.number().finite(),
      settledUnits: z.number().finite(),
      openLotCount: z.number().int().nonnegative(),
      firstAcquiredAt: z.string().optional(),
      medianAcquiredAt: z.string().optional(),
      pctNav: z.number().finite().optional(),
      settlesOn: z.string().optional(),
      soldUnits: z.number().finite().positive().optional(),
      openedOn: z.string().optional(),
    })
    .optional(),
  concentration: z
    .strictObject({
      sector: z.string(),
      afterPctNav: z.number().finite(),
      capPctNav: z.number().finite(),
    })
    .optional(),
  orderSession: z.string().optional(),
  restingEntry: z
    .strictObject({ run: z.number().finite(), runSessions: z.int().positive(), until: z.string() })
    .optional(),
  settlement: z
    .strictObject({ sellableFrom: z.string(), worstCaseDrawdownPct: z.number().finite() })
    .optional(),
  priceBand: z
    .strictObject({
      floor: z.number().finite(),
      ceiling: z.number().finite(),
      maximumUpPct: z.number().finite(),
      maximumDownPct: z.number().finite(),
    })
    .optional(),
  direction: readableDirectionSchema,
  holdReasonCodes: holdReasonCodesSchema.optional(),
  unsupportedClaims: z.array(z.string()).optional(),
  invalidators: z.array(z.string()).optional(),
  invalidatedPrior: z.strictObject({ at: z.string(), fired: z.array(z.string()) }).optional(),
  benchmarkReturnPct: z.number().finite().optional(),
  outcomeFormulaVersion: z.string().optional(),
  calculationVersions: z.array(calculationVersionSchema),
  citations: z.array(citationSchema),
  headlinesRead: headlinesReadSchema.optional(),
  provenance: z.array(provenanceSchema),
  caveats: caveatsSchema,
  factorScores: factorScoresSchema,
  debate: readableDebateSchema.optional(),
  quote: quoteSchema.optional(),
  pullback: readablePullbackSchema.optional(),
  raisedStopFrom: z.number().finite().optional(),
  standingExit: z.object({ stop: z.number().finite(), takeProfit: z.number().finite() }).optional(),
  standingTakeProfit: z.number().finite().optional(),
  evidenceThrough: z.string().optional(),
})

export type SuggestionPayload = z.infer<typeof payloadSchema>
export type CitationPayload = z.infer<typeof citationSchema>
export type FactorResultPayload = z.output<typeof factorScoresSchema>[number]
export type FactorMetricPayload = z.infer<typeof factorMetricSchema>
export type StoredDebatePayload = z.infer<typeof storedDebateSchema>

type PullbackPayload = z.infer<typeof pullbackSchema>

/** A value the contract no longer lists reads as `fallback`; one that is absent or not a string at
 *  all still fails, because that is a gap in the row rather than a member this build outlived. */
function readableEnum<T extends string>(schema: z.ZodType<T>, fallback: T): z.ZodType<T> {
  return z.union([schema, z.string().transform(() => fallback)])
}

/** Keep the members this build can still interpret, in the order they were stored. */
function readableMembers<T>(entries: readonly unknown[], schema: z.ZodType<T>): readonly T[] {
  return entries.flatMap((entry) => {
    const parsed = schema.safeParse(entry)

    return parsed.success ? [parsed.data] : []
  })
}

/** A block that does not parse is dropped whole: the union has no partial arm, and half a debate
 *  would read as a role that stayed silent rather than one this build cannot render. */
function readableDebate(value: unknown): StoredDebatePayload | undefined {
  const parsed = storedDebateSchema.safeParse(value)

  return parsed.success ? parsed.data : undefined
}

function readablePullback(value: unknown): PullbackPayload | undefined {
  const parsed = pullbackSchema.safeParse(value)

  return parsed.success ? parsed.data : undefined
}

export function parseSuggestionPayload(raw: string): SuggestionPayload {
  return parseJson(raw, 'suggestion', (value) => payloadSchema.parse(value))
}
