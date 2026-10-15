import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { App } from '@/core/container'
import type { RunResultReason } from '@/core/types/run'
import type { LLMUsageTotals } from '@/core/types/usage'
import type { AgentProfile, Runner } from '@/engine/api'
import { DEFAULT_MAX_TOKENS } from '@/core/stream-events'

import { z } from '../../node_modules/zod'

export const TASK_SET_PATH = join(import.meta.dir, '..', 'evals', 'research-routing-cases.json')
export const DIRECT_INSTRUCTION =
  'EVALUATION BASELINE ONLY: Answer directly. Do not call research, delegate, or delegate_parallel.'
export const FAMILIES = [
  'direct',
  'research',
  'specialist',
  'parallel',
  'sequential',
  'ambiguous',
  'failure',
] as const
export const MODES = ['automatic', 'direct_baseline'] as const
export const DIRECT_FIRST = new Set<RoutingFamily>(['direct', 'sequential', 'ambiguous', 'failure'])
export const ROUTING_TOOLS = new Set(['research', 'delegate', 'delegate_parallel'])
export const URL_RE = /https?:\/\/[^\s)\]]+(?:\([^\s)]*\))*/gi
export const PRODUCT_LITERAL_RE = /openalpha/i
export const LINE_RE = /\r?\n/
export const SCORE_DIMENSIONS = new Set(['correctness', 'citation_validity', 'safety', 'recovery'])
export const TASK_SET_SCHEMA_VERSION = 1
export const OUTPUT_SCHEMA_VERSION = 1

export type RoutingFamily = (typeof FAMILIES)[number]
export type RoutingMode = (typeof MODES)[number]
export type ExpectedMode = 'direct' | 'research' | 'delegate' | 'delegate_parallel'

export interface RoutingEvalCase {
  readonly id: string
  readonly family: RoutingFamily
  readonly prompt: string
  readonly expectedMode: ExpectedMode
  readonly rubric: readonly string[]
}

export interface RoutingEvalRecord {
  readonly caseId: string
  readonly mode: RoutingMode
  readonly answer: string
  readonly selectedTools: readonly string[]
  readonly totals: LLMUsageTotals
  readonly elapsedMs: number
  readonly citationUrls: readonly string[]
  readonly reason: RunResultReason
}

export interface RunProfile {
  readonly maxCostUsd: number
  readonly maxDurationMs: number
  readonly maxTurns: number
  readonly maxTokens: number
}

export interface StreamObservation {
  readonly selectedTools: string[]
  readonly toolCalls: ObservedToolCall[]
  text: string
  modelLatencyMs: number
  costUsd: number
  inputTokens: number
  outputTokens: number
  modelCalls: number
}

export interface ObservedToolCall {
  readonly name: string
  readonly argsSummary: string
}

export interface FakeCall {
  readonly direct: boolean
  readonly prompt: string
  readonly agentId: string
  readonly maxCostUsd: number
  readonly maxDurationMs: number | undefined
  readonly maxTurns: number | undefined
  readonly persistence: string | undefined
}

export interface WriteRunOutputInput {
  readonly app: App
  readonly taskSet: RoutingTaskSet
  readonly raw: string
  readonly outputPath: string
  readonly directSessions: Set<string>
  readonly signal: AbortSignal
}

export interface EvaluateOneInput {
  readonly runner: Runner
  readonly evalCase: RoutingEvalCase
  readonly mode: RoutingMode
  readonly profile: RunProfile
  readonly agent: AgentProfile
  readonly manifest: Manifest
  readonly directSessions: Set<string>
}

export interface ManifestInput {
  readonly app: App
  readonly taskSet: RoutingTaskSet
  readonly raw: string
  readonly agent: AgentProfile
}

export interface SummarizeFamilyInput {
  readonly taskSet: RoutingTaskSet
  readonly records: readonly EvaluatedRecord[]
  readonly scores: ReadonlyMap<string, number>
  readonly family: RoutingFamily
}

export interface PairInvariantInput {
  readonly evalCase: RoutingEvalCase
  readonly profile: RunProfile
  readonly agent: AgentProfile
  readonly manifest: Manifest
}

export interface ThresholdCheck {
  readonly direction: 'min' | 'max'
  readonly metric: string
  readonly actual: number
  readonly limit: number
}

