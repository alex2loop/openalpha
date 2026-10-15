import type { AgentProfile, Runner } from '@/engine/api'
import { DEFAULT_AGENT_ID } from '@/core/ids'
import { EMPTY_LLM_USAGE_TOTALS } from '@/core/types/usage'

import type {
  EvaluatedRecord,
  FakeCall,
  Manifest,
  ManifestInput,
  ReviewedScore,
  RoutingEvalCase,
  RoutingMode,
  RoutingTaskSet,
} from './model'
import { evaluateOne, requiredPath } from './command'
import {
  DIRECT_INSTRUCTION,
  loadRoutingTaskSet,
  MODES,
  OUTPUT_SCHEMA_VERSION,
  ReviewedScoreSchema,
  RoutingEvalError,
  stableHash,
} from './model'
import { hasDuplicateRouting } from './records'
import { summarizeRecords, validateScores } from './summary'

export async function selfCheck(): Promise<void> {
  const { taskSet, raw } = await loadRoutingTaskSet()
  const repeated = await loadRoutingTaskSet()

  await checkFakePair(taskSet, raw)
  checkSummaryFixtures(taskSet)
  checkRoutingMultiplicity()
  assertSelfCheck(stableHash(raw) === stableHash(repeated.raw), 'hashing is not deterministic')
  assertThrows(() => requiredPath(new Map(), 'output'), 'explicit_output')
  process.stdout.write('routing evaluator self-check: PASS\n')
}

function checkRoutingMultiplicity(): void {
  assertSelfCheck(
    hasDuplicateRouting([
      { name: 'research', argsSummary: '{"query":"a"}' },
      { name: 'delegate', argsSummary: '{"task":"b"}' },
    ]),
    'multiple routing capabilities were not detected'
  )
}

async function checkFakePair(taskSet: RoutingTaskSet, raw: string): Promise<void> {
  const directSessions = new Set<string>()
  const calls: FakeCall[] = []
  const agent = fakeAgent()
  const manifest = fakeManifest({ taskSet, raw, agent })
  const runner = fakeRunner(directSessions, calls)
  const evalCase = taskSet.cases[0]

  if (evalCase === undefined) {
    throw new RoutingEvalError('self_check', 'task set is empty')
  }

  const automatic = await evaluateOne({
    runner,
    evalCase,
    mode: 'automatic',
    profile: taskSet.runProfile,
    agent,
    manifest,
    directSessions,
  })
  const baseline = await evaluateOne({
    runner,
    evalCase,
    mode: 'direct_baseline',
    profile: taskSet.runProfile,
    agent,
    manifest,
    directSessions,
  })

  assertSelfCheck(calls.length === 2, 'fake runner did not observe two runs')
  const first = calls[0]
  const second = calls[1]
  if (first === undefined || second === undefined) {
    throw new RoutingEvalError('self_check', 'fake runner calls are missing')
  }
  assertSelfCheck(!first.direct && second.direct, 'direct instruction was not session-scoped')
  assertSelfCheck(
    stableHash(callInvariant(first)) === stableHash(callInvariant(second)),
    'paired budgets or input differ'
  )
  assertSelfCheck(
    automatic.pairInvariantHash === baseline.pairInvariantHash &&
      automatic.systemPromptHash !== baseline.systemPromptHash,
    'only-instruction pair invariant failed'
  )
  assertSelfCheck(
    automatic.modelLatencyMs === 10 &&
      automatic.streamTotals.inputTokens === 10 &&
      automatic.streamTotals.outputTokens === 5 &&
      automatic.streamTotals.costUsd === 0.01 &&
      automatic.citationUrls[0] === 'https://example.com/a',
    'stream-derived evidence is incomplete'
  )
}

function checkSummaryFixtures(taskSet: RoutingTaskSet): void {
  const scores = fixtureScores(taskSet)
  const records = fixtureRecords(taskSet)
  const firstScore = scores[0]
  if (firstScore === undefined) {
    throw new RoutingEvalError('self_check', 'fixture scores are empty')
  }
  const passing = summarizeRecords(taskSet, records, scores)
  assertSelfCheck(passing.passes, 'passing threshold fixture failed')
  const failing = summarizeRecords(taskSet, failRoutingFixture(records), scores)
  assertSelfCheck(!failing.passes, 'failing threshold fixture passed')
  assertThrows(() => validateScores(taskSet, scores.slice(1)), 'missing_score')
  assertThrows(() => validateScores(taskSet, [...scores, firstScore]), 'duplicate_score')
  assertThrows(() => ReviewedScoreSchema.parse({ ...firstScore, unexpected: true }), undefined)
}

