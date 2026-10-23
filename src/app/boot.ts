import { join } from 'node:path'

import type { RuntimeAssets } from '@/app/providers'
import type { BootExtensionOptions, Booted, BootGate, BootOptions } from '@/app/types'
import type { KeyValidator } from '@/commands/api'
import type { ResolvedConfig } from '@/core/config/resolve'
import type { App } from '@/core/container'
import type { Logger, LoggerResource } from '@/core/logging/logger'
import type { Storage } from '@/core/types/storage'
import type { OpenedPersistence } from '@/persistence/api'
import type { SocialConfig } from '@/social/api'
import type { TradingConfig } from '@/trading/api'
import '@/app/events'
import { loadAssets } from '@/app/assets'
import { resolveBootExtensions } from '@/app/config-tree'
import { createDeliveryHub, type DeliveryHub } from '@/app/delivery'
import { createTradingNoticeSender } from '@/app/notice-sender'
import { buildProviders } from '@/app/providers'
import { assertSocialToolRules, createSocialProvider } from '@/app/social'
import { hydrateStartupState, migrateStartupSchema } from '@/app/startup-state'
import { BRAND } from '@/core/brand'
import { loadConfig } from '@/core/config/load'
import { OperatorConfigError, resolveConfig } from '@/core/config/resolve'
import { createApp } from '@/core/container'
import { ConfigError } from '@/core/errors'
import { createLoggerResource } from '@/core/logging/logger'
import { formatErrForLog } from '@/core/security/credentials'
import { ensurePrivateDirectory } from '@/core/security/private-files'
import { WORKSPACES_DIR_NAME } from '@/engine/api'
import { hasOwnMessage } from '@/i18n'
import { openPersistence } from '@/persistence/api'
import { createTradingRegistrationProvider, createTradingStoresProvider } from '@/trading/api'

// Allow-list, not a deny-list: an interpreter-hijack variable (NODE_OPTIONS, LD_PRELOAD,
// PYTHONSTARTUP, …) is excluded by not being here, and so is every provider key.
const CHILD_ENV_ALLOW: ReadonlySet<string> = new Set([
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'TZ',
  'TERM',
  'TMPDIR',
  'TEMP',
  'TMP',
])

/** The operator reads what a loop does, never its task id. A loop with no entry here is described
 *  by `trading.loop.unknown` rather than by its raw name. */
/** The one locale gate: every contributed command key must resolve in both catalogs. */
const commandKeyValidator: KeyValidator = {
  resolvesEverywhere: (key) => hasOwnMessage('en', key) && hasOwnMessage('vi', key),
}

export const passThroughBootGate: BootGate = async () => ({ verdict: 'ok' })

interface BootResource {
  readonly name: string
  close(): Promise<void>
}

interface DisposeBootOptions {
  readonly logger: Logger
  readonly loggerResource: LoggerResource
  readonly disposeAssets: () => Promise<void>
  readonly storage: Storage | undefined
}

interface ResolvedBootConfig {
  readonly config: ResolvedConfig
  readonly configPath: string
  readonly tradingConfig: TradingConfig
  readonly socialConfig: SocialConfig
}

function resolveChildEnv(
  source: Readonly<Record<string, string | undefined>>
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {}

  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && CHILD_ENV_ALLOW.has(key.toUpperCase())) {
      out[key] = value
    }
  }

  return Object.freeze(out)
}

/** Daemon and CLI processes append to one configured file; identity says which wrote a record. */
function bootLogger(loggerResource: LoggerResource, mode: BootOptions['mode']): Logger {
  return loggerResource.logger.child({
    service: BRAND.name,
    version: BRAND.version,
    mode,
  })
}

