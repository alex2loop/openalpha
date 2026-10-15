import type { ResearchEvidenceLevel, ResearchFailureCode } from '../contracts'

// Result and failure display-key registries: each terminal status, failure code, and evidence level
// maps to exactly one localized message key. `satisfies Record<Union, string>` keeps every registry
// complete when a union grows. The i18n leaf is never imported here.

export const FAILURE_LABEL_KEYS = {
  aborted: 'researchResults.failureAborted',
  budget_exhausted: 'researchResults.failureBudgetExhausted',
  capacity_exhausted: 'researchResults.failureCapacityExhausted',
  planner_failed: 'researchResults.failurePlannerFailed',
  crawler_failed: 'researchResults.failureCrawlerFailed',
  timeout: 'researchResults.failureTimeout',
  turn_limit: 'researchResults.failureTurnLimit',
  loop_detected: 'researchResults.failureLoopDetected',
  insufficient_evidence: 'researchResults.failureInsufficientEvidence',
  provider_unavailable: 'researchResults.failureProviderUnavailable',
  llm_provider_failed: 'researchResults.failureLlmProviderFailed',
  synthesizer_failed: 'researchResults.failureSynthesizerFailed',
  reviewer_incomplete: 'researchResults.failureReviewerIncomplete',
  invalid_output: 'researchResults.failureInvalidOutput',
  model_incompatible: 'researchResults.failureModelIncompatible',
  invalid_tool_arguments: 'researchResults.failureInvalidToolArguments',
  source_unavailable: 'researchResults.failureSourceUnavailable',
  unexpected: 'researchResults.failureUnexpected',
} as const satisfies Record<ResearchFailureCode, string>

export const FAILURE_RESULT_KEYS = {
  aborted: 'researchResults.cancelled',
  budget_exhausted: 'researchResults.budgetExhausted',
  capacity_exhausted: 'researchResults.capacityExhausted',
  planner_failed: 'researchResults.plannerFailed',
  crawler_failed: 'researchResults.crawlerFailed',
  timeout: 'researchResults.timeout',
  turn_limit: 'researchResults.turnLimit',
  loop_detected: 'researchResults.loopDetected',
  insufficient_evidence: 'researchResults.insufficientEvidence',
  provider_unavailable: 'researchResults.providerUnavailable',
  llm_provider_failed: 'researchResults.llmProviderFailed',
  synthesizer_failed: 'researchResults.synthesizerFailed',
  reviewer_incomplete: 'researchResults.reviewerIncomplete',
  invalid_output: 'researchResults.invalidOutput',
  model_incompatible: 'researchResults.modelIncompatible',
  invalid_tool_arguments: 'researchResults.invalidToolArguments',
  source_unavailable: 'researchResults.sourceUnavailable',
  unexpected: 'researchResults.unexpected',
} as const satisfies Record<ResearchFailureCode, string>

export const FAILURE_ACTION_KEYS = {
  aborted: 'researchResults.actionAborted',
  budget_exhausted: 'researchResults.actionBudgetExhausted',
  capacity_exhausted: 'researchResults.actionCapacityExhausted',
  planner_failed: 'researchResults.actionPlannerFailed',
  crawler_failed: 'researchResults.actionCrawlerFailed',
  timeout: 'researchResults.actionTimeout',
  turn_limit: 'researchResults.actionTurnLimit',
  loop_detected: 'researchResults.actionLoopDetected',
  insufficient_evidence: 'researchResults.actionInsufficientEvidence',
  provider_unavailable: 'researchResults.actionProviderUnavailable',
  llm_provider_failed: 'researchResults.actionLlmProviderFailed',
  synthesizer_failed: 'researchResults.actionSynthesizerFailed',
  reviewer_incomplete: 'researchResults.actionReviewerIncomplete',
  invalid_output: 'researchResults.actionInvalidOutput',
  model_incompatible: 'researchResults.actionModelIncompatible',
  invalid_tool_arguments: 'researchResults.actionInvalidToolArguments',
  source_unavailable: 'researchResults.actionSourceUnavailable',
  unexpected: 'researchResults.actionUnexpected',
} as const satisfies Record<ResearchFailureCode, string>

export const RESEARCH_EVIDENCE_LEVEL_KEYS = {
  sufficient: 'researchResults.evidenceSufficient',
  mixed: 'researchResults.evidenceMixed',
  limited: 'researchResults.evidenceLimited',
} as const satisfies Record<ResearchEvidenceLevel, string>
