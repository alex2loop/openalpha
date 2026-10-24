// Public API of engine/. Other modules import from here — never from engine/ internals.

export type { ResearchDepth } from '@/core/config/resolve'
export type {
  AgentBuildContext,
  AgentReferenceIssuesInput,
} from '@/engine/agents/builder'
export type {
  AgentCapabilities,
  AgentDefinition,
  AgentDefinitionContext,
} from '@/engine/agents/define'
export type { BuildUserAgentsDeps, UserAgentSource } from '@/engine/agents/user'
export type { AttemptIdentity, AttemptRecorder } from '@/engine/budget/attempt-settlement'
export type { RunProgressMessage } from '@/engine/events'
export type { ApprovalManager } from '@/engine/hooks/approval'
export type { SessionPersistenceHooks, SessionSink } from '@/engine/hooks/persistence'
export type { UserPreferencesHooks } from '@/engine/hooks/user-preferences'
export type { TodoStatus, TodoStep } from '@/engine/loop/todo'
export type { McpConnection } from '@/engine/mcp/connect'
export type { McpSessionLifecycle, McpToolInvokerDeps } from '@/engine/mcp/invoke'
export type { McpJobs } from '@/engine/mcp/jobs/jobs'
export type { McpJobRefusal, McpJobReply } from '@/engine/mcp/jobs/types'
export type { AdvertisedTool } from '@/engine/mcp/serve-core'
export type {
  McpSurface,
  McpSurfaceDeps,
} from '@/engine/mcp/surface'
export type {
  ForegroundResearchInteraction,
  ResearchCoordinator,
  ResearchEvidenceLevel,
  ResearchFailure,
  ResearchFailureCode,
  ResearchInvocation,
  ResearchParent,
  ResearchPhase,
  ResearchPlanDecision,
  ResearchPlanLimitBase,
  ResearchPlanLimits,
  ResearchPlanReview,
  ResearchRequest,
  ResearchResult,
  ReviewDimension,
  ReviewResearchPlan,
} from '@/engine/research/contracts'
export type {
  ResearchIssueGroup,
  ResearchIssueKind,
  ResearchIssueSummary,
  ResearchProgress,
  ResearchTotalsProgress,
  ResearchWarningCode,
} from '@/engine/research/events'
export type {
  ProviderHighlight,
  ResearchFreshness,
} from '@/engine/research/evidence/model'
export type { ResearchPlan } from '@/engine/research/evidence/schemas'
export type {
  ResearchContentsFailure,
  ResearchContentsInput,
  ResearchContentsItem,
  ResearchContentsOutcome,
  ResearchDirectFetchAttempt,
  ResearchDirectFetchInput,
  ResearchDirectFetchOutcome,
  ResearchProviderAttempt,
  ResearchProviderFailureCode,
  ResearchRetrieval,
  ResearchRetrievalCall,
  ResearchSearchInput,
  ResearchSearchOutcome,
  ResearchSearchResult,
} from '@/engine/research/retrieval/retrieval'
export type { RunTracker } from '@/engine/run-registry'
export type { SkillCatalog } from '@/engine/skills/catalog'
export type { SkillMeta } from '@/engine/skills/types'
export type { Trust, Verdict } from '@/engine/skills/validate'
export type { AgentProfile, AgentRegistry } from '@/engine/types/agent'
export type {
  ApprovalAnswer,
  ApprovalDecision,
  ApprovalRequestInput,
  ApprovalScope,
  ToolApproval,
  ToolApprovalStatus,
} from '@/engine/types/approval'
export type {
  Budget,
  BudgetSlice,
  CostTracker,
  RateLimiter,
  RateLimitKey,
  UnrecordedSpend,
  UnrecordedSpendLoad,
} from '@/engine/types/cost'
export type {
  AfterLLMHook,
  AfterRunHook,
  AfterToolHook,
  ApprovalGate,
  Compactor,
  HookFn,
  Hooks,
  LLMRequestModifier,
  McpToolInvocation,
  McpToolInvoker,
  ParentLink,
  PreparedToolCall,
  ResolvedRunLimits,
  RunEnv,
  RunHandle,
  RunIdentity,
  RunInput,
  RunLifecycle,
  Runner,
  RunOptions,
  RunRegistry,
  RunResult,
  RunServices,
  RunState,
  RunView,
  ToolExecutor,
  ToolExposure,
  ToolGate,
  ToolGateResult,
  ToolPreparation,
} from '@/engine/types/run'
export type { RunOnceDeps, RunOnceOptions } from '@/engine/types/run-deps'
export type { WorkflowInvocation, WorkflowRunDeps, WorkflowStop } from '@/engine/workflows/run'
export type { Workflow, WorkflowContext, WorkflowStep } from '@/engine/workflows/types'
export type {
  WorkspaceCleanupAgentResult,
  WorkspaceCleanupPlan,
  WorkspaceCleanupResult,
  WorkspaceCleanupScope,
} from '@/engine/workspace/types'
export {
  assertAgentTomlMatchesSourceId,
  assertValidAgentToml,
  collectAgentReferenceIssues,
  isValidAgentId,
  loadAgentFromText,
  RESERVED_AGENT_IDS,
} from '@/engine/agents/builder'
export { buildAgentDefinition, createAgent } from '@/engine/agents/define'
export { DEEP_RESEARCHER_ID } from '@/engine/agents/registry'
export { buildUserAgents, readUserAgents, userAgentFile, userAgentsDir } from '@/engine/agents/user'
export { createDelegationQuota } from '@/engine/budget/delegation-quota'
export { createBudget, createConfiguredRunBudget } from '@/engine/budget/run-budget'
export { createBudgetSlicesWithin } from '@/engine/budget/slices'
export {
  AGENT_BUDGET_FRACTION,
  DELEGATE_MODEL_TIER,
  MAX_SPAWN_PER_AGENT,
  MCP_CALL_WAIT_MS,
  RUN_LEASE_SLACK_MS,
  RUN_TITLE_MAX_CHARS,
  SPAWN_TOOL_NAME,
  WORKSPACES_DIR_NAME,
} from '@/engine/constants'
export { createDelegatedApproval, decisionsFor } from '@/engine/hooks/approval'
export { createAvailableDelegatesModifier } from '@/engine/hooks/available-delegates'
export { createAvailableSkillsModifier } from '@/engine/hooks/available-skills'
export { canRequireApproval } from '@/engine/hooks/dangerous'
export { createSessionPersistenceHooks } from '@/engine/hooks/persistence'
export { languageName, reminderModifier } from '@/engine/hooks/prompt-blocks'
export { appendSystemBlock } from '@/engine/hooks/system-block'
export { createUserPreferencesHooks } from '@/engine/hooks/user-preferences'
export { HALT_CODE_TO_REASON } from '@/engine/loop/finalize'
export { isSpendCapHalt, PAUSED_MESSAGE } from '@/engine/loop/preflight'
export {
  formatTodoBlock,
  TODO_GLYPHS,
  todoChecklistOf,
  toPlanSteps,
  toTodoSteps,
} from '@/engine/loop/todo'
export { isToolDetailComplete, TOOL_DETAIL_MAX_LENGTH } from '@/engine/loop/tools/presentation'
export { connectServer } from '@/engine/mcp/connect'
export {
  ANALYST_AGENT_NAME,
  ANSWERED_REPLY_KIND,
  FINISHED_REPLY_KIND,
  MODEL_ANSWER_INPUT,
  MODEL_ANSWER_TOOL,
  MODEL_REQUEST_VIEW_INPUT,
  MODEL_REQUEST_VIEW_TOOL,
  MODEL_RESUME_INPUT,
  MODEL_RESUME_TOOL,
  MODEL_TOOLS,
  REQUESTS_REPLY_KIND,
  WORKING_REPLY_KIND,
} from '@/engine/mcp/jobs/tools'
export { toAdvertisedTools } from '@/engine/mcp/serve-core'
export { buildHostSkill } from '@/engine/mcp/skill'
export { toAgentResearchResult } from '@/engine/research/agent-result'
export { RESEARCH_QUERY_MAX_CHARS } from '@/engine/research/contracts'
export { toResearchIssueGroups } from '@/engine/research/display/issue-summary'
export {
  RESEARCH_FRESHNESS_FIELD_KEYS,
  toResearchQuestionProgressDisplay,
  toResearchResultDisplay,
  toResearchStageDisplay,
  toResearchStartDisplay,
  toResearchTotalsDisplays,
  toResearchWarningDisplay,
} from '@/engine/research/display/progress'
export { parseResearchJson, toResearchOutputContract } from '@/engine/research/evidence/parse'
export { composeAbort, TIMEOUT_ABORT } from '@/engine/run-registry'
export { engineProvider } from '@/engine/services'
export { resolveSkillPlatform } from '@/engine/skills/availability'
export { createSkillCatalog } from '@/engine/skills/catalog'
export { ensureSkillsDirectory, resolveSkillsDir } from '@/engine/skills/dirs'
export { parseFrontmatter } from '@/engine/skills/frontmatter'
export { readSkillMeta, readSkillName, toSkillBody } from '@/engine/skills/load'
export { readLock, resolveLockPath, writeLock } from '@/engine/skills/lockfile'
export { evaluateSkillContent, isAllowed } from '@/engine/skills/validate'
export { APPROVAL_DECISIONS } from '@/engine/types/approval'
export { critical, isRetryableHalt } from '@/engine/types/run'
export { addWorkflow, loadUserWorkflows, loadWorkflowToml } from '@/engine/workflows/discover'
export { runWorkflow, startScheduledWorkflows } from '@/engine/workflows/run'
export {
  applyWorkspaceScratchCleanup,
  planWorkspaceScratchCleanup,
  pruneExpiredWorkspaceTmp,
} from '@/engine/workspace/cleanup'