export async function boot(options: BootOptions): Promise<Booted> {
  const { config, configPath, tradingConfig, socialConfig } = await resolveBootConfig(options)

  await prepareBootDirectories(config.paths.dataDir)

  const loggerResource = await createLoggerResource(config.log, undefined, {
    dataDir: config.paths.dataDir,
  })
  const logger = bootLogger(loggerResource, options.mode)
  const childEnvBase = resolveChildEnv(options.env)
  const delivery = createDeliveryHub()
  let disposeAssets: (() => Promise<void>) | undefined
  let storage: Storage | undefined
  let disposePromise: Promise<void> | undefined
  const dispose = (): Promise<void> => {
    disposePromise ??= disposeBootResources({
      logger,
      loggerResource,
      disposeAssets: disposeAssets ?? (async () => undefined),
      storage,
    })
    return disposePromise
  }

  options.onLoggerResource?.(loggerResource)

  try {
    const loaded = await loadAssets({
      config,
      logger,
      delivery,
      childEnvBase,
      bootScope: options.bootScope ?? 'full',
    })
    disposeAssets = loaded.dispose
    const persistence = await openPersistence(config.storage, logger)
    storage = persistence.storage
    const assembly = buildProviderAssembly({
      config,
      options,
      assets: loaded.assets,
      persistence,
      tradingConfig,
      socialConfig,
      delivery,
    })
    const app = createApp(config, [...assembly.providers, ...(options.features ?? [])], {
      configPath,
      signal: options.shutdownSignal,
    })

    await prepareBootApp({ bootOptions: options, assembly, app, socialConfig, loggerResource })

    return { app, delivery, dispose }
  } catch (err: unknown) {
    logger.fatal('boot.failed', { err: formatErrForLog(err) })
    await dispose()
    throw err
  }
}

interface ProviderAssemblyInput {
  readonly config: ResolvedConfig
  readonly options: BootOptions
  readonly assets: RuntimeAssets
  readonly persistence: OpenedPersistence
  readonly tradingConfig: TradingConfig
  readonly socialConfig: SocialConfig
  readonly delivery: DeliveryHub
}

/** Trading's two provider steps are built here because every input is boot-owned; the assembly
 *  orders providers and never reads what trading needs. */
function buildProviderAssembly(input: ProviderAssemblyInput): ReturnType<typeof buildProviders> {
  return buildProviders({
    assets: input.assets,
    persistence: input.persistence,
    extensions: buildBootExtensions(input.options),
    env: input.options.env,
    social: createSocialProvider({ config: input.socialConfig, delivery: input.delivery }),
    tradingStores: createTradingStoresProvider(input.tradingConfig),
    tradingRegistration: createTradingRegistrationProvider({
      tradingConfig: input.tradingConfig,
      env: input.options.env,
      sender: (app) =>
        createTradingNoticeSender({
          delivery: input.delivery,
          config: input.config,
          timezone: input.tradingConfig.displayTimezone,
          channels: () => app.resolve('channels'),
          pairingStore: () => app.resolve('pairingStore'),
        }),
      // The bus isolates a handler that throws, so a page that cannot take the event never fails a booking.
      onFilled: (app) => (fill) => app.resolve('bus').emit('order_filled', fill),
      recipient: () => input.delivery.defaultRecipient(),
      keys: commandKeyValidator,
      pluginModules: input.assets.pluginSourceModules,
    }),
  })
}

interface PrepareBootAppOptions {
  readonly bootOptions: BootOptions
  readonly assembly: ReturnType<typeof buildProviders>
  readonly app: App
  readonly socialConfig: SocialConfig
  readonly loggerResource: LoggerResource
}

async function prepareBootApp(options: PrepareBootAppOptions): Promise<void> {
  const { bootOptions, assembly, app, socialConfig, loggerResource } = options
  const startup = bootOptions.startup ?? 'hydrate'

  if (bootOptions.bootScope === 'persistence') {
    if (startup === 'migrate') {
      await migrateStartupSchema(app)
    }

    return
  }

  assembly.assertExtensionsRegistered(app)
  // Resolved eagerly so registry construction and its consistency checks run at boot, not at the
  // first tool call: a misconfigured install must fail during composition.
  app.resolve('tradingServices')
  // Also resolved at boot, so an unset search key is logged once at start, not at the first search.
  app.resolve('webRetrieval')
  assertSocialToolRules(app, socialConfig)
  await loggerResource.configureAgentRegistry(app.resolve('agents').keys())
  if (startup === 'hydrate') {
    await hydrateStartupState(app, bootOptions.mode)
  } else if (startup === 'migrate') {
    await migrateStartupSchema(app)
  }
}

