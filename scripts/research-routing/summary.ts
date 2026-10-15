import type {
  EvaluatedRecord,
  FamilySummary,
  FamilyThreshold,
  MetricSet,
  ReviewedScore,
  RoutingEvalCase,
  RoutingFamily,
  RoutingTaskSet,
  SummarizeFamilyInput,
  ThresholdCheck,
} from './model'
import {
  DIRECT_FIRST,
  FAMILIES,
  FamilySummarySchema,
  MODES,
  OUTPUT_SCHEMA_VERSION,
  RoutingEvalError,
} from './model'
import {
  caseScores,
  hasDuplicateRouting,
  isCorrectRoute,
  mean,
  ratio,
  rubricDimension,
  scoreKey,
  sum,
} from './records'

export function summarizeRecords(
  taskSet: RoutingTaskSet,
  records: readonly EvaluatedRecord[],
  scores: readonly ReviewedScore[]
): { readonly report: unknown; readonly passes: boolean } {
  const scoreMap = validateScores(taskSet, scores)
  validateEvaluationRecords(taskSet, records)
  const families = Object.fromEntries(
    FAMILIES.map((family) => [
      family,
      summarizeFamily({ taskSet, records, scores: scoreMap, family }),
    ])
  )
  const failures = thresholdFailures(taskSet, families)
  const safetyRegressions = safetyRegressionsFor(taskSet, records, scoreMap)
  const allFailures = [...failures, ...safetyRegressions]
  const report = {
    recordType: 'routing_eval_summary',
    schemaVersion: OUTPUT_SCHEMA_VERSION,
    taskSetVersion: taskSet.version,
    families,
    failures: allFailures,
    rolloutDecision: allFailures.length === 0 ? 'proceed' : 'hold',
  }

  return { report, passes: allFailures.length === 0 }
}

export function validateScores(
  taskSet: RoutingTaskSet,
  scores: readonly ReviewedScore[]
): ReadonlyMap<string, number> {
  const expected = new Set<string>()
  for (const entry of taskSet.cases) {
    for (const mode of MODES) {
      for (const item of entry.rubric) {
        expected.add(scoreKey(entry.id, mode, item))
      }
    }
  }
  const found = new Map<string, number>()
  for (const score of scores) {
    const key = scoreKey(score.caseId, score.mode, score.rubricItem)
    if (!expected.has(key)) {
      throw new RoutingEvalError('unexpected_score', `unexpected reviewed score: ${key}`)
    }
    if (found.has(key)) {
      throw new RoutingEvalError('duplicate_score', `duplicate reviewed score: ${key}`)
    }
    found.set(key, score.score)
  }
  const missing = [...expected].filter((key) => !found.has(key))
  if (missing.length > 0) {
    throw new RoutingEvalError('missing_score', `missing reviewed score: ${missing[0]}`)
  }
  return found
}

function validateEvaluationRecords(
  taskSet: RoutingTaskSet,
  records: readonly EvaluatedRecord[]
): void {
  const expected = new Set(
    taskSet.cases.flatMap((entry) => MODES.map((mode) => `${entry.id}\0${mode}`))
  )
  const found = new Set<string>()
  for (const record of records) {
    const key = `${record.caseId}\0${record.mode}`
    if (!expected.has(key) || found.has(key)) {
      throw new RoutingEvalError('evaluation_shape', `invalid evaluation pair: ${key}`)
    }
    const evalCase = taskSet.cases.find((entry) => entry.id === record.caseId)
    if (
      evalCase === undefined ||
      record.family !== evalCase.family ||
      record.expectedMode !== evalCase.expectedMode
    ) {
      throw new RoutingEvalError('evaluation_shape', `case metadata mismatch: ${record.caseId}`)
    }
    found.add(key)
  }
  if (found.size !== expected.size) {
    throw new RoutingEvalError('evaluation_shape', 'evaluation pairs are incomplete')
  }
  for (const evalCase of taskSet.cases) {
    validatePair(records, evalCase)
  }
}

function validatePair(records: readonly EvaluatedRecord[], evalCase: RoutingEvalCase): void {
  const automatic = records.find(
    (record) => record.caseId === evalCase.id && record.mode === 'automatic'
  )
  const baseline = records.find(
    (record) => record.caseId === evalCase.id && record.mode === 'direct_baseline'
  )
  if (
    automatic === undefined ||
    baseline === undefined ||
    automatic.pairInvariantHash !== baseline.pairInvariantHash ||
    automatic.systemPromptHash === baseline.systemPromptHash
  ) {
    throw new RoutingEvalError('pair_mismatch', `unmatched evaluation pair: ${evalCase.id}`)
  }
}

function summarizeFamily(input: SummarizeFamilyInput): unknown {
  const { taskSet, records, scores, family } = input
  const familyRecords = records.filter((record) => record.family === family)
  const automatic = metricSet(
    taskSet,
    familyRecords.filter((record) => record.mode === 'automatic'),
    scores
  )
  const baseline = metricSet(
    taskSet,
    familyRecords.filter((record) => record.mode === 'direct_baseline'),
    scores
  )
  return {
    automatic,
    directBaseline: baseline,
    comparison: {
      latencyRatio: ratio(automatic.latencyMs, baseline.latencyMs),
      tokenRatio: ratio(automatic.tokens, baseline.tokens),
      costRatio: ratio(automatic.costUsd, baseline.costUsd),
      qualityPerTokenRatio: ratio(automatic.qualityPerKTokens, baseline.qualityPerKTokens),
    },
  }
}

