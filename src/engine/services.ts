import type { ResolvedConfig, ResolvedModel } from '@/core/config/resolve'
import type { App, Bind, ServiceProvider } from '@/core/container'
import type { EventBus } from '@/core/events'
import type { AgentId, SessionId } from '@/core/ids'
import type { LLMMessage, ProviderChain } from '@/core/llm'
import type { ToolDefinition } from '@/core/tool'
import type { LLMUsageTotals } from '@/core/types/usage'
import type { AttemptRecorder } from '@/engine/budget/attempt-settlement'
import type { McpSessionLifecycle } from '@/engine/mcp/invoke'
import type { RequestBroker } from '@/engine/mcp/jobs/broker'
import type { McpJobs } from '@/engine/mcp/jobs/jobs'
import type { McpSurface } from '@/engine/mcp/surface'
import type { ResearchCoordinator } from '@/engine/research/contracts'
import type { RunTracker } from '@/engine/run-registry'
import type { SkillCatalog } from '@/engine/skills/catalog'
import type { AgentProfile } from '@/engine/types/agent'
import type {
  CostTracker,
  LLMAttemptSink,
  RateLimiter,
  UnrecordedSpendLog,
} from '@/engine/types/cost'
import type {
  Compactor,
  Hooks,
  McpToolInvoker,
  RunInput,
  Runner,
  ToolExecutor,
} from '@/engine/types/run'
import type { Workflow } from '@/engine/workflows/types'
import { classifyModel } from '@/ai/api'
import { ConfigError } from '@/core/errors'
import { observe } from '@/core/events'
import { toToolSchema } from '@/core/tool'
import { buildBuiltInAgents } from '@/engine/agents/registry'
import { settleCallerAttempt } from '@/engine/budget/attempt-settlement'
import { createCostTracker } from '@/engine/budget/cost-tracker'
import { createUnrecordedSpendLog } from '@/engine/budget/unrecorded-spend'
import { createSummarizingCompactor } from '@/engine/compact/compactor'
import { createSummarizer } from '@/engine/compact/summarizer'
import { MCP_ANSWER_DEADLINE_SHARE, MCP_ANSWER_TIMEOUT_MS } from '@/engine/constants'
import { createRunFinishedEmit } from '@/engine/hooks/after-run'
import { createApprovalGate, createApprovalManager } from '@/engine/hooks/approval'
import { capabilityGate } from '@/engine/hooks/capability'
import { citeCheckHook } from '@/engine/hooks/cite-check'
import { loopDetectorAfterTool, loopDetectorGate } from '@/engine/hooks/loop-detector'
import { responseStyleModifier } from '@/engine/hooks/prompt-blocks'
import { pruneStaleMessagesHook } from '@/engine/hooks/prune-stale'
import { trimResultsHook } from '@/engine/hooks/trim-results'
import { createToolExecutor } from '@/engine/loop/executor'
import { runOnce } from '@/engine/loop/run'
import { assertToolExposureRegistry } from '@/engine/loop/tools/exposure'
import { createMcpToolInvoker } from '@/engine/mcp/invoke'
import { createRequestBroker } from '@/engine/mcp/jobs/broker'
import { createMcpJobs } from '@/engine/mcp/jobs/jobs'
import { createMcpSurface } from '@/engine/mcp/surface'
import { createRateLimiter } from '@/engine/rate-limiter'
import { createResearchCoordinator } from '@/engine/research/coordinator'
import { createRunRegistry } from '@/engine/run-registry'
import { BUILT_IN_WORKFLOWS } from '@/engine/workflows/discover'

// Consumer-side interface: the loop needs the session's prior transcript, but `engine` has no edge to
// `persistence`. It names the shape; the composition root binds an implementation over the session
// store. Unbound = every run starts cold, which is exactly what a one-shot embedder wants.
type SessionHistory = (sessionId: SessionId, limit: number) => Promise<readonly LLMMessage[]>
type AgentForRun = (input: RunInput, fallback: AgentProfile) => AgentProfile

