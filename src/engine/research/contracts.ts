import type { ChannelId } from '@/core/channels'
import type { ResearchDepth, ResolvedConfig } from '@/core/config/resolve'
import type { HaltCode } from '@/core/errors'
import type { AgentId, RunId, SessionId, UserId } from '@/core/ids'
import type { ProviderModelId } from '@/core/llm'
import type { Logger } from '@/core/logging/logger'
import type { DelegationQuota } from '@/core/tool'
import type { Locale } from '@/core/types/locale'
import type { RunResultReason } from '@/core/types/run'
import type { ExternalCharge, LLMUsageTotals } from '@/core/types/usage'
import type { Budget, BudgetSlice } from '@/engine/types/cost'
import type { Runner } from '@/engine/types/run'

import type { ResearchIssueSummary, ResearchProgress } from './events'
import type {
  AdmittedEvidence,
  ClaimId,
  ResearchArtifact,
  ResearchFreshness,
  ResearchRetrievalAttempt,
  SourceId,
} from './evidence/model'
import type {
  ResearchEvidenceBranch,
  ResearchPlan,
  ResearchQuestion,
  ResearchReportCandidate,
} from './evidence/schemas'
import type { ResearchEffortProfile, ResearchObjective } from './planning/profile'
import type { ResearchProviderFailureCode, ResearchRetrieval } from './retrieval/retrieval'
import type { ResearchRetrievalState } from './retrieval/state'
import type { ResearchOperationReport } from './retrieval/types'

export const RESEARCH_QUERY_MAX_CHARS = 20_000
export const MAX_RESEARCH_ERROR_CHARS = 500
export const RESEARCH_MODEL_TIER = 'research'
export const RESEARCH_HEAVY_MODEL_TIER = 'research-heavy'
export const RESEARCH_CRAWLER_ID = 'research-crawler'
export const RESEARCH_WORKER_IDS = [
  RESEARCH_CRAWLER_ID,
  'research-planner',
  'research-reviewer',
  'research-synthesizer',
] as const
export const RESEARCH_FAILURE_CODES = [
  'aborted',
  'budget_exhausted',
  'capacity_exhausted',
  'planner_failed',
  'crawler_failed',
  'timeout',
  'turn_limit',
  'loop_detected',
  'insufficient_evidence',
  'provider_unavailable',
  'llm_provider_failed',
  'synthesizer_failed',
  'reviewer_incomplete',
  'invalid_output',
  'model_incompatible',
  'invalid_tool_arguments',
  'source_unavailable',
  'unexpected',
] as const
export const REVIEW_DIMENSIONS = [
  'factualSupport',
  'citationAccuracy',
  'completeness',
  'sourceQuality',
  'relevance',
  'clarity',
] as const
export const MAX_QUESTION_CHARS = 1_000
export const MAX_OBJECTIVE_CHARS = 1_000
export const MAX_SOURCE_KIND_CHARS = 80
export const MAX_LOCATOR_CHARS = 500
export const MAX_RESEARCH_LIST_ITEMS = 6
export const MAX_CLAIMS_PER_BRANCH = 8
export const MAX_SOURCES_PER_CLAIM = 3
export const MAX_QUOTES_PER_CLAIM_SOURCE = 3
export const MAX_EVIDENCE_REFS_PER_CLAIM = MAX_SOURCES_PER_CLAIM * MAX_QUOTES_PER_CLAIM_SOURCE
export const MAX_SOURCES_PER_BRANCH = MAX_CLAIMS_PER_BRANCH * MAX_SOURCES_PER_CLAIM
export const MAX_EXCERPTS_PER_BRANCH = MAX_CLAIMS_PER_BRANCH * MAX_EVIDENCE_REFS_PER_CLAIM
export const MAX_EXCERPTS_PER_CLAIM = 3
export const MAX_CLAIM_CHARS = 1_500
export const MAX_EVIDENCE_CHARS = 1_500
export const MAX_GAPS = 12
export const MAX_GAP_CHARS = 1_000
export const MAX_GAP_VALUE_ITEMS = 12
export const MAX_GAP_VALUE_ITEM_CHARS = 500
export const MAX_REVIEW_ISSUES = 6
export const MAX_KEY_EVIDENCE = MAX_CLAIMS_PER_BRANCH
export const MAX_RISKS = MAX_CLAIMS_PER_BRANCH
export const MAX_CONFLICTS = MAX_CLAIMS_PER_BRANCH
export const MAX_PRACTICAL_CONSIDERATIONS = MAX_CLAIMS_PER_BRANCH
// Fixed schema ceilings (not the configurable admission bounds from ResolvedResearch). A candidate
// may carry up to these lengths; admission truncates text to the configured per-run bound.
export const MAX_CANONICAL_URL_CHARS = 2_048
export const MAX_NUMERIC_VALUE_CHARS = 200
export const MAX_NUMERIC_UNIT_CHARS = 80
export const MAX_NUMERIC_SCOPE_CHARS = 300
export const MAX_NUMERIC_SPAN_CHARS = 40
export const MAX_NUMERIC_LINKS = MAX_EXCERPTS_PER_BRANCH
export const MAX_REPORT_CLAIM_IDS = 64
export const MAX_RETRIEVAL_ATTEMPTS = 64