export interface EvaluatedRecord extends RoutingEvalRecord {
  readonly recordType: 'routing_eval'
  readonly schemaVersion: number
  readonly manifestId: string
  readonly family: RoutingFamily
  readonly expectedMode: ExpectedMode
  readonly selectedMode: ExpectedMode
  readonly toolCalls: readonly ObservedToolCall[]
  readonly pairInvariantHash: string
  readonly systemPromptHash: string
  readonly modelLatencyMs: number
  readonly streamTotals: Pick<
    LLMUsageTotals,
    'costUsd' | 'inputTokens' | 'outputTokens' | 'modelCalls'
  >
}

export interface MetricSet {
  readonly count: number
  readonly routingCorrectness: number
  readonly correctness: number
  readonly citationValidity: number
  readonly overRouting: number
  readonly underRouting: number
  readonly duplicateWork: number
  readonly recovery: number
  readonly latencyMs: number
  readonly modelLatencyMs: number
  readonly tokens: number
  readonly costUsd: number
  readonly quality: number
  readonly qualityPerKTokens: number
}

export class RoutingEvalError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'RoutingEvalError'
    this.code = code
  }
}

export function validateTaskSet(
  value: { cases: RoutingEvalCase[]; runProfile: RunProfile },
  ctx: z.RefinementCtx
): void {
  const counts = new Map<RoutingFamily, number>(FAMILIES.map((family) => [family, 0]))
  const ids = new Set<string>()
  for (const entry of value.cases) {
    counts.set(entry.family, (counts.get(entry.family) ?? 0) + 1)
    if (ids.has(entry.id)) {
      ctx.addIssue({ code: 'custom', message: `duplicate case id ${entry.id}` })
    }
    ids.add(entry.id)
    validateCase(entry, ctx)
  }
  if (new Set(counts.values()).size !== 1) {
    ctx.addIssue({ code: 'custom', message: 'all seven families must have equal case counts' })
  }
  if (value.runProfile.maxTokens !== DEFAULT_MAX_TOKENS) {
    ctx.addIssue({ code: 'custom', message: 'runProfile.maxTokens must match engine maxTokens' })
  }
}

export function validateCase(entry: RoutingEvalCase, ctx: z.RefinementCtx): void {
  if (entry.id.split('-')[0] !== entry.family) {
    ctx.addIssue({ code: 'custom', message: `${entry.id} family does not match its id` })
  }
  if (DIRECT_FIRST.has(entry.family) && entry.expectedMode !== 'direct') {
    ctx.addIssue({ code: 'custom', message: `${entry.family} must remain direct-first` })
  }
  if (PRODUCT_LITERAL_RE.test([entry.prompt, ...entry.rubric].join('\n'))) {
    ctx.addIssue({ code: 'custom', message: `${entry.id} contains the product-name literal` })
  }
  const dimensions = new Set(entry.rubric.map(toRubricDimension))
  for (const required of ['correctness', 'citation_validity', 'safety']) {
    if (!dimensions.has(required)) {
      ctx.addIssue({ code: 'custom', message: `${entry.id} lacks ${required}` })
    }
  }
  if (entry.family === 'failure' && !dimensions.has('recovery')) {
    ctx.addIssue({ code: 'custom', message: `${entry.id} lacks recovery` })
  }
}

function toRubricDimension(item: string): string {
  return item.slice(0, item.indexOf(':'))
}

export const FamilySchema = z.enum(FAMILIES)
export const ModeSchema = z.enum(MODES)
export const ExpectedModeSchema = z.enum(['direct', 'research', 'delegate', 'delegate_parallel'])
export const TotalsSchema = z.strictObject({
  costUsd: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
  modelCalls: z.number().int().nonnegative(),
})
export const RunProfileSchema = z.strictObject({
  maxCostUsd: z.number().positive(),
  maxDurationMs: z.number().int().positive(),
  maxTurns: z.number().int().positive(),
  maxTokens: z.number().int().positive(),
})
export const ThresholdSchema = z.strictObject({
  minRoutingCorrectness: z.number().min(0).max(1),
  minQuality: z.number().min(0).max(1),
  minCitationValidity: z.number().min(0).max(1),
  minRecovery: z.number().min(0).max(1).optional(),
  maxOverRoutingRate: z.number().min(0).max(1),
  maxUnderRoutingRate: z.number().min(0).max(1),
  maxDuplicateWorkRate: z.number().min(0).max(1),
  maxLatencyRatio: z.number().positive(),
  maxTokenRatio: z.number().positive(),
  maxCostRatio: z.number().positive(),
  minQualityPerTokenRatio: z.number().nonnegative(),
})
export const EvalCaseSchema: z.ZodType<RoutingEvalCase> = z.strictObject({
  id: z.string().regex(/^[a-z]+-[0-9]{2}$/),
  family: FamilySchema,
  prompt: z.string().min(1).max(1_000),
  expectedMode: ExpectedModeSchema,
  rubric: z.array(z.string().min(1).max(300)).min(3).max(5),
})
export const TaskSetSchema = z
  .strictObject({
    schemaVersion: z.literal(TASK_SET_SCHEMA_VERSION),
    version: z.string().min(1),
    runProfile: RunProfileSchema,
    thresholds: z.strictObject({
      direct: ThresholdSchema,
      research: ThresholdSchema,
      specialist: ThresholdSchema,
      parallel: ThresholdSchema,
      sequential: ThresholdSchema,
      ambiguous: ThresholdSchema,
      failure: ThresholdSchema,
    }),
    cases: z.array(EvalCaseSchema).min(FAMILIES.length),
  })
  .superRefine(validateTaskSet)
