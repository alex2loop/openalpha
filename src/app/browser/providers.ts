import type { BrowserKeyring } from '@/app/browser/keys'
import type { KernelDeps } from '@/app/run-services'
import type { ResolvedConfig } from '@/core/config/resolve'
import type { App, ServiceProvider } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import type { UnrecordedSpend, UnrecordedSpendLoad } from '@/engine/api'
import type { OpenedPersistence } from '@/persistence/api'
import type { ScopedJobStore } from '@/tools/api'
import type { TradingConfig, TradingNoticeSender } from '@/trading/api'
import { createAiProvider } from '@/ai/api'
import { createBrowserEdition } from '@/app/browser/edition'
import { createBrowserSystemHost } from '@/app/browser/host'
import { createKeyringCredentials } from '@/app/browser/keys'
import { BROWSER_FETCH_GUARD } from '@/app/browser/network'
import { createBrowserRetrieval } from '@/app/browser/retrieval'
import { BROWSER_ROUTE_GROUPS } from '@/app/browser/routes'
import { commandKeyValidator } from '@/app/command-keys'
import {
  bindKernel,
  bindRunReads,
  buildToolServices,
  createCliCommandsProvider,
  extendHooks,
} from '@/app/run-services'
import { buildApiRoutes } from '@/app/server/http/routes'
import { createTaskStatusBoard } from '@/app/task-status'
import { createSpendReader } from '@/app/views'
import { createCommandsProvider, createResearchCommand } from '@/commands/api'
import { createCommandLane } from '@/core/command-lane'
import { createApp } from '@/core/container'
import { ConfigError } from '@/core/errors'
import { createEventBus } from '@/core/events'
import { PAGE_REQUEST_SHAPE } from '@/core/http-client'
import { createSessionQueue } from '@/core/session-queue'
import { createEmbeddedSkillCatalog, engineProvider } from '@/engine/api'
import { bindLocale } from '@/i18n'
import { memoryProvider } from '@/memory/api'
import { createConfigOverrideStore, createPersistenceProvider } from '@/persistence/api'
import { createPortableToolsProvider } from '@/tools/api'
import {
  BROWSER_FEEDS,
  BROWSER_REACHABLE_SOURCES,
  createTradingRegistrationProvider,
  createTradingStoresProvider,
  resolveTradingConfig,
  SOURCE_ROUTES,
  TRADING_SKILLS,
  toBrowserRoutes,
  withReachableFeeds,
} from '@/trading/api'

interface BrowserAppInput {
  readonly config: ResolvedConfig
  readonly persistence: OpenedPersistence
  readonly keyring: BrowserKeyring
  readonly logger: Logger
  readonly signal: AbortSignal
}

/** The container for one started worker: the kernel handles built here, since a page has no boot to
 *  build them in, over the storage the tab lock gave it. */
export function createBrowserApp(input: BrowserAppInput): App {
  const { config, logger } = input
  const providers = buildBrowserProviders({
    kernel: {
      logger,
      bus: createEventBus(logger),
      sessionQueue: createSessionQueue(),
      commandLane: createCommandLane(),
      childEnvBase: {},
    },
    persistence: input.persistence,
    tradingConfig: resolveTradingConfig({
      extensions: config.extensions,
      locale: config.locale,
    }),
    keyring: input.keyring,
  })

  return createApp(config, providers, { configPath: '', signal: input.signal })
}

interface BrowserProviderInput {
  readonly kernel: KernelDeps
  readonly persistence: OpenedPersistence
  readonly tradingConfig: TradingConfig
  readonly keyring: BrowserKeyring
}

/** A page keeps its workspace nowhere: the identity is a label no tool reads, since no file tool is
 *  offered. */
const VIRTUAL_WORKSPACE = Object.freeze({ path: '/', dev: 0, ino: 0 })

/** A page waits longer on a slow edge than a daemon does: treasury answered in about 9.2 s, which a
 *  10 s default clears by under a second. */
const SOURCE_ATTEMPT_TIMEOUT_MS = 15_000

/** The most unrecorded spend a tab remembers: it is read once, at start, so a longer tail has no
 *  reader. */
const MAX_SPEND_ENTRIES = 1_000

const refuseJobs = (): Promise<never> =>
  Promise.reject(new ConfigError('this edition has no scheduler'))

const NO_JOBS: ScopedJobStore = {
  add: refuseJobs,
  list: refuseJobs,
  resolveIdPrefix: refuseJobs,
  remove: refuseJobs,
}

const NO_SENDER: TradingNoticeSender = {
  send: async () => 'unavailable',
  resolveRecipient: async () => undefined,
}

/** The browser's provider list, in `app/providers.ts` order and under its constraints: a provider
 *  extends only what an earlier one bound. What a page cannot have is left out whole (channels, the
 *  scheduler, plugins, MCP, the operator's own agents, social, the update check); what it has
 *  differently is bound here: keys read on every request, a fetch that is the page's own, and no
 *  host directory. */