export type ResearchRole = (typeof RESEARCH_WORKER_IDS)[number]

export type ResearchFailureCode = (typeof RESEARCH_FAILURE_CODES)[number]

export type ReviewDimension = (typeof REVIEW_DIMENSIONS)[number]

export type ResearchPhase = 'plan' | 'crawl' | 'synthesize' | 'review'

export type ResearchEvidenceLevel = 'sufficient' | 'mixed' | 'limited'

interface ResearchReviewScores {
  readonly factualSupport: number
  readonly citationAccuracy: number
  readonly completeness: number
  readonly sourceQuality: number
  readonly relevance: number
  readonly clarity: number
}

export interface ResearchReviewIssue {
  readonly dimension: ReviewDimension
  readonly description: string
  readonly claimIds: readonly ClaimId[]
  readonly questionIds: readonly string[]
  readonly requiresResearch: boolean
  readonly followUpQuery?: string
  // Mirrors the zod-inferred optional (`string[] | undefined`) under exactOptionalPropertyTypes.
  readonly sourceGuidance?: readonly string[] | undefined
}

export interface ResearchReview {
  readonly verdict: 'approve' | 'revise'
  readonly scores: ResearchReviewScores
  readonly unsupportedClaimIds: readonly ClaimId[]
  readonly unverifiedClaimIds: readonly ClaimId[]
  readonly issues: readonly ResearchReviewIssue[]
}

export type ReviewRoundWarning =
  | { readonly kind: 'duplicate_subquery'; readonly query: string }
  | { readonly kind: 'empty_followup' }
  | { readonly kind: 'unresolved_reference'; readonly values: readonly string[] }
  | { readonly kind: 'followup_bound'; readonly values: readonly string[] }
  | { readonly kind: 'duplicate_candidate'; readonly questionId: string }
  | { readonly kind: 'unchanged_coverage' }

export interface ResearchParent {
  readonly runId: RunId
  readonly billingSessionId: SessionId | null
  readonly billingAgentId: AgentId
  readonly agentId: AgentId
  readonly callDepth: number
  readonly delegationChain: readonly AgentId[]
  readonly chatId?: string
}

export interface ResearchRequest {
  readonly query: string
  readonly depth?: ResearchDepth
  readonly freshness?: ResearchFreshness
}

export type GatherNeed =
  | { readonly kind: 'default_provider_failure'; readonly code: ResearchProviderFailureCode }
  | { readonly kind: 'coverage_gap'; readonly claimIds: readonly ClaimId[] }
  | { readonly kind: 'conflict'; readonly claimIds: readonly ClaimId[] }
  | { readonly kind: 'full_content'; readonly sourceIds: readonly SourceId[] }

