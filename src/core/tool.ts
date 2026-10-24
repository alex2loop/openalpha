import { type ZodType, z } from 'zod'

import type { ChannelId } from '@/core/channels'
import type { ResolvedConfig } from '@/core/config/resolve'
import type { EventBus } from '@/core/events'
import type { AgentId, RunId, SessionId, UserId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import type { WorkspaceIdentity } from '@/core/security/path-policy'
import type { DisplayText, ProgressMessage, ToolLifecycleOwner } from '@/core/stream-events'
import type { Budget } from '@/core/types/budget'
import type { Exact } from '@/core/types/exact'
import type { Locale } from '@/core/types/locale'
import type { Memory } from '@/core/types/memory'
import type { ExternalCharge, LLMUsageTotals } from '@/core/types/usage'
import { type ToolErrorCode, ValidationError } from '@/core/errors'
import { isPlainRecord } from '@/core/utils/collections'

const EXAMPLES_HEADING = 'Examples of valid input:'

// Safe capabilities do not require approval; dangerous ones follow the active run's policy.
export type Capability = 'read' | 'net' | 'memory' | 'schedule' | 'delegate' | 'write' | 'shell'

// Whether this run can ask a human at all, and how. Declared here rather than in engine so a tool
// that must refuse to act unasked can read it off its own context.
export type ApprovalMode = 'manual' | 'bypass' | 'unavailable'

// Who reads a tool's `content`. An agent sees relative figures only; the operator - an MCP client
// acting for them, with no other channel to reach them - also sees the order quantities a trade
// needs, never the book's money.
export type ToolAudience = 'agent' | 'operator'

// A cumulative byte allowance for one run. `charge` throws once the run's total is exhausted.
export interface ByteBudget {
  charge(bytes: number): void
}

// One quota shared by the whole run tree. Reserve is atomic and non-refundable: a rejected or
// failed child does not return its allocation because the cap bounds total fan-out work.
export interface DelegationQuota {
  remaining(): number
  reserve(count: number): void
  /** Spawned child agents working now across the run tree: started and not yet released. */
  openChildren(): number
  /** Counts one spawned child as working. The release it returns is safe to call twice. */
  trackChild(): () => void
}

// Declaration-merging slot for the service handles tools need that core cannot name: `tools/`
// owns them and augments this interface (`agents`/`runner` from engine, plus its own
// consumer-declared interfaces). The engine's executor passes an opaque value straight through, so
// `core → engine` and `core → tools` edges never appear.
// biome-ignore lint/suspicious/noEmptyInterface: declaration-merging target for tool-contributed services
export interface ToolServices {}

// The duration cap measures agent work, so it stops while the run waits on a human. Idempotent.
export interface RunDeadline {
  pause(): void
  resume(): void
}

export interface ToolInvocationContext {
  readonly userId: UserId
  readonly agentId: AgentId
  readonly sessionId: SessionId
  /** Session linked to this run's LLM attempts; null when no durable session owns them. */
  readonly billingSessionId: SessionId | null
  /** The agent whose daily cap this call's spend counts against; a delegate it starts inherits it. */
  readonly billingAgentId: AgentId
  readonly runId: RunId
  /** Whether the engine's gate will ask anyone about this call. A tool whose effect is irreversible
   *  outside this process refuses under `bypass` rather than assuming consent. */
  readonly approvalMode: ApprovalMode
  readonly audience: ToolAudience
  /** The provider's id for this exact tool call. Paired with `runId` it is the only durable
   *  idempotency identity a tool may use: the model never supplies one and cannot forge it. */
  readonly callId: string
  readonly chatId?: string
  readonly channel: ChannelId
  readonly signal: AbortSignal
  readonly logger: Logger
  readonly locale: Locale
  readonly config: ResolvedConfig
  readonly workspace: WorkspaceIdentity
  /** Prepared canonical cwd for shell execution; it is not OS-level confinement. */
  readonly workspaceDir: string
  /** Frozen env for delegated/shell children: boot allowlist plus per-run HOME/TMPDIR/TEMP. */
  readonly childEnv: Readonly<Record<string, string>>
  // 0 = top-level turn; >0 = inside a delegated child.
  readonly callDepth: number
  readonly delegationChain: readonly AgentId[]
  readonly memory: Memory
  readonly bus: EventBus
  // The run's shared slice: a child run charges the same object, so no folding is needed.
  readonly budget: Budget
  readonly skillViewBudget: ByteBudget
  readonly services: ToolServices
  /** The run's duration clock; tools pause it while they wait on a human. */
  readonly deadline: RunDeadline
  /** The run's resolved duration cap, for tools that surface their own limits. */
  readonly maxDurationMs: number
  /** Shared run-tree fan-out quota; absent only when the tool is invoked outside a run. */
  readonly delegationQuota?: DelegationQuota
  /** Merge a delegated child's cumulative usage into the current run's live totals. */
  readonly addDelegatedUsage?: (totals: LLMUsageTotals) => void
  /** Record a billed non-LLM provider call without charging the root budget. */
  readonly addExternalCost: (charge: ExternalCharge) => Promise<void>
  /** Record a billed non-LLM provider call, then charge the shared budget. */
  readonly recordExternalCost: (charge: ExternalCharge) => Promise<void>
  /** Report a sparse progress milestone to the parent surface. Synchronous and non-throwing. */
  readonly reportProgress?: (message: ProgressMessage) => void
}

export interface ToolResult {
  readonly content: string
  readonly isError: boolean
  readonly errorCode?: ToolErrorCode
  readonly caveats?: readonly string[]
  readonly display?: DisplayText
}

/** What a call-level approval check knows about the run: how many calls of this tool it has made,
 *  this one included, and whether text came from the operator or a network tool rather than from
 *  the model itself. */
export interface CallApprovalContext {
  readonly config: ResolvedConfig
  readonly callCount: number
  hasSeen(text: string): boolean
}

export interface ToolCall {
  readonly id: string
  readonly name: string
  readonly input: unknown
}

interface ToolPresentation<I> {
  readonly label?: string
  readonly emoji?: string
  readonly detailKeys?: readonly string[]
  /** Renders the call's arguments in the operator's locale. Wins over `detailKeys`, which can
   *  only stringify an object value. */
  detail?(input: I, locale: Locale): string | undefined
  readonly lifecycleOwner?: ToolLifecycleOwner
}

export interface ToolDefinition<I = unknown> {
  readonly name: string
  readonly description: string
  readonly inputSchema: ZodType<I>
  readonly capability: Capability
  /** Expose this tool's schema eagerly when the catalog is large enough to defer other tools. */
  readonly eager?: true
  // Call-level danger beyond the static capability. Receives normalized, schema-valid input so a
  // read-capable tool such as schedule can still gate its write operations.
  readonly requiresApproval?: (input: unknown, context: CallApprovalContext) => boolean
  // No remember arm is offered for this tool: a decision the operator made about one call must
  // never stand for the next. Distinct from `requiresApproval`, which decides whether to ask.
  readonly oneTimeApproval?: true
  // Supplied by a source outside this codebase (an MCP server, an untrusted plugin). Subject to
  // the active approval policy like a dangerous capability, whatever its declared capability is.
  readonly isExternal?: boolean
  // Advertised to the model verbatim when set, instead of deriving one from inputSchema. MCP
  // servers own their arg schema; re-deriving it from a passthrough zod type would erase it.
  readonly jsonSchema?: Record<string, unknown>
  /** Worked inputs, each valid against `inputSchema`, shown to the model beside the schema. Only for
   *  a tool whose shape a model gets wrong without one: a union arm, a wall-clock string, a nested
   *  object. Plain records rather than `I`, because most tool inputs carry branded fields a literal
   *  cannot satisfy without a cast; `createTool` parses every example against the schema instead, so
   *  a wrong one fails boot with the tool and index named. */
  readonly inputExamples?: readonly Record<string, unknown>[]
  // Descriptive only: approval continues to depend exclusively on capability, requiresApproval,
  // and isExternal. Surfaces never inspect raw tool args; the engine resolves this once.
  readonly presentation?: ToolPresentation<I>
  // One-line summary for friendly display. Receives the final content after
  // the output pipeline (scrubbed/compacted) but without the model-facing <tool_result> envelope.
  // Returns undefined to omit the summary. Surfaces never parse tool output. A keyed message is
  // localized by the surface; a plain string passes through verbatim.
  readonly summarizeResult?: (content: string) => DisplayText | undefined
  /** Cooperative per-call cap in ms. The executor composes it with the run signal and fails the
   *  call with a `timeout` ToolError; a tool that ignores its signal keeps running detached. */
  readonly timeoutMs?: number
  /** Optional shape of successful string output (post-parse). Mismatches are logged, never fatal:
   *  drift detection, not a gate. */
  readonly outputSchema?: ZodType<unknown>
  execute(input: I, ctx: ToolInvocationContext): Promise<string | ToolResult>
}

export interface ToolSchema {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly examples?: readonly Record<string, unknown>[]
}

// Convert once at registry/build time; MCP tools supply their own schema, built-in/plugin tools
// derive it from the Zod input schema.
export function toToolSchema(def: ToolDefinition): ToolSchema {
  return {
    name: def.name,
    description: def.description,
    parameters: def.jsonSchema ?? toToolParameters(def.inputSchema),
    ...(def.inputExamples === undefined ? {} : { examples: def.inputExamples }),
  }
}

/** The description with examples appended, for a wire that has no examples field of its own. */
export function describeWithExamples(schema: ToolSchema): string {
  if (schema.examples === undefined || schema.examples.length === 0) {
    return schema.description
  }

  const lines = schema.examples.map((example) => JSON.stringify(example))

  return `${schema.description}\n${EXAMPLES_HEADING}\n${lines.join('\n')}`
}

// Patterns are validated locally by Zod; routed provider validators need not agree on regex support.
export function toToolParameters<I>(inputSchema: ZodType<I>): Record<string, unknown> {
  const stripped = stripPatterns(z.toJSONSchema(inputSchema, { io: 'input' }))

  // why-safe: z.toJSONSchema always returns a plain object, and the strip preserves every node's
  // shape — it only ever drops `pattern` keys.
  return stripped as Record<string, unknown>
}

function stripPatterns(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripPatterns)
  }

  if (!isPlainRecord(value)) {
    return value
  }

  const out: Record<string, unknown> = {}

  for (const [key, child] of Object.entries(value)) {
    if (key === 'pattern') {
      continue
    }

    out[key] = stripPatterns(child)
  }

  return out
}

// Near-identity factory — exists so I infers from inputSchema into execute. The engine's
// executor (not this factory) normalizes string → ToolResult and runs OutputPipeline. `Exact`
// rejects unknown keys for TypeScript callers; the runtime guards protect JavaScript callers.
export function createTool<I>(def: Exact<ToolDefinition<I>, ToolDefinition<I>>): ToolDefinition<I> {
  if (typeof def.name !== 'string' || def.name.trim() === '') {
    throw new ValidationError('tool name must not be empty')
  }

  if (typeof def.description !== 'string' || def.description.trim() === '') {
    throw new ValidationError(`tool ${def.name}: description must not be empty`)
  }

  for (const [index, example] of (def.inputExamples ?? []).entries()) {
    if (!def.inputSchema.safeParse(example).success) {
      throw new ValidationError(
        `tool ${def.name}: input example ${index} does not satisfy its schema`
      )
    }
  }

  return def
}