function buildBrowserProviders(input: BrowserProviderInput): readonly ServiceProvider[] {
  const { kernel, persistence, tradingConfig, keyring } = input

  return [
    createBrowserKernelProvider(kernel), // 0a-0c
    createPersistenceProvider(persistence), // 1
    createTradingStoresProvider(tradingConfig), // 2
    memoryProvider, // 3
    createAiProvider(() => createKeyringCredentials(keyring)), // 4
    engineProvider, // 5
    createPortableToolsProvider(
      (app) =>
        createBrowserRetrieval({
          config: app.config,
          logger: app.resolve('logger'),
          guard: BROWSER_FETCH_GUARD,
          keyring,
        }) // 6
    ),
    createCommandsProvider(() => [createResearchCommand()], commandKeyValidator, bindLocale), // 8
    createCliCommandsProvider(), // 8b
    createBrowserTradingProvider(tradingConfig, keyring), // 9
    createBrowserAppProvider(), // 13
    createBrowserApiProvider(keyring), // 15
  ]
}

// Step 9: no sender, no listeners and no loops, because nothing here runs while the tab is closed;
// the sources are the ones a browser reaches, sent no header of their own; and the edition narrows
// the markets, the commands, `/suggest` and the book's verdict reads to what the web offers.
function createBrowserTradingProvider(
  tradingConfig: TradingConfig,
  keyring: BrowserKeyring
): ServiceProvider {
  return createTradingRegistrationProvider({
    tradingConfig,
    env: {},
    sender: () => NO_SENDER,
    onFilled: () => () => undefined,
    onAlertFired: () => () => undefined,
    onAlertsChecked: () => () => undefined,
    onTaskPass: () => () => undefined,
    runScheduled: (app) => (request) => app.resolve('slashDispatcher').runScheduled(request),
    onRoleOutput: (app) => (output) => app.resolve('bus').emit('role_output', output),
    onFocusCallScored: () => () => undefined,
    recipient: () => undefined,
    keys: commandKeyValidator,
    pluginModules: [],
    requestShape: PAGE_REQUEST_SHAPE,
    routes: withReachableFeeds(
      toBrowserRoutes(SOURCE_ROUTES, BROWSER_REACHABLE_SOURCES),
      BROWSER_FEEDS
    ),
    sourceFacts: {
      plainUserAgentSources: new Set(),
      feeds: BROWSER_FEEDS,
      attemptTimeoutMs: SOURCE_ATTEMPT_TIMEOUT_MS,
    },
    reachability: async () => true,
    edition: (app) => createBrowserEdition(app, keyring),
  })
}

// Step 0 plus the host-bound services the engine names by interface only. A page has no scratch
// directory and no file to keep unrecorded spend in, so the first is a label and the second is the
// tab's memory.
function createBrowserKernelProvider(kernel: KernelDeps): ServiceProvider {
  return {
    name: 'kernel',
    register(bind): void {
      bindKernel(bind, kernel)
      bind('prepareWorkspace', () => async () => VIRTUAL_WORKSPACE)
      bind('unrecordedSpend', () => createMemorySpendLog())
      bind('taskStatus', (app) => createTaskStatusBoard(app.config.locale.language))
    },
  }
}

function createMemorySpendLog(): {
  append(entry: UnrecordedSpend): Promise<void>
  load(): Promise<UnrecordedSpendLoad>
} {
  const entries: UnrecordedSpend[] = []

  return {
    append: async (entry) => {
      entries.push(entry)
      entries.splice(0, Math.max(0, entries.length - MAX_SPEND_ENTRIES))
    },
    load: async () => ({ entries: [...entries], damaged: false, path: '' }),
  }
}

// Step 13: the bindings that exist because the composition root sees every module at once. No
// scheduler means no job store: the scoped one refuses, and no tool that reads it is offered.
function createBrowserAppProvider(): ServiceProvider {
  return {
    name: 'app',
    register(bind, extend): void {
      bind('skillCatalog', () => createEmbeddedSkillCatalog(Object.values(TRADING_SKILLS)))
      bind('toolServices', (app) => buildToolServices(app, NO_JOBS))
      bind('llmAttemptSink', (app) => ({
        record: (attempt) => app.resolve('llmAttemptStore').record(attempt),
      }))
      bind('spendReader', (app) => createSpendReader(app))
      bind('configOverrides', (app) =>
        createConfigOverrideStore(app.resolve('storage'), app.resolve('dialect'))
      )
      bindRunReads(bind)
      extend('hooks', extendHooks)
    },
  }
}

// Step 15: the api's data. There is no listener: the page asks through the worker, so only the
// route table and what the status routes read of the host are bound.
function createBrowserApiProvider(keyring: BrowserKeyring): ServiceProvider {
  return {
    name: 'api',
    register(bind): void {
      bind('apiRoutes', () => buildApiRoutes(BROWSER_ROUTE_GROUPS))
      bind('systemHost', (app) => createBrowserSystemHost(keyring, app.config))
    },
  }
}
