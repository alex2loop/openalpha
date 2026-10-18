import { resolve as resolvePath } from 'node:path'

import type { LogLevel, ResolvedLog } from '@/core/config/resolvers/log'
import type { ResolvedMcp } from '@/core/config/resolvers/mcp'
import type { ResolvedModel, ResolveModelInput } from '@/core/config/resolvers/model'
import type { ResolvedResearch } from '@/core/config/resolvers/research'
import type {
  ResolvedApi,
  ResolvedBudget,
  ResolvedLlm,
  ResolvedLocale,
  ResolvedLoop,
  ResolvedSchedule,
} from '@/core/config/resolvers/runtime'
import type { RawConfig, RawModel, RawModelDefaults, RawModelTiers } from '@/core/config/schema'
import { BRAND } from '@/core/brand'
import { OperatorConfigError } from '@/core/config/operator-errors'
import { expandHome, resolveDataDir, resolveDataRelative } from '@/core/config/paths'
import { resolveLog } from '@/core/config/resolvers/log'
import { resolveMcp } from '@/core/config/resolvers/mcp'
import { CLIENT_MODEL, resolveModel } from '@/core/config/resolvers/model'
import { RESEARCH_LIMITS } from '@/core/config/resolvers/research'
import {
  resolveApi,
  resolveBudget,
  resolveLlm,
  resolveLocale,
  resolveLoop,
  resolveSchedule,
} from '@/core/config/resolvers/runtime'
import { type ResolvedStorageConfig, resolveStorageConfig } from '@/core/config/resolvers/storage'
import { type ResolvedWebSearch, resolveWebSearch } from '@/core/config/resolvers/web-search'
import { KNOWN_TOP_LEVEL } from '@/core/config/schema'
import { freezeDeep } from '@/core/utils/freeze'
import { closestName } from '@/core/utils/text'

export type { LogLevel, ResolvedLog } from '@/core/config/resolvers/log'
export type { ResolvedMcp, ResolvedMcpServer } from '@/core/config/resolvers/mcp'
export type { ResolvedModel, ResolvedModelPrices } from '@/core/config/resolvers/model'
export type {
  ResolvedApi,
  ResolvedBudget,
  ResolvedLlm,
  ResolvedLocale,
  ResolvedLoop,
  ResolvedSchedule,
} from '@/core/config/resolvers/runtime'
export type { ResolvedStorageConfig } from '@/core/config/resolvers/storage'
export type {
  ResolvedSearchProvider,
  ResolvedWebSearch,
  WebSearchProvider,
} from '@/core/config/resolvers/web-search'
// biome-ignore lint/performance/noBarrelFile: config/resolve is the sanctioned config facade.
export {
  combineInvalidConfigErrors,
  InvalidConfigError,
  type KeyEffect,
  MissingEnvError,
  missingEnvOf,
  OperatorConfigError,
  setEnvCommand,
  toInvalidConfigError,
} from '@/core/config/operator-errors'
export { expandHome } from '@/core/config/paths'
export { CLIENT_MODEL_PROVIDER } from '@/core/config/resolvers/model'
export {
  MAX_RESEARCH_QUESTIONS_LIMIT,
  RESEARCH_DEPTHS,
  RESEARCH_PROFILE_DEPTHS,
  type ResearchDepth,
  type ResearchStageId,
  type ResolvedResearch,
} from '@/core/config/resolvers/research'
export { toMissingSearchKeyError } from '@/core/config/resolvers/web-search'
export {
  EXA_SEARCH_TYPES,
  type ExaSearchType,
  WEB_SEARCH_PROVIDERS,
} from '@/core/config/schema'

const DEFAULT_MAX_VALUE_BYTES = 16_384
const DEFAULT_MEMORY_TTL_DAYS = 90
const DEFAULT_COMMANDS_RATE_PER_MINUTE = 20
const DEFAULT_RETENTION_DAYS = 90
const DEFAULT_INBOX_MAX_ATTEMPTS = 3
const DEFAULT_UPDATE_CHECK = true
const DEFAULT_UPDATE_AUTO = false
const DEFAULT_INBOX_RETENTION_DAYS = 7

export type ModelSource = 'config' | 'client'

export function isClientModelSource(source: ModelSource): boolean {
  return source === 'client'
}

export interface ConfigResolveOptions {
  readonly dataDir?: string
  readonly logLevel?: LogLevel
  readonly modelSource?: ModelSource
  /** Keeps a model entry whose key variable is unset, and leaves out an MCP server whose
   *  placeholder is unset, recording both for the caller to report. Boot defers, so a command or
   *  the daemon that never needs the missing key still runs; the strict resolve `doctor` probes
   *  with throws. */
  readonly deferMissingKeys?: true
}

interface ResolvedPaths {
  readonly dataDir: string
  readonly skillsDirs: readonly string[]
}

export interface ResolvedMemory {
  readonly maxValueBytes: number
  readonly ttlDays: number
}

