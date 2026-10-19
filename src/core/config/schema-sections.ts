import { z } from 'zod'

import { PROVIDER_SORTS } from '@/core/llm'
import { MAX_TIMER_MS } from '@/core/utils/time'

const timerMs = z.number().int().positive().max(MAX_TIMER_MS)
const MODEL_ALIAS_PATTERN = /^\S+$/
const MODEL_TIER_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/
export const WEB_SEARCH_PROVIDERS = [
  'duckduckgo',
  'anysearch',
  'brave',
  'deepseek',
  'exa',
  'serper',
  'tavily',
  'searxng',
] as const

// Exa Search `type` values. Kept beside WEB_SEARCH_PROVIDERS so the strict schema and the
// resolved type derive from one registry without a config import cycle.
export const EXA_SEARCH_TYPES = [
  'auto',
  'fast',
  'instant',
  'deep-lite',
  'deep',
  'deep-reasoning',
] as const

export type ExaSearchType = (typeof EXA_SEARCH_TYPES)[number]

// Shared by an entry and [model_defaults]; the entry wins.
const ModelTuningFields = {
  reasoning: z.enum(['default', 'off', 'low', 'medium', 'high']).optional(),
  max_tokens: z.int().positive().optional(),
  provider_sort: z.enum(PROVIDER_SORTS).optional(),
  // Router endpoint slugs, as OpenRouter's `provider.only` / `provider.order` name them.
  provider_only: z.array(z.string().min(1)).min(1).optional(),
  provider_order: z.array(z.string().min(1)).min(1).optional(),
  provider_allow_fallbacks: z.boolean().optional(),
  ttft_timeout_ms: timerMs.optional(),
  stream_idle_timeout_ms: timerMs.optional(),
}

// provider/api_key_env may come from [model_defaults]; resolve enforces presence after the merge.
export const ModelSchema = z.strictObject({
  provider: z.string().min(1).optional(),
  model: z.string().min(1),
  alias: z.string().regex(MODEL_ALIAS_PATTERN).optional(),
  api_key_env: z.string().min(1).optional(),
  base_url: z.url().optional(),
  // USD per million tokens; explicit 0 = genuinely free (local models).
  cost_input_per_m: z.number().nonnegative().optional(),
  cost_output_per_m: z.number().nonnegative().optional(),
  cost_cache_read_per_m: z.number().nonnegative().optional(),
  cost_cache_write_per_m: z.number().nonnegative().optional(),
  // Endpoints that mandate reasoning reject a disable payload outright (OpenRouter answers 400).
  // A router provider cannot infer this from the model name, so the entry declares it.
  reasoning_required: z.boolean().optional(),
  ...ModelTuningFields,
})

export const ModelDefaultsSchema = z.strictObject({
  provider: z.string().min(1).optional(),
  api_key_env: z.string().min(1).optional(),
  base_url: z.url().optional(),
  ...ModelTuningFields,
})

export const BudgetSchema = z.strictObject({
  max_daily_usd: z.number().nonnegative().optional(),
  max_monthly_usd: z.number().nonnegative().optional(),
  soft_warn_ratio: z.number().min(0).max(1).optional(),
  max_per_run_usd: z.number().nonnegative().optional(),
})

export const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/

export const LocaleSchema = z.strictObject({
  language: z.enum(['en', 'vi']).optional(),
  timezone: z.string().min(1).optional(),
  // ISO 4217 code and lowercase region tag — locale attributes (Intl vocabulary); domains that
  // need branded forms parse these at their own edge.
  currency: z.string().regex(CURRENCY_CODE_PATTERN).optional(),
  region: z.string().min(1).optional(),
})

export const PathsSchema = z.strictObject({
  data_dir: z.string().min(1).optional(),
  skills_dirs: z.array(z.string().min(1)).optional(),
})

export const LogSchema = z.strictObject({
  level: z.enum(['debug', 'info', 'warn', 'error', 'fatal']).optional(),
  file: z.string().min(1).optional(),
  max_file_mb: z.number().positive().optional(),
  max_files: z.number().int().positive().optional(),
})

export const ScheduleSchema = z.strictObject({
  approval_timeout_ms: timerMs.optional(),
  /** `<channel>:<chatId>` — where "job disabled after N failures" goes. */
  failure_target: z.string().min(1).optional(),
})