export interface ResearchInvocation {
  readonly userId: UserId
  readonly channel: ChannelId
  readonly signal: AbortSignal
  readonly budget: Budget
  readonly delegationQuota: DelegationQuota
  readonly parent?: ResearchParent
  readonly addDelegatedUsage: (totals: LLMUsageTotals) => void
  readonly addExternalCost: (charge: ExternalCharge) => Promise<void>
  readonly locale: Locale
  readonly reportProgress?: (message: ResearchProgress) => void
  readonly reviewPlan?: ReviewResearchPlan
  readonly planLimitBase?: ResearchPlanLimitBase
}

export interface ResearchCoordinator {
  run(request: ResearchRequest, invocation: ResearchInvocation): Promise<ResearchResult>
}

export interface ResearchFailure {
  readonly code: ResearchFailureCode
  readonly stage: ResearchPhase
  readonly message: string
  readonly questionId?: string
  readonly attempts: number
  readonly elapsedMs: number
  readonly claims: number
  readonly sources: number
  readonly providerModel?: ProviderModelId
  readonly haltCode?: HaltCode
  /** Raw parser issues replayed to the model on retry; never rendered or logged. */
  readonly correctionIssues?: readonly string[]
}

export interface ResearchBranchSuccess {
  readonly branch: ResearchEvidenceBranch
  readonly attempts: number
  readonly elapsedMs: number
  readonly providerModel?: ProviderModelId
}

export type ResearchChildResult<T> =
  | { readonly kind: 'value'; readonly value: T; readonly providerModel?: ProviderModelId }
  | {
      readonly kind: 'invalid'
      readonly issues: readonly string[]
      readonly providerModel?: ProviderModelId
    }
  | {
      readonly kind: 'halted'
      readonly reason: Exclude<RunResultReason, 'completed'>
      readonly message: string
      readonly providerModel?: ProviderModelId
      readonly haltCode?: HaltCode
    }
  | {
      readonly kind: 'incompatible'
      readonly providerModel: ProviderModelId
      readonly message: string
    }
  | {
      readonly kind: 'invalid_tool_arguments'
      readonly providerModel?: ProviderModelId
      readonly message: string
    }

interface CompletedResearchResult {
  readonly status: 'complete'
  readonly outcome: 'completed' | 'completed_with_gaps'
  readonly depth: ResearchDepth
  readonly artifact: ResearchArtifact
  readonly evidenceLevel: ResearchEvidenceLevel
  // A stage that failed without sinking the run still degrades the answer: kept so the completion
  // log names it, since a completed_with_gaps artifact shows the gap but never its cause.
  readonly failures: readonly ResearchFailure[]
  readonly review?: ResearchReview
}

export interface FailedResearchResult {
  readonly status: 'failed'
  readonly depth: ResearchDepth
  readonly code: ResearchFailureCode
  readonly message: string
  readonly failures: readonly ResearchFailure[]
  readonly evidenceSummary?: {
    readonly admittedSources: number
    readonly supportedClaims: number
    readonly issues: readonly ResearchIssueSummary[]
  }
  readonly requiredCalls?: number
  readonly availableCalls?: number
}

interface CancelledResearchResult {
  readonly status: 'cancelled'
  readonly depth: ResearchDepth
}

export type ResearchResult =
  | CompletedResearchResult
  | FailedResearchResult
  | CancelledResearchResult

export type ResearchPlanDecision =
  | { readonly kind: 'start' }
  | { readonly kind: 'edit'; readonly instruction: string }
  | { readonly kind: 'cancel' }

// Actual boundaries shown at plan review: the effort limits come from the approved effort, the
// rest were captured from the parent run before the coordinator reserved its research pool.
export interface ResearchPlanLimits {
  readonly maxDurationMs: number
  readonly maxQuestions: number
  readonly maxReviewRounds: number
  readonly remainingCostUsd: number
}

export interface ResearchPlanLimitBase {
  readonly maxDurationMs: number
  readonly remainingCostUsd: number
}

export interface ResearchPlanReview {
  readonly plan: ResearchPlan
  readonly objective: ResearchObjective
  readonly effort: ResearchEffortProfile
  readonly canEdit: boolean
  readonly signal: AbortSignal
  readonly limits: ResearchPlanLimits
}