interface ResolvedPlugins {
  readonly dirs: readonly string[]
  readonly allowUntrusted: boolean
  /** Executing a plugin's code grants it everything this process can do; declarative contributions
   *  do not. The two are separate switches so the larger grant is never inherited. */
  readonly allowCode: boolean
}

interface ResolvedCommands {
  readonly ratePerMinute: number
}

interface ResolvedRetention {
  readonly days: number
  readonly inboxDays: number
}

interface ResolvedInbox {
  readonly maxAttempts: number
}

interface ResolvedUpdate {
  readonly check: boolean
  readonly auto: boolean
}

export interface ResolvedConfig {
  readonly modelSource: ModelSource
  readonly models: readonly ResolvedModel[]
  readonly modelTiers: Readonly<Record<string, readonly ResolvedModel[]>>
  readonly budget: ResolvedBudget
  readonly locale: ResolvedLocale
  readonly paths: ResolvedPaths
  readonly log: ResolvedLog
  readonly channels: Readonly<Record<string, unknown>>
  readonly schedule: ResolvedSchedule
  readonly loop: ResolvedLoop
  readonly llm: ResolvedLlm
  readonly memory: ResolvedMemory
  readonly plugins: ResolvedPlugins
  readonly mcp: ResolvedMcp
  readonly commands: ResolvedCommands
  readonly api: ResolvedApi
  readonly retention: ResolvedRetention
  readonly inbox: ResolvedInbox
  readonly update: ResolvedUpdate
  readonly storage: ResolvedStorageConfig
  readonly webSearch: ResolvedWebSearch
  readonly research: ResolvedResearch
  readonly extensions: Readonly<Record<string, unknown>>
}

export function resolveConfig(raw: RawConfig, options?: ConfigResolveOptions): ResolvedConfig {
  const dataDirOverride = options?.dataDir
  const dataDir = resolvePath(
    dataDirOverride === undefined ? resolveDataDir(raw) : expandHome(dataDirOverride)
  )
  const modelSource = options?.modelSource ?? 'config'
  const { models, modelTiers } = resolveModelSection(raw, {
    source: modelSource,
    ...(options?.deferMissingKeys === undefined ? {} : { deferMissingKey: true }),
  })

  const resolved: ResolvedConfig = {
    modelSource,
    models,
    modelTiers,
    budget: resolveBudget(raw.budget),
    locale: resolveLocale(raw.locale),
    paths: { dataDir, skillsDirs: resolveDirs(raw.paths?.skills_dirs, dataDir) },
    log: resolveLog(raw.log, dataDir, options?.logLevel),
    channels: raw.channels ?? {},
    schedule: resolveSchedule(raw.schedule),
    loop: resolveLoop(raw.loop),
    llm: resolveLlm(raw.llm),
    memory: {
      maxValueBytes: DEFAULT_MAX_VALUE_BYTES,
      ttlDays: raw.memory?.ttl_days ?? DEFAULT_MEMORY_TTL_DAYS,
    },
    mcp: resolveMcp(raw.mcp, { deferMissingEnv: options?.deferMissingKeys === true }),
    commands: { ratePerMinute: DEFAULT_COMMANDS_RATE_PER_MINUTE },
    api: resolveApi(raw.api),
    retention: {
      days: raw.retention?.days ?? DEFAULT_RETENTION_DAYS,
      inboxDays: raw.retention?.inbox_days ?? DEFAULT_INBOX_RETENTION_DAYS,
    },
    inbox: { maxAttempts: DEFAULT_INBOX_MAX_ATTEMPTS },
    update: {
      check: raw.update?.check ?? DEFAULT_UPDATE_CHECK,
      auto: raw.update?.auto ?? DEFAULT_UPDATE_AUTO,
    },
    storage: resolveStorageConfig(raw.storage, dataDir),
    webSearch: resolveWebSearch(isClientModelSource(modelSource) ? undefined : raw.web_search),
    research: RESEARCH_LIMITS,
    plugins: {
      dirs: resolveDirs(raw.plugins?.dirs, dataDir),
      allowUntrusted: raw.plugins?.allow_untrusted ?? false,
      allowCode: raw.plugins?.allow_code ?? false,
    },
    extensions: raw.extensions,
  }

  return freezeDeep(resolved)
}

/** Sections core does not know land in `extensions` unvalidated, each waiting for the module that
 *  claims it. One with no claimant is read by nobody and reported by nobody, so a config that looks
 *  configured is inert — the exact failure the strict per-section schemas exist to prevent, one
 *  level out. The set of sections gets the same strictness as the keys inside one. */