declare module '@/core/container' {
  interface Services {
    sessionHistory: SessionHistory
    priorTotals: (sessionId: SessionId) => Promise<LLMUsageTotals>
    agentSpentToday: (agentId: AgentId, nowMs: number) => Promise<number>
    agentForRun: AgentForRun
    tools: ReadonlyMap<string, ToolDefinition>
    agents: ReadonlyMap<string, AgentProfile>
    hooks: Hooks
    compactor: Compactor
    toolExecutor: ToolExecutor
    mcpSessionLifecycle: McpSessionLifecycle
    mcpToolInvoker: McpToolInvoker
    mcpSurface: McpSurface
    clientModelBroker: RequestBroker
    mcpJobs: McpJobs
    costTracker: CostTracker
    llmAttemptSink: LLMAttemptSink
    unrecordedSpend: UnrecordedSpendLog
    attemptRecorder: AttemptRecorder
    rateLimiter: RateLimiter
    runRegistry: RunTracker
    researchCoordinator: ResearchCoordinator
    workflows: ReadonlyMap<string, Workflow>
    runner: Runner
    skillCatalog: SkillCatalog
  }
}

// `logger`/`bus`/`sessionQueue` (app, steps 0a-0c), `storage` (persistence) and `llm` (ai) are all
// bound before this provider runs — the order in app/providers.ts is load-bearing.
export const engineProvider: ServiceProvider = {
  name: 'engine',
  register(bind: Bind): void {
    // Base maps: `tools` is bound by toolsProvider (step 6) and extended by plugins (10) and mcp (11);
    // `agents` is extended by plugins (10) and the user agents dir (12).
    bind('agents', (app) => buildBuiltInAgents(app.config, [...app.resolve('tools').keys()]))

    bind('hooks', (app) => buildHooks(app.resolve('bus'), app.signal))
    bind('compactor', (app) => buildCompactor(app))
    // `toolServices` holds handles from tools/ that engine cannot name, so only the composition
    // root can assemble it.
    bind('toolExecutor', (app) =>
      createToolExecutor({
        bus: app.resolve('bus'),
        memory: app.resolve('memory'),
        services: app.resolve('toolServices'),
      })
    )
    bindMcpServing(bind)
    // Starts at $0; boot hydrates day/month totals.
    bind('costTracker', (app) =>
      createCostTracker({
        pricing: app.resolve('pricing'),
        maxDailyUsd: app.config.budget.maxDailyUsd,
        maxMonthlyUsd: app.config.budget.maxMonthlyUsd,
        timeZone: app.config.locale.timezone,
      })
    )
    bind('unrecordedSpend', (app) =>
      createUnrecordedSpendLog(app.config.paths.dataDir, app.config.locale.timezone)
    )
    bind('attemptRecorder', (app) => {
      const ledger = {
        costTracker: app.resolve('costTracker'),
        llmAttemptSink: app.resolve('llmAttemptSink'),
        unrecordedSpend: app.resolve('unrecordedSpend'),
        logger: app.resolve('logger'),
      }

      return (identity, attempt) => settleCallerAttempt(ledger, identity, attempt)
    })
    bind('rateLimiter', (app) => createRateLimiter(app.config.llm.maxCallsPerMinute))
    bind('runRegistry', () => createRunRegistry())
    bind('researchCoordinator', (app) =>
      createResearchCoordinator({
        config: app.config,
        runner: { run: (input, options) => app.resolve('runner').run(input, options) },
        logger: app.resolve('logger'),
        retrieval: app.resolve('webRetrieval'),
      })
    )
    bind('workflows', () => new Map(BUILT_IN_WORKFLOWS.map((wf) => [wf.id, wf])))

    bind('runner', (app) => buildRunner(app))
  },
}

/** Everything `mcp serve` runs on: the invoker, the surface it serves, and the jobs and broker
 *  that let the client's model answer. */