export const LoopSchema = z.strictObject({
  max_turns: z.number().int().positive().optional(),
  max_tool_calls: z.number().int().positive().optional(),
  max_duration_ms: timerMs.optional(),
  approval_timeout_ms: timerMs.optional(),
  delegation_depth: z.number().int().positive().optional(),
  max_delegations: z.number().int().positive().optional(),
  max_parallel_delegations: z.number().int().positive().optional(),
})

export const LlmSchema = z.strictObject({
  max_calls_per_minute: z.number().int().positive().optional(),
})

export const MemorySchema = z.strictObject({
  ttl_days: z.number().int().positive().optional(),
})

export const PluginsSchema = z.strictObject({
  dirs: z.array(z.string().min(1)).optional(),
  allow_untrusted: z.boolean().optional(),
  allow_code: z.boolean().optional(),
})

export const ModelTiersSchema = z.record(
  z.string().regex(MODEL_TIER_NAME_PATTERN),
  z.array(ModelSchema).min(1)
)
export const WebSearchSchema = z.strictObject({
  provider: z.enum(WEB_SEARCH_PROVIDERS).optional(),
  api_key_env: z.string().min(1).optional(),
  base_url: z.url().optional(),
  fallback_provider: z.enum(WEB_SEARCH_PROVIDERS).optional(),
  fallback_api_key_env: z.string().min(1).optional(),
  fallback_base_url: z.url().optional(),
  cost_per_search_usd: z.number().nonnegative().optional(),
  fallback_cost_per_search_usd: z.number().nonnegative().optional(),
  cache_ttl_seconds: z.number().int().nonnegative().optional(),
  exa_search_type: z.enum(EXA_SEARCH_TYPES).optional(),
  safe_search: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
})

const McpStdioServerSchema = z.strictObject({
  name: z.string().min(1),
  transport: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
})

const McpHttpServerSchema = z.strictObject({
  name: z.string().min(1),
  transport: z.literal('http'),
  url: z.string().min(1),
  enabled: z.boolean().optional(),
})

const McpServerSchema = z.discriminatedUnion('transport', [
  McpStdioServerSchema,
  McpHttpServerSchema,
])

export const McpSchema = z.strictObject({
  servers: z.array(McpServerSchema).optional(),
})

export const RetentionSchema = z.strictObject({
  days: z.number().int().positive().optional(),
  inbox_days: z.number().int().positive().optional(),
  daily_backups: z.number().int().nonnegative().optional(),
})

export const UpdateSchema = z.strictObject({
  check: z.boolean().optional(),
  auto: z.boolean().optional(),
})

export const ApiSchema = z.strictObject({
  enabled: z.boolean().optional(),
  port: z.number().int().min(1024).max(65_535).optional(),
  token_env: z.string().min(1).optional(),
})

const POSTGRES_SCHEMA_NAME = z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/)
const SqliteStorageSchema = z.strictObject({
  engine: z.literal('sqlite'),
  path: z.string().min(1).optional(),
})
const PostgresStorageSchema = z.strictObject({
  engine: z.literal('postgres'),
  url_env: z.string().min(1),
  schema: POSTGRES_SCHEMA_NAME,
})
export const StorageSchema = z.discriminatedUnion('engine', [
  SqliteStorageSchema,
  PostgresStorageSchema,
])

export type RawModel = z.infer<typeof ModelSchema>
export type RawModelDefaults = z.infer<typeof ModelDefaultsSchema>
export type RawBudget = z.infer<typeof BudgetSchema>
export type RawLocale = z.infer<typeof LocaleSchema>
export type RawPaths = z.infer<typeof PathsSchema>
export type RawLog = z.infer<typeof LogSchema>
export type RawSchedule = z.infer<typeof ScheduleSchema>
export type RawLoop = z.infer<typeof LoopSchema>
export type RawLlm = z.infer<typeof LlmSchema>
export type RawMemory = z.infer<typeof MemorySchema>
export type RawPlugins = z.infer<typeof PluginsSchema>
export type RawMcp = z.infer<typeof McpSchema>
export type RawWebSearch = z.infer<typeof WebSearchSchema>
export type RawApi = z.infer<typeof ApiSchema>
export type RawRetention = z.infer<typeof RetentionSchema>
export type RawUpdate = z.infer<typeof UpdateSchema>
export type RawStorage = z.infer<typeof StorageSchema>
export type RawModelTiers = z.infer<typeof ModelTiersSchema>