function fakeRunner(directSessions: ReadonlySet<string>, calls: FakeCall[]): Runner {
  return {
    async run(input, options = {}) {
      calls.push({
        direct: directSessions.has(input.sessionId),
        prompt: input.userMessage,
        agentId: input.agentId,
        maxCostUsd: options.budgetSlice?.limitUsd ?? 0,
        maxDurationMs: options.maxDurationMs,
        maxTurns: options.maxTurns,
        persistence: options.persistence,
      })
      input.onChunk?.({ type: 'text_delta', delta: 'Answer [source](https://example.com/a).' })
      input.onChunk?.({
        type: 'turn_metric',
        model: 'fixture-model',
        provider: 'fixture-provider',
        latencyMs: 10,
        contextPct: 1,
        costUsd: 0.01,
        inputTokens: 10,
        outputTokens: 5,
      })
      return {
        reason: 'completed',
        text: 'Answer [source](https://example.com/a).',
        totals: {
          ...EMPTY_LLM_USAGE_TOTALS,
          costUsd: 0.01,
          inputTokens: 10,
          outputTokens: 5,
          modelCalls: 1,
        },
        workStarted: true,
      }
    },
  }
}

function fakeAgent(): AgentProfile {
  return {
    id: DEFAULT_AGENT_ID,
    name: 'Routing fixture',
    systemPrompt: 'Base routing prompt.',
    model: 'fixture-model',
    preferredProviderModel: { provider: 'fixture-provider', model: 'fixture-model' },
    modelChain: { kind: 'primary' },
    reasoningMode: 'default',
    tools: ['research', 'delegate', 'delegate_parallel'],
    maxTurns: 8,
    delegates: ['reviewer'],
  }
}

function fakeManifest(input: Omit<ManifestInput, 'app'>): Manifest {
  const { taskSet, raw, agent } = input
  const hash = stableHash('fixture')
  const base: Omit<Manifest, 'manifestId'> = {
    recordType: 'manifest',
    schemaVersion: OUTPUT_SCHEMA_VERSION,
    taskSetVersion: taskSet.version,
    createdAt: 0,
    modelSelector: agent.model,
    caseCount: taskSet.cases.length,
    runProfile: taskSet.runProfile,
    hashes: {
      routingPrompt: stableHash(agent.systemPrompt),
      rosterDescriptions: hash,
      toolSchemas: hash,
      budgetProfile: stableHash(taskSet.runProfile),
      taskSetData: stableHash(raw),
      rubric: hash,
      directInstruction: stableHash(DIRECT_INSTRUCTION),
    },
  }
  return { ...base, manifestId: stableHash(base) }
}

function fixtureScores(taskSet: RoutingTaskSet): readonly ReviewedScore[] {
  return taskSet.cases.flatMap((entry) =>
    MODES.flatMap((mode) =>
      entry.rubric.map((rubricItem) => ({ caseId: entry.id, mode, rubricItem, score: 1 }))
    )
  )
}

function fixtureRecords(taskSet: RoutingTaskSet): readonly EvaluatedRecord[] {
  return taskSet.cases.flatMap((entry) => MODES.map((mode) => fixtureRecord(entry, mode)))
}

function fixtureRecord(entry: RoutingEvalCase, mode: RoutingMode): EvaluatedRecord {
  const selectedMode = mode === 'automatic' ? entry.expectedMode : 'direct'
  const selectedTools = selectedMode === 'direct' ? [] : [selectedMode]
  return {
    recordType: 'routing_eval',
    schemaVersion: OUTPUT_SCHEMA_VERSION,
    manifestId: stableHash('fixture'),
    caseId: entry.id,
    family: entry.family,
    mode,
    expectedMode: entry.expectedMode,
    selectedMode,
    answer: 'fixture',
    selectedTools,
    toolCalls: [],
    totals: {
      ...EMPTY_LLM_USAGE_TOTALS,
      costUsd: 0.01,
      inputTokens: 10,
      outputTokens: 10,
      modelCalls: 1,
    },
    elapsedMs: 10,
    modelLatencyMs: 8,
    streamTotals: { costUsd: 0.01, inputTokens: 10, outputTokens: 10, modelCalls: 1 },
    citationUrls: [],
    reason: 'completed',
    pairInvariantHash: stableHash(entry.id),
    systemPromptHash: stableHash(mode),
  }
}

function failRoutingFixture(records: readonly EvaluatedRecord[]): readonly EvaluatedRecord[] {
  return records.map((record) =>
    record.caseId === 'direct-01' && record.mode === 'automatic'
      ? { ...record, selectedMode: 'research', selectedTools: ['research'] }
      : record
  )
}

function callInvariant(call: FakeCall): Omit<FakeCall, 'direct'> {
  return {
    prompt: call.prompt,
    agentId: call.agentId,
    maxCostUsd: call.maxCostUsd,
    maxDurationMs: call.maxDurationMs,
    maxTurns: call.maxTurns,
    persistence: call.persistence,
  }
}

function assertSelfCheck(condition: boolean, message: string): void {
  if (!condition) {
    throw new RoutingEvalError('self_check', message)
  }
}

function assertThrows(fn: () => unknown, code: string | undefined): void {
  try {
    fn()
  } catch (err: unknown) {
    if (code === undefined || (err instanceof RoutingEvalError && err.code === code)) {
      return
    }
    throw err
  }
  throw new RoutingEvalError('self_check', `expected error${code === undefined ? '' : ` ${code}`}`)
}
