import type { BrowserKeyring } from '@/app/browser/keys'
import type { WireEvent } from '@/app/server/wire/events'
import type { Capabilities } from '@/app/server/wire/system'
import type { WorkerRefusal } from '@/app/server/wire/worker'
import type { ChatClient } from '@/app/server/ws/runs'
import type { WsServices } from '@/app/server/ws/services'
import type { ApiRouteContext } from '@/app/types'
import type { App } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { Storage } from '@/core/types/storage'
import type { DatabaseFiles } from '@/persistence/api'
import { resolveBrowserConfig } from '@/app/browser/config'
import { readBrowserOverrides } from '@/app/browser/config-routes'
import { authorizeVisitor } from '@/app/browser/host'
import { createLabelledRunner } from '@/app/browser/labelled-runner'
import { createBrowserApp } from '@/app/browser/providers'
import { startBrowserUpkeep } from '@/app/browser/upkeep'
import { hydrateCostTracker } from '@/app/cost-hydration'
import { createLiveFeed } from '@/app/server/feed/live'
import { buildCapabilities } from '@/app/server/http/capabilities'
import { describeCommand } from '@/commands/api'
import { BRAND } from '@/core/brand'
import { formatErrForLog } from '@/core/security/credentials'
import { RUN_LEASE_SLACK_MS } from '@/engine/api'
import { bindLocale } from '@/i18n'
import {
  createConfigOverrideStore,
  migrate,
  openSqliteWasm,
  SchemaAheadError,
  StorageFullError,
  sqliteDialect,
} from '@/persistence/api'

const DB_NAME = `${BRAND.name}.db`

interface OpenedStorage {
  readonly storage: Storage
  readonly files: DatabaseFiles
  readonly lost: Promise<void>
}

interface RootInput {
  readonly locale: Locale
  readonly steal: boolean
  readonly keyring: BrowserKeyring
  readonly logger: Logger
  readonly wasmUrl: string
  /** Where the live feed's events go: to the page. */
  readonly broadcast: (event: WireEvent) => void
}

/** Everything one started worker holds: the container, what a request runs under, the chat client
 *  its runs belong to, and the way to let go of all of it. */
export interface BrowserRoot {
  readonly app: App
  readonly route: ApiRouteContext
  readonly chat: ChatClient
  readonly capabilities: Capabilities
  /** The database as a file: read out, checked and swapped. */
  readonly files: DatabaseFiles
  /** Settles when another tab takes the database. */
  readonly lost: Promise<void>
  /** Runs the upkeep pass now if the last one is an interval old; the page calls it on waking. */
  wake(): void
  /** Releases the live feed and the database; safe to call twice. */
  close(): Promise<void>
}

export type OpenedRoot =
  | { readonly kind: 'opened'; readonly root: BrowserRoot }
  | { readonly kind: 'refused'; readonly reason: WorkerRefusal }

/** Opens the database under the tab lock, migrates it, reads what the visitor changed of the
 *  config, and composes the engine over it. Anything that stops the database being served comes
 *  back as the refusal the page words; the lock is released on every path that does not return a
 *  root. */
export async function openBrowserRoot(input: RootInput): Promise<OpenedRoot> {
  try {
    const opened = await openSqliteWasm({
      name: DB_NAME,
      wasmUrl: input.wasmUrl,
      logger: input.logger,
      steal: input.steal,
    })

    if (opened.kind !== 'opened') {
      return { kind: 'refused', reason: opened.kind === 'locked' ? 'locked' : 'unsupported' }
    }

    return { kind: 'opened', root: await composeRoot(input, opened) }
  } catch (err: unknown) {
    input.logger.error('browser.root_failed', { err: formatErrForLog(err) })

    return { kind: 'refused', reason: toRefusal(err) }
  }
}

/** Puts `bytes` back as the working database when a replacement could not be started: opens the
 *  database under the lock, swaps, and lets go, building nothing else. False when the lock was not
 *  free. */
export async function restoreDatabase(
  input: Pick<RootInput, 'wasmUrl' | 'logger'>,
  bytes: Uint8Array
): Promise<boolean> {
  const opened = await openSqliteWasm({
    name: DB_NAME,
    wasmUrl: input.wasmUrl,
    logger: input.logger,
    steal: false,
  })

  if (opened.kind !== 'opened') {
    return false
  }

  try {
    await opened.files.replaceWith(bytes)

    return true
  } finally {
    await opened.storage.close()
  }
}

