import type { Logger } from '@/core/logging/logger'
import type { MessageKey } from '@/i18n'
import type { DefaultVenues } from '@/trading/kernel/config'
import type { SourceId } from '@/trading/kernel/source/source-id'
import type { RegisteredSource } from '@/trading/kernel/source/source-result'
import type { SourceRegistry } from '@/trading/markets/types'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import type { LoadedSourceModule } from '@/trading/sources/plugin-module'
import type { SourceRoutes } from '@/trading/sources/registry'
import type { SourceFacts } from '@/trading/sources/types'
import { OperatorConfigError } from '@/core/config/resolve'
import { ConfigError } from '@/core/errors'
import { formatErrForLog, resolveCredential } from '@/core/security/credentials'
import { sourceId } from '@/trading/kernel/source/source-id'
import { RSS_FEEDS } from '@/trading/sources/adapters/rss'
import { createSourceRegistry, isRoutedSource, mergeSourceRoutes } from '@/trading/sources/registry'
import { SOURCE_ROUTES, withVenueQuoteLead } from '@/trading/sources/routes'
import { createSourceHttp } from '@/trading/sources/transport/http'
import {
  createBuiltInSources,
  PLAIN_USER_AGENT_SOURCES,
  SOURCE_CREDENTIAL_ENV,
  SOURCE_CREDENTIALS,
  SOURCE_ENDPOINTS,
  SOURCE_RATE_LIMITS,
} from '@/trading/wiring/composition/source-facts'
import { TRADING_CONFIG_SECTION } from '@/trading/wiring/config'
import { SOURCES_CONFIG_KEY } from '@/trading/wiring/config-schema'

const BUILT_IN_SOURCE_IDS: ReadonlySet<SourceId> = new Set(
  Object.values(SOURCE_ROUTES).flatMap((scopes) => Object.values(scopes).flat())
)
const SOURCE_BOUNDARY = 'source'
/** A plugin manifest may omit `rateLimitPerMinute`; unpaced is not what "omitted" should mean. A
 *  plugin route is never tried before a first-party provider, so this only has to be sane. */
const PLUGIN_DEFAULT_RATE_LIMIT_PER_MINUTE = 30

interface SourceRegistryOptions {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly logger: Logger
  readonly pluginModules: readonly LoadedSourceModule[]
  /** `[trading.sources]`: the operator renaming a variable, never naming a value or a host. */
  readonly credentialEnv: Readonly<Partial<Record<SourceId, string>>>
  readonly defaultVenues: DefaultVenues
}

/** Built and closed in one call. Adding a provider is one import plus one spread here — the
 *  registry itself has no per-provider knowledge. */
export function createConfiguredSourceRegistry(options: SourceRegistryOptions): SourceRegistry {
  const usable = usablePluginModules(options)
  const plugin = toPluginFacts(usable)
  const mergedRoutes = mergeSourceRoutes(
    withVenueQuoteLead(SOURCE_ROUTES, options.defaultVenues),
    usable
  )
  const declaredEnv = { ...SOURCE_CREDENTIAL_ENV, ...plugin.credentialEnv }

  assertConfiguredSourcesTakeCredentials(options.credentialEnv, declaredEnv)

  const credentialEnv = { ...declaredEnv, ...options.credentialEnv }
  const credentials = resolveCredentials(options.env, credentialEnv)
  const registry = createSourceRegistry(mergedRoutes, options.logger)
  const facts: SourceFacts = {
    endpoints: { ...SOURCE_ENDPOINTS, ...plugin.endpoints },
    rateLimits: { ...SOURCE_RATE_LIMITS, ...plugin.rateLimits },
    feeds: RSS_FEEDS,
    credentials,
    plainUserAgentSources: PLAIN_USER_AGENT_SOURCES,
  }
  assertEveryRoutedSourcePaced(facts.rateLimits)

  const adapters = { http: createSourceHttp(facts, Date.now, options.logger) }
  const skipped = new Set<SourceId>()
  const registeredKeys = new Set<string>()

  for (const source of createBuiltInSources(adapters)) {
    if (isProviderAvailable(credentials, credentialEnv, source.id)) {
      registry.register(source)
      registeredKeys.add(sourceRegistrationKey(source))
    } else {
      skipped.add(source.id)
    }
  }

  registerPluginSources({
    registry,
    routes: mergedRoutes,
    modules: usable,
    adapters,
    credentials,
    credentialEnv,
    skipped,
    registeredKeys,
    logger: options.logger,
  })

  registry.close()
  warnSkipped(options.logger, skipped, credentialEnv)

  return registry
}

type PluginRefusalReason = 'id_owned_by_builtin' | 'id_owned_by_plugin'

interface PluginModuleSplit {
  readonly usable: readonly LoadedSourceModule[]
  readonly refused: readonly {
    readonly module: LoadedSourceModule
    readonly reason: PluginRefusalReason
  }[]
}