export type ReviewResearchPlan = (input: ResearchPlanReview) => Promise<ResearchPlanDecision>

// One optional, run-scoped seam between a foreground research call and its surface: the surface
// renders typed progress and answers the deep-plan review; the run that received it owns its
// lifetime. It never lives in boot services, module state, the bus, or a listener registry.
export interface ForegroundResearchInteraction {
  reportProgress(message: ResearchProgress): void
  readonly reviewPlan?: ReviewResearchPlan
  finish(): void
}

export interface ResearchPlanningInput {
  readonly query: string
  readonly depth: Extract<ResearchDepth, 'medium' | 'deep'>
  readonly locale: Locale
  readonly maxQuestions: number
  readonly deterministicObjective: ResearchObjective
  readonly allowObjectiveInference: boolean
  readonly previousPlan?: ResearchPlan
  readonly revision?: string
}

export interface SynthesisInput {
  readonly query: string
  readonly locale: Locale
  readonly evidence: AdmittedEvidence
  readonly correctionIssues?: readonly string[]
}

export interface ReviewInput {
  readonly query: string
  readonly locale: Locale
  readonly artifact: ResearchArtifact
  readonly questions: readonly Pick<ResearchQuestion, 'id' | 'question'>[]
}

interface CrawlStageOptions {
  readonly budget: BudgetSlice
  readonly correctionIssues?: readonly string[]
  readonly reportOperation?: (report: ResearchOperationReport) => void
}

export interface ResearchStageDeps {
  readonly now: number
  readonly runner: Runner
  readonly invocation: ResearchInvocation
  readonly quota: ResearchQuota
  readonly budgets: ResearchBudgetPool
  readonly logger: Logger
  readonly retrieval: ResearchRetrieval
  readonly recordExternalCost: (charge: ExternalCharge) => Promise<void>
  readonly retrievalState: ResearchRetrievalState
  readonly retrievalAttempts: ResearchRetrievalAttempt[]
  readonly researchConfig: ResolvedConfig['research']
  readonly freshness?: ResearchFreshness
}

export interface ResearchCoordinatorDeps {
  readonly config: ResolvedConfig
  readonly runner: Runner
  readonly logger: Logger
  readonly retrieval: ResearchRetrieval
}

export const QUOTA_EXHAUSTED_MESSAGE = 'research delegation quota exhausted'

/** Calls are reserved ahead of use and claimed one at a time from one pool, so an optional call
 *  must be reserved first or skipped, never claimed against calls set aside for mandatory
 *  stages. */
export interface ResearchQuota {
  /** Reserves as many of `count` calls as the shared quota can still fund; returns how many. */
  reserveUpTo(count: number): number
  claim(): void
  /** Calls the shared quota could still fund beyond what this run has reserved. */
  spare(): number
}

export interface ResearchBudgetPool {
  take(phase: ResearchPhase, count: number, knownFutureCalls: number): readonly BudgetSlice[]
  chargeExternalCost(costUsd: number): void
  settle(): void
}

export interface ResearchStages {
  plan(
    input: ResearchPlanningInput,
    budget: BudgetSlice,
    correctionIssues?: readonly string[]
  ): Promise<ResearchChildResult<ResearchPlan>>
  crawl(
    question: ResearchQuestion,
    options: CrawlStageOptions
  ): Promise<ResearchChildResult<ResearchEvidenceBranch>>
  crawlFresh(
    question: ResearchQuestion,
    budget: BudgetSlice
  ): Promise<ResearchChildResult<ResearchEvidenceBranch>>
  classifySubquery(query: string): 'available' | 'duplicate' | 'bound'
  synthesize(
    input: SynthesisInput,
    budget: BudgetSlice,
    correctionIssues?: readonly string[]
  ): Promise<ResearchChildResult<ResearchReportCandidate>>
  review(
    input: ReviewInput,
    budget: BudgetSlice,
    correctionIssues?: readonly string[]
  ): Promise<ResearchChildResult<ResearchReview>>
  dispose(): void
}
