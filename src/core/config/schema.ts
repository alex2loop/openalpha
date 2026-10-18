import { z } from 'zod'

import type {
  ExaSearchType,
  RawApi,
  RawBudget,
  RawLlm,
  RawLocale,
  RawLog,
  RawLoop,
  RawMcp,
  RawMemory,
  RawModel,
  RawModelDefaults,
  RawModelTiers,
  RawPaths,
  RawPlugins,
  RawRetention,
  RawSchedule,
  RawStorage,
  RawUpdate,
  RawWebSearch,
} from '@/core/config/schema-sections'
import { OperatorConfigError, toInvalidConfigError } from '@/core/config/operator-errors'
import {
  ApiSchema,
  BudgetSchema,
  EXA_SEARCH_TYPES,
  LlmSchema,
  LocaleSchema,
  LogSchema,
  LoopSchema,
  McpSchema,
  MemorySchema,
  ModelDefaultsSchema,
  ModelSchema,
  ModelTiersSchema,
  PathsSchema,
  PluginsSchema,
  RetentionSchema,
  ScheduleSchema,
  StorageSchema,
  UpdateSchema,
  WEB_SEARCH_PROVIDERS,
  WebSearchSchema,
} from '@/core/config/schema-sections'
import { ConfigError } from '@/core/errors'
import { isPlainRecord } from '@/core/utils/collections'

export type {
  ExaSearchType,
  RawApi,
  RawBudget,
  RawLlm,
  RawLoop,
  RawMcp,
  RawModel,
  RawModelDefaults,
  RawModelTiers,
  RawSchedule,
  RawStorage,
  RawWebSearch,
}
export { EXA_SEARCH_TYPES, WEB_SEARCH_PROVIDERS }

// Extension values skip Zod, so nothing else bounds how deep a TOML table can nest; without this,
// a deeply nested extension surfaces a native RangeError (stack overflow) instead of a ConfigError.
const EXTENSION_MAX_DEPTH = 32

const KnownSectionsSchema = z.strictObject({
  models: z.array(ModelSchema).optional(),
  model_defaults: ModelDefaultsSchema.optional(),
  budget: BudgetSchema.optional(),
  locale: LocaleSchema.optional(),
  paths: PathsSchema.optional(),
  log: LogSchema.optional(),
  channels: z.record(z.string(), z.unknown()).optional(),
  schedule: ScheduleSchema.optional(),
  loop: LoopSchema.optional(),
  llm: LlmSchema.optional(),
  memory: MemorySchema.optional(),
  plugins: PluginsSchema.optional(),
  mcp: McpSchema.optional(),
  web_search: WebSearchSchema.optional(),
  api: ApiSchema.optional(),
  retention: RetentionSchema.optional(),
  update: UpdateSchema.optional(),
  storage: StorageSchema.optional(),
  model_tiers: ModelTiersSchema.optional(),
})

export const KNOWN_TOP_LEVEL: ReadonlySet<string> = new Set([
  'models',
  'model_defaults',
  'budget',
  'locale',
  'paths',
  'log',
  'channels',
  'schedule',
  'loop',
  'llm',
  'memory',
  'plugins',
  'mcp',
  'web_search',
  'api',
  'retention',
  'update',
  'storage',
  'model_tiers',
])

const OPTIONAL_SECTION_KEYS = [
  'model_defaults',
  'budget',
  'locale',
  'paths',
  'log',
  'channels',
  'schedule',
  'loop',
  'llm',
  'memory',
  'plugins',
  'mcp',
  'web_search',
  'api',
  'retention',
  'update',
  'storage',
  'model_tiers',
] as const

export interface RawConfig {
  readonly models: readonly RawModel[]
  readonly model_defaults?: RawModelDefaults
  readonly budget?: RawBudget
  readonly locale?: RawLocale
  readonly paths?: RawPaths
  readonly log?: RawLog
  readonly channels?: Readonly<Record<string, unknown>>
  readonly schedule?: RawSchedule
  readonly loop?: RawLoop
  readonly llm?: RawLlm
  readonly memory?: RawMemory
  readonly plugins?: RawPlugins
  readonly mcp?: RawMcp
  readonly web_search?: RawWebSearch
  readonly api?: RawApi
  readonly retention?: RawRetention
  readonly update?: RawUpdate
  readonly storage?: RawStorage
  readonly model_tiers?: RawModelTiers
  readonly extensions: Readonly<Record<string, unknown>>
}

type KnownData = z.infer<typeof KnownSectionsSchema>

export function parseRawConfig(input: unknown): RawConfig {
  if (input === undefined || input === null) {
    return { models: [], extensions: {} }
  }

  if (!isPlainRecord(input)) {
    throw new ConfigError('config root must be a TOML table')
  }

  const { known, extensions } = splitKnownAndExtensions(input)
  const parsed = KnownSectionsSchema.safeParse(known)

  if (!parsed.success) {
    throw toInvalidConfigError(parsed.error, KnownSectionsSchema, { unchecked: extensions })
  }

  return assembleRaw(parsed.data, extensions)
}

function splitKnownAndExtensions(input: Record<string, unknown>): {
  known: Record<string, unknown>
  extensions: Record<string, unknown>
} {
  const known: Record<string, unknown> = {}
  const extensions: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (KNOWN_TOP_LEVEL.has(key)) {
      known[key] = value
    } else {
      assertFreezable(value, key)
      extensions[key] = value
    }
  }
  return { known, extensions }
}

// Extensions skip Zod, so they are the one path by which a value the boot freeze cannot make
// immutable — a TOML datetime parses to a Date, whose internal slot survives Object.freeze —
// would reach a consumer. Epoch-ms integers and ISO day strings are the wire convention. A table
// comes back with a null prototype from smol-toml, a plain one from everything else.
function assertFreezable(value: unknown, path: string, depth = 0): void {
  if (depth > EXTENSION_MAX_DEPTH) {
    throw new OperatorConfigError(
      `config '${path}' nests deeper than ${EXTENSION_MAX_DEPTH} levels`,
      { key: 'errors.configTooDeep', params: { field: path, depth: EXTENSION_MAX_DEPTH } },
      { path: [path] }
    )
  }

  if (value === null || typeof value !== 'object') {
    return
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertFreezable(item, `${path}[${index}]`, depth + 1)
    }
    return
  }

  const prototype = Object.getPrototypeOf(value)

  if (prototype !== Object.prototype && prototype !== null) {
    throw new OperatorConfigError(
      `config '${path}' must be a table, array, or scalar; datetimes go in as epoch-ms or an ISO day string`,
      { key: 'errors.configDatetime', params: { field: path } },
      { path: [path] }
    )
  }

  for (const [key, child] of Object.entries(value)) {
    assertFreezable(child, `${path}.${key}`, depth + 1)
  }
}

function assembleRaw(data: KnownData, extensions: Record<string, unknown>): RawConfig {
  const raw: {
    models: readonly RawModel[]
    budget?: RawBudget
    locale?: RawLocale
    paths?: RawPaths
    log?: RawLog
    channels?: Readonly<Record<string, unknown>>
    schedule?: RawSchedule
    loop?: RawLoop
    llm?: RawLlm
    memory?: RawMemory
    plugins?: RawPlugins
    storage?: RawStorage
    model_tiers?: RawModelTiers
    extensions: Readonly<Record<string, unknown>>
  } = {
    models: data.models ?? [],
    extensions,
  }
  for (const key of OPTIONAL_SECTION_KEYS) {
    const value = data[key]

    if (value !== undefined) {
      Object.assign(raw, { [key]: value })
    }
  }
  return raw
}