/** A plugin claiming an id a built-in owns would inherit that provider's pinned origin, so those
 *  are dropped before their facts merge, and so are ids two plugins both claim. */
export function splitPluginModules(modules: readonly LoadedSourceModule[]): PluginModuleSplit {
  const usable: LoadedSourceModule[] = []
  const refused: { module: LoadedSourceModule; reason: PluginRefusalReason }[] = []
  const idCounts = pluginIdCounts(modules)

  for (const module of modules) {
    if (BUILT_IN_SOURCE_IDS.has(module.manifest.id)) {
      refused.push({ module, reason: 'id_owned_by_builtin' })
    } else if (idCounts.get(module.manifest.id) === 1) {
      usable.push(module)
    } else {
      refused.push({ module, reason: 'id_owned_by_plugin' })
    }
  }

  return { usable, refused }
}

function usablePluginModules(options: SourceRegistryOptions): readonly LoadedSourceModule[] {
  const { usable, refused } = splitPluginModules(options.pluginModules)

  for (const { module, reason } of refused) {
    options.logger.warn('trading.plugin_source_skipped', { plugin: module.pluginId, reason })
  }

  return usable
}

function pluginIdCounts(modules: readonly LoadedSourceModule[]): ReadonlyMap<SourceId, number> {
  const counts = new Map<SourceId, number>()

  for (const module of modules) {
    counts.set(module.manifest.id, (counts.get(module.manifest.id) ?? 0) + 1)
  }

  return counts
}

interface PluginFacts {
  readonly endpoints: Record<string, string | readonly string[]>
  readonly rateLimits: Record<string, number>
  readonly credentialEnv: Record<string, string>
}

// One fold builds all three maps — three one-per-map helpers would be the same loop three times.
function toPluginFacts(modules: readonly LoadedSourceModule[]): PluginFacts {
  const facts: PluginFacts = { endpoints: {}, rateLimits: {}, credentialEnv: {} }

  for (const { manifest } of modules) {
    facts.endpoints[manifest.id] = manifest.endpoint

    facts.rateLimits[manifest.id] =
      manifest.rateLimitPerMinute ?? PLUGIN_DEFAULT_RATE_LIMIT_PER_MINUTE

    if (manifest.credentialEnv !== undefined) {
      facts.credentialEnv[manifest.id] = manifest.credentialEnv
    }
  }

  return facts
}

interface RegisterPluginSourcesOptions {
  readonly registry: SourceRegistry
  readonly routes: SourceRoutes
  readonly modules: readonly LoadedSourceModule[]
  readonly adapters: SourceAdapterOptions
  readonly credentials: Readonly<Partial<Record<SourceId, string>>>
  readonly credentialEnv: Readonly<Partial<Record<SourceId, string>>>
  readonly skipped: Set<SourceId>
  readonly registeredKeys: Set<string>
  readonly logger: Logger
}

/** Contained per plugin: a throwing create() or a kind its manifest routes do not cover is a bad
 *  manifest — drop the plugin, boot continues. Pre-flight before registering any source so a
 *  disagreeing module is never half-registered. */
function registerPluginSources(options: RegisterPluginSourcesOptions): void {
  for (const module of options.modules) {
    try {
      const created = module.create(options.adapters)
      const registrable = created.filter((source) =>
        isProviderAvailable(options.credentials, options.credentialEnv, source.id)
      )

      assertPluginSourcesRegistrable({
        pluginId: module.pluginId,
        routes: options.routes,
        created,
        registrable,
        registeredKeys: options.registeredKeys,
      })

      for (const source of created) {
        if (!isProviderAvailable(options.credentials, options.credentialEnv, source.id)) {
          options.skipped.add(source.id)
        }
      }

      for (const source of registrable) {
        options.registry.register(source)
        options.registeredKeys.add(sourceRegistrationKey(source))
      }
    } catch (err: unknown) {
      options.logger.warn('trading.plugin_source_skipped', {
        plugin: module.pluginId,
        err: formatErrForLog(err),
      })
    }
  }
}

interface PluginSourcePreflight {
  readonly pluginId: string
  readonly routes: SourceRoutes
  readonly created: readonly RegisteredSource[]
  readonly registrable: readonly RegisteredSource[]
  readonly registeredKeys: ReadonlySet<string>
}

function assertPluginSourcesRegistrable(options: PluginSourcePreflight): void {
  const unrouted = options.created.find(
    (source) => !isRoutedSource(options.routes, source.kind, source.id)
  )

  if (unrouted !== undefined) {
    throw new ConfigError(
      `plugin source ${unrouted.kind}:${unrouted.id} has no route in its manifest`
    )
  }

  const moduleKeys = new Set<string>()

  for (const source of options.registrable) {
    const key = sourceRegistrationKey(source)

    if (moduleKeys.has(key) || options.registeredKeys.has(key)) {
      throw new ConfigError(`duplicate source id: ${key}`, undefined, [options.pluginId, key])
    }

    moduleKeys.add(key)
  }
}