function bindMcpServing(bind: Bind): void {
  bind('mcpToolInvoker', (app) =>
    createMcpToolInvoker({
      run: buildRunDeps(app),
      sessionQueue: app.resolve('sessionQueue'),
      sessionLifecycle: app.resolve('mcpSessionLifecycle'),
    })
  )
  bind('mcpSurface', (app) =>
    createMcpSurface({
      tools: app.resolve('tools'),
      agents: app.resolve('agents'),
      invoker: app.resolve('mcpToolInvoker'),
      catalog: app.resolve('skillCatalog'),
      signal: app.signal,
    })
  )
  bind('clientModelBroker', () => createRequestBroker())
  bind('mcpJobs', (app) =>
    createMcpJobs({
      surface: app.resolve('mcpSurface'),
      broker: app.resolve('clientModelBroker'),
      logger: app.resolve('logger'),
      answerTimeoutMs: Math.min(
        MCP_ANSWER_TIMEOUT_MS,
        Math.floor(app.config.loop.maxDurationMs * MCP_ANSWER_DEADLINE_SHARE)
      ),
    })
  )
}

// The only resolve site in the hot path's construction: every dependency is captured once here, so
// `run()` never touches the container again.
function buildRunner(app: App): Runner {
  const deps = buildRunDeps(app)

  return { run: (input, options) => runOnce(deps, input, options) }
}

function buildRunDeps(app: App) {
  return {
    ...(app.has('sessionHistory') ? { history: app.resolve('sessionHistory') } : {}),
    ...(app.has('priorTotals') ? { priorTotals: app.resolve('priorTotals') } : {}),
    ...(app.has('agentPauseStore') ? { agentPauses: app.resolve('agentPauseStore') } : {}),
    ...(app.has('agentSpentToday') ? { agentSpentToday: app.resolve('agentSpentToday') } : {}),
    ...(app.has('agentForRun') ? { agentForRun: app.resolve('agentForRun') } : {}),
    agents: app.resolve('agents'),
    tools: compileToolRegistry(app.resolve('tools')),
    chains: app.resolve('llmChains'),
    hooks: app.resolve('hooks'),
    compactor: app.resolve('compactor'),
    executor: app.resolve('toolExecutor'),
    costTracker: app.resolve('costTracker'),
    llmAttemptSink: app.resolve('llmAttemptSink'),
    unrecordedSpend: app.resolve('unrecordedSpend'),
    pricing: app.resolve('pricing'),
    rateLimiter: app.resolve('rateLimiter'),
    logger: app.resolve('logger'),
    bus: app.resolve('bus'),
    registry: app.resolve('runRegistry'),
    config: app.config,
    childEnvBase: app.resolve('childEnvBase'),
    shutdownSignal: app.signal,
  }
}

function compileToolRegistry(
  tools: ReadonlyMap<string, ToolDefinition>
): ReadonlyMap<string, ToolDefinition> {
  assertToolExposureRegistry(tools)

  const compiled = new Map<string, ToolDefinition>()

  for (const [name, tool] of tools) {
    try {
      const schema = toToolSchema(tool)
      compiled.set(name, { ...tool, jsonSchema: schema.parameters })
    } catch (err: unknown) {
      throw new ConfigError(`tool '${name}' has an invalid input schema`, err)
    }
  }

  return compiled
}

function buildHooks(bus: EventBus, signal: AbortSignal): Hooks {
  const manager = createApprovalManager()

  observe(bus, 'session_ended', { signal, fn: ({ sessionId }) => manager.clearSession(sessionId) })

  return {
    beforeRun: [],
    beforeLLM: [pruneStaleMessagesHook],
    llmRequestModifiers: [responseStyleModifier],
    afterLLM: [],
    toolAdmission: [loopDetectorGate, capabilityGate],
    approvalGate: createApprovalGate({ bus, manager }),
    afterTool: [trimResultsHook, loopDetectorAfterTool],
    afterTurn: [citeCheckHook],
    beforeFinalize: [],
    afterRun: [createRunFinishedEmit(bus)],
  }
}

function buildCompactor(app: App): Compactor {
  const selected = summaryModelFor(app.config)
  const chain: ProviderChain = app.resolve('llmChains').primary
  const summaryModel = { provider: selected.provider, model: selected.model }

  return createSummarizingCompactor({
    summarizer: createSummarizer(chain, summaryModel),
  })
}

function summaryModelFor(config: ResolvedConfig): ResolvedModel {
  const fast = config.models.find((entry) => classifyModel(entry.model).tier === 'fast')

  if (fast !== undefined) {
    return fast
  }

  const primary = config.models[0]

  if (primary === undefined) {
    throw new ConfigError('no models configured')
  }

  return primary
}
