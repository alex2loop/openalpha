import type { HaltCode } from '@/core/errors'
import type { Capability } from '@/core/tool'
import type { RunResultReason } from '@/core/types/run'

export const USER_MESSAGE_MAX_BYTES = 100_000
// Per-agent sandbox root under the data dir; every fs tool resolves relative to it.
export const WORKSPACES_DIR_NAME = 'workspaces'
export const SKILL_VIEW_RUN_BUDGET_BYTES = 262_144
export const CONTEXT_OVERFLOW_PROBE_STEPS = [128_000, 64_000, 32_000, 16_000] as const
export const MIN_PER_RUN_BUDGET_USD = 0.001
// Share of a parent's remaining budget that child runs may spend. The held-back remainder is what
// the parent uses to read the children's results and answer; without it the last child to finish
// leaves the parent unable to say anything.
export const AGENT_BUDGET_FRACTION = 0.85
// Falls back to the primary chain when `[model_tiers]` omits it.
export const DELEGATE_MODEL_TIER = 'delegate'
export const DEFAULT_CONTEXT_WINDOW = 200_000
// Assistant/tool exchanges (plus user messages) kept verbatim; a group is the unit because a single
// user message can drive hundreds of tool exchanges that a user-message window would never shrink.
export const COMPACT_KEEP_RECENT_GROUPS = 10
// Opens every compaction summary message; also how citation trust recognizes it as model prose.
export const COMPACT_SUMMARY_PREAMBLE =
  '[CONTEXT SUMMARY - older messages removed to free context window]\n\n'
export const COMPACT_SUMMARY_MAX_TOKENS = 512
// Replaces a stale tool result's body during compaction. Kept as a recognizable marker so a
// second pass never re-elides and the model knows the data existed.
export const COMPACT_ELIDED_TOOL_RESULT = '[tool result elided to free context]'
// Fresh-turn retries after a provider died mid-stream with output already shown. Each restart
// re-bills the full prompt, so this stays small.
export const MAX_VISIBLE_OUTPUT_RESTARTS = 2
export const LOOP_DETECTOR_WINDOW = 20
export const LOOP_DETECTOR_MATCHES = 3
export const LOOP_DETECTOR_NEAR_DUP_SIMILARITY = 0.55
export const LOOP_DETECTOR_MIN_FUZZY_WORDS = 4
// Grace past a run's own duration cap before a lease it stopped renewing is treated as abandoned.
export const RUN_LEASE_SLACK_MS = 300_000
/** Longest title a run announces on the bus: enough to recognise the request, short enough to scan. */
export const RUN_TITLE_MAX_CHARS = 120
/** Longest answer excerpt a finished child run announces on the bus. */
export const CHILD_SUMMARY_MAX_CHARS = 500
/** Most child agents one agent may have working at once; `max_spawn` in its file sets its own. */
export const MAX_SPAWN_PER_AGENT = 4
export const RATE_LIMIT_WINDOW_MS = 60_000
export const RATE_LIMIT_MAX_KEYS = 4_096
/** Fits the largest first-party payload - a market overview or a suggestion - whole in a chat run. */
export const TOOL_RESULT_MAX_BYTES = 32_768
export const MCP_DISCOVERY_TIMEOUT_MS = 5_000
export const MCP_CALL_TIMEOUT_MS = 60_000
/** Minimum gap between two reconnect attempts to one MCP server, success or failure. */
export const MCP_RECONNECT_COOLDOWN_MS = 30_000
/** A served call may wait on the client's own model writing a whole debate. The client can always
 *  cancel earlier - its abort travels on the request signal. */
export const MCP_SERVE_CALL_TIMEOUT_MS = 3_600_000
/** Under the 60-second tool-call limit most MCP clients enforce; past it the call returns
 *  `working` and the client polls. */
export const MCP_CALL_WAIT_MS = 45_000
/** The client owns its context: served results stay whole, under Claude Code's default 25k-token cap. */
export const MCP_TOOL_RESULT_MAX_BYTES = 65_536
export const MCP_ANSWER_TIMEOUT_MS = 600_000
/** Share of `[loop] max_duration_ms` the answer wait may use, so a job expires before the waiting
 *  role's own deadline turns it into a degraded debate. */
export const MCP_ANSWER_DEADLINE_SHARE = 0.9
export const MCP_MAX_TOOLS = 256
export const MCP_MAX_TOOL_PAGES = 64
export const MCP_MAX_TOOL_SCHEMA_BYTES = 32_768
export const MCP_MAX_TOOL_DESCRIPTION_BYTES = 4_096
export const WORKFLOW_TICK_MS = 30_000
export const MAX_WORKFLOW_STEPS = 50
export const WORKFLOW_STEP_ATTEMPTS = 3
export const WORKFLOW_STEP_RETRY_BASE_MS = 2_000
export const APPROVAL_ARGS_PREVIEW_CHARS = 2_000
export const MAX_TRACKED_APPROVAL_SESSIONS = 1_024
export const APPROVAL_DEFAULT_DENIAL =
  'Denied by the user. Do not retry this action - ask the user what they would like to change instead.'

// A tool declaring one of these is forced through the approval gate, so widening this set silently
// widens what runs without the user seeing it.
export const DANGEROUS_CAPABILITIES: ReadonlySet<Capability> = new Set(['write', 'shell'])

// `budget` is absent: a re-run gets a fresh per-run budget, so retrying would just spend again.
export const RETRYABLE_REASONS: ReadonlySet<RunResultReason> = new Set(['error', 'timeout'])

// An `error` ending that the identical request will reproduce. `rate` is one: the limiter halts
// rather than waiting, and its window outlasts the retry backoff.
export const NON_TRANSIENT_HALT_CODES: ReadonlySet<HaltCode> = new Set([
  'length_limit',
  'hook_failed',
  'content_filter',
  'rate',
  'agent_paused',
])