function sourceRegistrationKey(source: RegisteredSource): string {
  return `${source.kind}:${source.id}`
}

/** A keyless run is a legitimate degraded mode — that is what `isProviderAvailable` is for — so this
 *  is never fatal. It exists because the alternative is silence: the source is absent, the kind
 *  fails over, and the operator learns nothing about the key they meant to set. One line, naming
 *  every skipped source and the variable it wanted, so the absence is diagnosable. */
function warnSkipped(
  logger: Logger,
  skipped: ReadonlySet<SourceId>,
  credentialEnv: Readonly<Partial<Record<SourceId, string>>>
): void {
  if (skipped.size === 0) {
    return
  }

  logger.warn('trading.source.skipped', {
    sources: [...skipped].sort().map((id) => ({ source: id, variable: credentialEnv[id] })),
  })
}

interface UnavailableSource {
  readonly source: SourceId
  readonly variable: string
  /** Catalog line for what the operator gains by setting the variable. */
  readonly adds: MessageKey
}

/** Which built-in sources cannot register because the variable naming their credential is unset,
 *  what that variable is called and what it would add. Pure data - no adapter, no network, no boot
 *  - so `doctor` can answer the same question the registry answers, from the same predicate.
 *  Plugin sources are outside it: their credential facts arrive with the module, which only boot
 *  loads. */
export function unavailableSources(options: {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly credentialEnv: Readonly<Partial<Record<SourceId, string>>>
}): readonly UnavailableSource[] {
  const credentialEnv = { ...SOURCE_CREDENTIAL_ENV, ...options.credentialEnv }
  const credentials = resolveCredentials(options.env, credentialEnv)
  const missing: UnavailableSource[] = []

  for (const [id, facts] of Object.entries(SOURCE_CREDENTIALS)) {
    const source = sourceId(id)
    const variable = credentialEnv[source] ?? facts.variable

    if (!isProviderAvailable(credentials, credentialEnv, source)) {
      missing.push({ source, variable, adds: facts.adds })
    }
  }

  return missing.sort((left, right) => left.source.localeCompare(right.source))
}

function resolveCredentials(
  env: Readonly<Record<string, string | undefined>>,
  credentialEnv: Readonly<Partial<Record<SourceId, string>>>
): Readonly<Partial<Record<SourceId, string>>> {
  const resolved: Partial<Record<SourceId, string>> = {}

  for (const [id, variable] of Object.entries(credentialEnv)) {
    const value = variable === undefined ? undefined : resolveCredential(env, variable)

    if (value !== undefined && value.length > 0) {
      resolved[sourceId(id)] = value
    }
  }

  return Object.freeze(resolved)
}

/** A routed provider absent from the rate-limit table is unpaced, and unpaced is what turns one
 *  refused request into an open breaker. A provider arrives as a route in one file and a limit in
 *  another, so the pair is caught here rather than left to a 429 in production. */
function assertEveryRoutedSourcePaced(rateLimits: SourceFacts['rateLimits']): void {
  const unpaced = [...BUILT_IN_SOURCE_IDS].filter((id) => rateLimits[id] === undefined).sort()
  const [first] = unpaced

  if (first === undefined) {
    return
  }

  throw new ConfigError(`sources declare no rate limit: ${unpaced.join(', ')}`, undefined, [
    SOURCE_BOUNDARY,
    first,
  ])
}

/** A rename aimed at a source that takes no credential is configured and inert. */
function assertConfiguredSourcesTakeCredentials(
  configured: Readonly<Partial<Record<SourceId, string>>>,
  declared: Readonly<Partial<Record<SourceId, string>>>
): void {
  const unknown = Object.keys(configured)
    .filter((id) => declared[sourceId(id)] === undefined)
    .sort()
  const [first] = unknown

  if (first === undefined) {
    return
  }

  throw new OperatorConfigError(
    `no source named ${unknown.join(', ')} takes a credential`,
    {
      key: 'errors.configSourceNoCredential',
      params: { sources: unknown.join(', '), known: Object.keys(declared).sort().join(', ') },
    },
    { path: [TRADING_CONFIG_SECTION, SOURCES_CONFIG_KEY, first] }
  )
}

/** A source that needs a key and has none is never registered, so its kind falls through to the
 *  next provider in the failover order rather than failing every call. */
function isProviderAvailable(
  credentials: Readonly<Partial<Record<SourceId, string>>>,
  credentialEnv: Readonly<Partial<Record<SourceId, string>>>,
  id: SourceId
): boolean {
  return credentialEnv[id] === undefined || credentials[id] !== undefined
}