// A refused startup must fail before boot creates a logger, opens the database, or touches the
// data directory.
async function resolveBootConfig(options: BootOptions): Promise<ResolvedBootConfig> {
  const { raw, configPath } = await loadConfig({
    configFile: options.configFile ?? 'required',
    ...(options.configPath === undefined ? {} : { configPath: options.configPath }),
    ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
  })
  const config = resolveConfig(raw, {
    ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
    ...(options.logLevel === undefined ? {} : { logLevel: options.logLevel }),
    ...(options.modelSource === undefined ? {} : { modelSource: options.modelSource }),
    deferMissingKeys: true,
  })
  const { trading: tradingConfig, social: socialConfig } = resolveBootExtensions(config)
  const check = await (options.bootGate ?? passThroughBootGate)({
    configPath,
    dataDir: config.paths.dataDir,
  })

  if (check.verdict === 'stop') {
    throw new ConfigError(check.message ?? 'Startup refused by the host')
  }

  if (check.verdict === 'warn') {
    options.err?.(check.message ?? 'The host reported a startup warning')
  }

  return { config, configPath, tradingConfig, socialConfig }
}

/** Both directories boot owns, before the logger or the database exists. Each boundary is wrapped
 *  separately so the error names the path that actually failed. */
async function prepareBootDirectories(dataDir: string): Promise<void> {
  await prepareDirectory(dataDir)
  await prepareDirectory(join(dataDir, WORKSPACES_DIR_NAME))
}

async function prepareDirectory(path: string): Promise<void> {
  try {
    await ensurePrivateDirectory(path)
  } catch (err: unknown) {
    throw new OperatorConfigError(
      `cannot prepare directory: ${path}`,
      { key: 'errors.setupPathUnusable', params: { path } },
      { cause: err }
    )
  }
}

// Translates the flat boot options into the boot-extension factory input, omitting absent arrays
// so `exactOptionalPropertyTypes` stays satisfied, and binding the locale seam once.
function buildBootExtensions(options: BootOptions): BootExtensionOptions {
  return {
    extensions: {
      ...(options.tools === undefined ? {} : { tools: options.tools }),
      ...(options.agents === undefined ? {} : { agents: options.agents }),
      ...(options.slashCommands === undefined ? {} : { slashCommands: options.slashCommands }),
      ...(options.channels === undefined ? {} : { channels: options.channels }),
    },
    keys: commandKeyValidator,
  }
}

async function disposeBootResources(options: DisposeBootOptions): Promise<void> {
  const { logger, loggerResource, disposeAssets, storage } = options
  const resources = disposalResources(disposeAssets, storage)
  const results = await Promise.allSettled(resources.map((resource) => resource.close()))

  logDisposeFailures(logger, resources, results)
  await loggerResource.close()
}

function disposalResources(
  disposeAssets: () => Promise<void>,
  storage: Storage | undefined
): readonly BootResource[] {
  const resources: BootResource[] = [{ name: 'mcp', close: disposeAssets }]

  if (storage !== undefined) {
    resources.push({ name: 'storage', close: () => storage.close() })
  }

  return resources
}

function logDisposeFailures(
  logger: Logger,
  resources: readonly BootResource[],
  results: readonly PromiseSettledResult<void>[]
): void {
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      logger.warn('boot.dispose_failed', {
        resource: resources[index]?.name ?? 'unknown',
        err: formatErrForLog(result.reason),
      })
    }
  }
}