export const ManifestSchema = z.strictObject({
  recordType: z.literal('manifest'),
  schemaVersion: z.literal(OUTPUT_SCHEMA_VERSION),
  manifestId: z.string().length(64),
  taskSetVersion: z.string(),
  createdAt: z.number().int().nonnegative(),
  modelSelector: z.string().min(1),
  caseCount: z.number().int().positive(),
  runProfile: RunProfileSchema,
  hashes: z.strictObject({
    routingPrompt: z.string().length(64),
    rosterDescriptions: z.string().length(64),
    toolSchemas: z.string().length(64),
    budgetProfile: z.string().length(64),
    taskSetData: z.string().length(64),
    rubric: z.string().length(64),
    directInstruction: z.string().length(64),
  }),
})
export const EvalRecordSchema = z.strictObject({
  recordType: z.literal('routing_eval'),
  schemaVersion: z.literal(OUTPUT_SCHEMA_VERSION),
  manifestId: z.string().length(64),
  caseId: z.string(),
  family: FamilySchema,
  mode: ModeSchema,
  expectedMode: ExpectedModeSchema,
  selectedMode: ExpectedModeSchema,
  answer: z.string(),
  selectedTools: z.array(z.string()),
  toolCalls: z.array(z.strictObject({ name: z.string().min(1), argsSummary: z.string() })),
  totals: TotalsSchema,
  elapsedMs: z.number().nonnegative(),
  modelLatencyMs: z.number().nonnegative(),
  streamTotals: z.strictObject({
    costUsd: z.number().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    modelCalls: z.number().int().nonnegative(),
  }),
  citationUrls: z.array(z.url()),
  reason: z.enum(['completed', 'aborted', 'budget', 'error', 'turn_limit', 'loop', 'timeout']),
  pairInvariantHash: z.string().length(64),
  systemPromptHash: z.string().length(64),
})
export const ReviewedScoreSchema = z.strictObject({
  caseId: z.string(),
  mode: ModeSchema,
  rubricItem: z.string(),
  score: z.number().min(0).max(1),
  note: z.string().max(1_000).optional(),
})
export const FamilySummarySchema = z.strictObject({
  automatic: z.custom<MetricSet>(),
  directBaseline: z.custom<MetricSet>(),
  comparison: z.strictObject({
    latencyRatio: z.number(),
    tokenRatio: z.number(),
    costRatio: z.number(),
    qualityPerTokenRatio: z.number(),
  }),
})

export type RoutingTaskSet = z.infer<typeof TaskSetSchema>
export type Manifest = z.infer<typeof ManifestSchema>
export type ReviewedScore = z.infer<typeof ReviewedScoreSchema>
export type FamilySummary = z.infer<typeof FamilySummarySchema>
export type FamilyThreshold = z.infer<typeof ThresholdSchema>

export async function loadRoutingTaskSet(): Promise<{
  readonly taskSet: RoutingTaskSet
  readonly raw: string
}> {
  const raw = await readFile(TASK_SET_PATH, 'utf8')
  return { taskSet: TaskSetSchema.parse(parseJson(raw, TASK_SET_PATH)), raw }
}

export function stableHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex')
}

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (typeof value !== 'object' || value === null) {
    return value
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)])
  )
}

export function parseJson(text: string, source: string): unknown {
  try {
    return JSON.parse(text)
  } catch (err: unknown) {
    throw new RoutingEvalError(
      'invalid_json',
      `${source}: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}