function metricSet(
  taskSet: RoutingTaskSet,
  records: readonly EvaluatedRecord[],
  scores: ReadonlyMap<string, number>
): MetricSet {
  const values = records.flatMap((record) => caseScores(taskSet, record, scores))
  const correctness = values.filter((entry) => entry.dimension === 'correctness')
  const citations = values.filter((entry) => entry.dimension === 'citation_validity')
  const recovery = values.filter((entry) => entry.dimension === 'recovery')
  const tokens = sum(records.map((entry) => entry.totals.inputTokens + entry.totals.outputTokens))
  const quality = mean(values.map((entry) => entry.score))
  return {
    count: records.length,
    routingCorrectness: mean(records.map((entry) => Number(isCorrectRoute(entry)))),
    correctness: mean(correctness.map((entry) => entry.score)),
    citationValidity: mean(citations.map((entry) => entry.score)),
    overRouting: mean(
      records.map((entry) =>
        Number(entry.expectedMode === 'direct' && entry.selectedMode !== 'direct')
      )
    ),
    underRouting: mean(
      records.map((entry) =>
        Number(entry.expectedMode !== 'direct' && entry.selectedMode === 'direct')
      )
    ),
    duplicateWork: mean(records.map((entry) => Number(hasDuplicateRouting(entry.toolCalls)))),
    recovery: recovery.length === 0 ? 1 : mean(recovery.map((entry) => entry.score)),
    latencyMs: mean(records.map((entry) => entry.elapsedMs)),
    modelLatencyMs: mean(records.map((entry) => entry.modelLatencyMs)),
    tokens: records.length === 0 ? 0 : tokens / records.length,
    costUsd: mean(records.map((entry) => entry.totals.costUsd)),
    quality,
    qualityPerKTokens: tokens === 0 ? 0 : (quality * records.length * 1_000) / tokens,
  }
}

function thresholdFailures(
  taskSet: RoutingTaskSet,
  families: Record<string, unknown>
): readonly string[] {
  const failures: string[] = []
  for (const family of FAMILIES) {
    failures.push(
      ...familyThresholdFailures(
        family,
        taskSet.thresholds[family],
        FamilySummarySchema.parse(families[family])
      )
    )
  }
  return failures
}

function familyThresholdFailures(
  family: RoutingFamily,
  threshold: FamilyThreshold,
  summary: FamilySummary
): readonly string[] {
  const checks: ThresholdCheck[] = [
    {
      direction: 'min',
      metric: 'routing correctness',
      actual: summary.automatic.routingCorrectness,
      limit: threshold.minRoutingCorrectness,
    },
    {
      direction: 'min',
      metric: 'quality',
      actual: summary.automatic.quality,
      limit: threshold.minQuality,
    },
    {
      direction: 'min',
      metric: 'citation validity',
      actual: summary.automatic.citationValidity,
      limit: threshold.minCitationValidity,
    },
    {
      direction: 'max',
      metric: 'over-routing',
      actual: summary.automatic.overRouting,
      limit: threshold.maxOverRoutingRate,
    },
    {
      direction: 'max',
      metric: 'under-routing',
      actual: summary.automatic.underRouting,
      limit: threshold.maxUnderRoutingRate,
    },
    {
      direction: 'max',
      metric: 'duplicate work',
      actual: summary.automatic.duplicateWork,
      limit: threshold.maxDuplicateWorkRate,
    },
    {
      direction: 'max',
      metric: 'latency ratio',
      actual: summary.comparison.latencyRatio,
      limit: threshold.maxLatencyRatio,
    },
    {
      direction: 'max',
      metric: 'token ratio',
      actual: summary.comparison.tokenRatio,
      limit: threshold.maxTokenRatio,
    },
    {
      direction: 'max',
      metric: 'cost ratio',
      actual: summary.comparison.costRatio,
      limit: threshold.maxCostRatio,
    },
    {
      direction: 'min',
      metric: 'quality/token ratio',
      actual: summary.comparison.qualityPerTokenRatio,
      limit: threshold.minQualityPerTokenRatio,
    },
  ]
  if (threshold.minRecovery !== undefined) {
    checks.push({
      direction: 'min',
      metric: 'recovery',
      actual: summary.automatic.recovery,
      limit: threshold.minRecovery,
    })
  }
  return checks.flatMap((check) => thresholdFailure(family, check))
}

function thresholdFailure(family: RoutingFamily, check: ThresholdCheck): readonly string[] {
  const failed = check.direction === 'min' ? check.actual < check.limit : check.actual > check.limit
  if (!failed) {
    return []
  }
  const comparator = check.direction === 'min' ? '<' : '>'
  return [`${family}: ${check.metric} ${check.actual} ${comparator} ${check.limit}`]
}

function safetyRegressionsFor(
  taskSet: RoutingTaskSet,
  records: readonly EvaluatedRecord[],
  scores: ReadonlyMap<string, number>
): readonly string[] {
  const failures: string[] = []
  for (const evalCase of taskSet.cases) {
    const automatic = records.find(
      (record) => record.caseId === evalCase.id && record.mode === 'automatic'
    )
    const baseline = records.find(
      (record) => record.caseId === evalCase.id && record.mode === 'direct_baseline'
    )
    if (automatic === undefined || baseline === undefined) {
      continue
    }
    if (DIRECT_FIRST.has(evalCase.family) && automatic.selectedMode !== 'direct') {
      failures.push(`${evalCase.id}: direct-first invariant regressed`)
    }
    const safetyItem = evalCase.rubric.find((item) => rubricDimension(item) === 'safety')
    if (
      safetyItem !== undefined &&
      (scores.get(scoreKey(evalCase.id, 'automatic', safetyItem)) ?? 0) <
        (scores.get(scoreKey(evalCase.id, 'direct_baseline', safetyItem)) ?? 0)
    ) {
      failures.push(`${evalCase.id}: safety score regressed against direct baseline`)
    }
  }
  return failures
}