function toRefusal(err: unknown): WorkerRefusal {
  if (err instanceof SchemaAheadError) {
    return 'newer-schema'
  }

  return err instanceof StorageFullError ? 'storage-full' : 'unsupported'
}

// The lock is released and the shutdown signal raised on every path that does not return a root.
async function composeRoot(input: RootInput, opened: OpenedStorage): Promise<BrowserRoot> {
  const { storage } = opened
  const shutdown = new AbortController()

  try {
    await migrate(storage, sqliteDialect, { logger: input.logger })

    const overrides = await readBrowserOverrides(
      createConfigOverrideStore(storage, sqliteDialect),
      input.logger,
      shutdown.signal
    )
    const app = createBrowserApp({
      config: resolveBrowserConfig(input.locale, overrides),
      persistence: { storage, dialect: sqliteDialect },
      keyring: input.keyring,
      logger: input.logger,
      signal: shutdown.signal,
    })

    await prepareApp(app)

    return assembleRoot({ input, app, opened, shutdown })
  } catch (err: unknown) {
    shutdown.abort()
    await storage.close()

    throw err
  }
}

// Resolved here so a misconfigured composition fails at start, not at the first command; the cost
// totals come back from the attempt ledger so a cap still counts what earlier visits spent, and a
// session a closed tab left running is no one's work now.
async function prepareApp(app: App): Promise<void> {
  app.resolve('tradingServices')
  app.resolve('apiRoutes')

  await hydrateCostTracker(app)
  await app
    .resolve('sessionStore')
    .markStaleRuns(Date.now() - (app.config.loop.maxDurationMs + RUN_LEASE_SLACK_MS))
}

interface AssembleParts {
  readonly input: RootInput
  readonly app: App
  readonly opened: OpenedStorage
  readonly shutdown: AbortController
}

function assembleRoot(parts: AssembleParts): BrowserRoot {
  const { input, app, opened, shutdown } = parts
  const live = createLiveFeed({
    bus: app.resolve('bus'),
    logger: app.resolve('logger'),
    broadcast: input.broadcast,
    locale: app.config.locale.language,
    tasks: app.resolve('taskStatus'),
    describeCommand: (name) => describeKnown(app, name),
    liveRunIds: () =>
      new Set([
        ...app
          .resolve('runRegistry')
          .active()
          .map((handle) => handle.identity.runId),
        ...app.resolve('slashDispatcher').activeCommands(),
      ]),
  })
  const route: ApiRouteContext = { app, live, authorize: authorizeVisitor, isReady: () => true }
  let closed: Promise<void> | undefined
  const chat = createChatClient(app)
  const capabilities = buildCapabilities(app)
  // Started after everything that can throw, so a failed assembly never leaves it running.
  const upkeep = startBrowserUpkeep(app, app.resolve('logger'))

  return {
    app,
    route,
    chat,
    capabilities,
    files: opened.files,
    lost: opened.lost,
    wake: upkeep.runIfDue,
    close: () => {
      closed ??= (async () => {
        shutdown.abort()
        live.stop()
        await upkeep.stop()
        await opened.storage.close()
      })()

      return closed
    },
  }
}

function describeKnown(app: App, name: string): string | undefined {
  const command = app
    .resolve('slashDispatcher')
    .all()
    .find((known) => known.name === name)

  return command === undefined
    ? undefined
    : describeCommand(bindLocale(app.config.locale.language), command.description)
}

function createChatClient(app: App): ChatClient {
  return {
    services: createWsServices(app),
    activeRuns: new Map(),
    commandRuns: new Map(),
    steerIds: new Map(),
  }
}

// The same handles the daemon's socket runs a chat on, with the two a page does not have: orders
// are never on, and there is no browser session to check.
function createWsServices(app: App): WsServices {
  return {
    agents: app.resolve('agents'),
    apiOrders: false,
    bindings: app.resolve('chatBindingStore'),
    browserSessions: { has: async () => true },
    bus: app.resolve('bus'),
    commandLane: app.resolve('commandLane'),
    locale: app.config.locale.language,
    logger: app.resolve('logger'),
    runControl: app.resolve('runRegistry'),
    runner: createLabelledRunner(app.resolve('runner'), app.config.locale.language),
    sessionQueue: app.resolve('sessionQueue'),
    sessions: app.resolve('sessionStore'),
    slashDispatcher: app.resolve('slashDispatcher'),
  }
}
