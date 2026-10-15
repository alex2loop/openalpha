import type { StreamEvent } from '@/core/stream-events'

import type {
  EvaluatedRecord,
  ExpectedMode,
  ObservedToolCall,
  PairInvariantInput,
  RoutingMode,
  RoutingTaskSet,
  StreamObservation,
} from './model'
import { ROUTING_TOOLS, RoutingEvalError, SCORE_DIMENSIONS, stableHash, URL_RE } from './model'

export function createObservation(): StreamObservation {
  return {
    selectedTools: [],
    toolCalls: [],
    text: '',
    modelLatencyMs: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    modelCalls: 0,
  }
}

export function observeEvent(observation: StreamObservation, event: StreamEvent): void {
  if (event.type === 'text_delta') {
    observation.text += event.delta
  }
  if (event.type === 'tool_call_start') {
    observation.toolCalls.push({ name: event.name, argsSummary: event.argsSummary ?? '' })
  }
  if (event.type === 'tool_execution_start') {
    observation.selectedTools.push(event.name)
  }
  if (event.type === 'turn_metric') {
    observation.modelLatencyMs += event.latencyMs
    observation.costUsd += event.costUsd
    observation.inputTokens += event.inputTokens
    observation.outputTokens += event.outputTokens
    observation.modelCalls += 1
  }
}

export function streamTotals(observation: StreamObservation): EvaluatedRecord['streamTotals'] {
  return {
    costUsd: observation.costUsd,
    inputTokens: observation.inputTokens,
    outputTokens: observation.outputTokens,
    modelCalls: observation.modelCalls,
  }
}

export function selectedRoutingMode(tools: readonly string[]): ExpectedMode {
  if (tools.includes('delegate_parallel')) {
    return 'delegate_parallel'
  }
  if (tools.includes('research')) {
    return 'research'
  }
  if (tools.includes('delegate')) {
    return 'delegate'
  }
  return 'direct'
}

export function pairInvariantHash(input: PairInvariantInput): string {
  const { evalCase, profile, agent, manifest } = input
  return stableHash({
    caseId: evalCase.id,
    prompt: evalCase.prompt,
    profile,
    agent: {
      id: agent.id,
      name: agent.name,
      description: agent.description ?? '',
      model: agent.model,
      preferredProviderModel: agent.preferredProviderModel ?? null,
      modelChain: agent.modelChain,
      reasoningMode: agent.reasoningMode,
      tools: agent.tools,
      maxTurns: agent.maxTurns,
      delegates: agent.delegates,
      hosts: agent.hosts ?? null,
      skills: agent.skills ?? null,
    },
    toolSchemas: manifest.hashes.toolSchemas,
  })
}

export function citationUrls(text: string): readonly string[] {
  return [...new Set(text.match(URL_RE) ?? [])]
}

export function hasDuplicateRouting(calls: readonly ObservedToolCall[]): boolean {
  let routingCalls = 0
  for (const call of calls) {
    if (ROUTING_TOOLS.has(call.name)) {
      routingCalls += 1
    }
    if (routingCalls > 1) {
      return true
    }
  }
  return false
}

export function isCorrectRoute(record: EvaluatedRecord): boolean {
  return (
    !hasDuplicateRouting(record.toolCalls) &&
    record.selectedMode === (record.mode === 'automatic' ? record.expectedMode : 'direct')
  )
}

export function caseScores(
  taskSet: RoutingTaskSet,
  record: EvaluatedRecord,
  scores: ReadonlyMap<string, number>
): readonly { dimension: string; score: number }[] {
  const evalCase = taskSet.cases.find((entry) => entry.id === record.caseId)
  if (evalCase === undefined) {
    throw new RoutingEvalError('case_missing', `unknown case ${record.caseId}`)
  }
  return evalCase.rubric.map((item) => ({
    dimension: rubricDimension(item),
    score: scores.get(scoreKey(record.caseId, record.mode, item)) ?? 0,
  }))
}

export function rubricDimension(item: string): string {
  const dimension = item.slice(0, item.indexOf(':'))
  if (!SCORE_DIMENSIONS.has(dimension)) {
    throw new RoutingEvalError('rubric_dimension', `unknown rubric dimension: ${dimension}`)
  }
  return dimension
}

export function scoreKey(caseId: string, mode: RoutingMode, item: string): string {
  return `${caseId}\0${mode}\0${item}`
}

export function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return numerator === 0 ? 1 : Number.MAX_SAFE_INTEGER
  }
  return numerator / denominator
}

export function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