export function assertExtensionsClaimed(
  extensions: Readonly<Record<string, unknown>>,
  claimed: readonly string[]
): void {
  const owned = new Set(claimed)
  const unclaimed = Object.keys(extensions)
    .filter((section) => !owned.has(section))
    .sort()
  const first = unclaimed[0]

  if (first === undefined) {
    return
  }

  const named = unclaimed.map((section) => `[${section}]`).join(', ')
  // Several unknown sections name no single nearest.
  const near =
    unclaimed.length === 1 ? closestName(first, [...KNOWN_TOP_LEVEL, ...owned]) : undefined

  throw new OperatorConfigError(
    `unknown config ${unclaimed.length === 1 ? 'section' : 'sections'}: ${named}`,
    {
      key: near === undefined ? 'errors.configUnknownSection' : 'errors.configUnknownSectionNear',
      params: {
        sections: named,
        sample: BRAND.sampleConfigUrl,
        ...(near === undefined ? {} : { near }),
      },
    },
    { path: [first] }
  )
}

function resolveDirs(paths: readonly string[] | undefined, dataDir: string): readonly string[] {
  return (paths ?? []).map((path) => resolveDataRelative(path, dataDir))
}

function assertUniqueModelSelectors(
  models: readonly ResolvedModel[],
  path: readonly string[]
): void {
  const seen = new Set<string>()
  for (const [index, model] of models.entries()) {
    if (seen.has(model.selector)) {
      throw new OperatorConfigError(
        `duplicate model selector: ${model.selector}`,
        {
          key: 'errors.configModelDuplicate',
          params: { model: model.selector },
        },
        { path: [...path, index] }
      )
    }
    seen.add(model.selector)
  }
}

interface ResolvedModelSection {
  readonly models: readonly ResolvedModel[]
  readonly modelTiers: Readonly<Record<string, readonly ResolvedModel[]>>
}

/** The client source reads no `[[models]]`: the client's model is the primary, and every agent runs
 *  on it. Tiers are still read for the lookups that name one, such as the `decisions` headline
 *  read, but with no primary to fall back to and no key required at boot - a host may launch the
 *  server without the operator's environment. */
function resolveModelSection(
  raw: RawConfig,
  options: { readonly source: ModelSource; readonly deferMissingKey?: true }
): ResolvedModelSection {
  const defaults = raw.model_defaults === undefined ? {} : { defaults: raw.model_defaults }
  const defer: Pick<TierOptions, 'deferMissingKey'> =
    options.deferMissingKey === undefined ? {} : { deferMissingKey: true }

  if (isClientModelSource(options.source)) {
    return {
      models: [CLIENT_MODEL],
      modelTiers: resolveModelTiers(raw.model_tiers, { ...defaults, apiKeyOptional: true }),
    }
  }

  const models = resolveModelChain(raw.models, { ...defaults, ...defer, path: ['models'] })
  const primary = models.at(0)

  return {
    models,
    modelTiers: resolveModelTiers(raw.model_tiers, {
      ...defaults,
      ...defer,
      ...(primary === undefined ? {} : { primary }),
    }),
  }
}

function resolveModelChain(
  entries: readonly RawModel[],
  options: {
    readonly defaults?: RawModelDefaults
    readonly deferMissingKey?: true
    readonly path: readonly string[]
  }
): readonly ResolvedModel[] {
  const { defaults, path } = options
  const models = entries.map((entry, index) => {
    const input: ResolveModelInput = {
      entry,
      path: [...path, index],
      ...(defaults === undefined ? {} : { defaults }),
      ...(options.deferMissingKey === undefined ? {} : { deferMissingKey: true }),
    }

    return resolveModel(input)
  })

  assertUniqueModelSelectors(models, path)
  return models
}

interface TierOptions {
  readonly defaults?: RawModelDefaults
  readonly primary?: ResolvedModel
  readonly apiKeyOptional?: true
  readonly deferMissingKey?: true
}

function resolveModelTiers(
  tiers: RawModelTiers | undefined,
  options: TierOptions
): Readonly<Record<string, readonly ResolvedModel[]>> {
  const resolved: Record<string, readonly ResolvedModel[]> = {}

  for (const [name, entries] of Object.entries(tiers ?? {})) {
    resolved[name] = resolveTierChain({ ...options, entries, path: ['model_tiers', name] })
  }

  return resolved
}

// A tier chain ends with the primary [[models]] entry when there is one: when the tier's own models
// fail (provider gap, 404, timeout), the request falls back to the default model instead of dying.
interface ResolveTierChainInput extends TierOptions {
  readonly entries: readonly RawModel[]
  readonly path: readonly string[]
}

function resolveTierChain(input: ResolveTierChainInput): readonly ResolvedModel[] {
  const { entries, defaults, primary, path } = input
  const models = entries.map((entry, index) => {
    const entryInput: ResolveModelInput = {
      entry,
      path: [...path, index],
      ...(defaults === undefined ? {} : { defaults }),
      ...(input.apiKeyOptional === undefined ? {} : { apiKeyOptional: input.apiKeyOptional }),
      ...(input.deferMissingKey === undefined ? {} : { deferMissingKey: input.deferMissingKey }),
    }

    return resolveModel(entryInput)
  })

  if (primary !== undefined && !models.some((model) => model.selector === primary.selector)) {
    models.push(primary)
  }

  assertUniqueModelSelectors(models, path)
  return models
}
