import { pathToFileURL } from 'node:url'

import { z } from 'zod'

import type { Logger } from '@/core/logging/logger'
import type { PluginSourceModule } from '@/core/types/plugin'
import type { Caveat } from '@/trading/kernel/caveat'
import type { SourceId } from '@/trading/kernel/source/source-id'
import type { RegisteredSource, SourceKind } from '@/trading/kernel/source/source-result'
import type {
  ParsedSource,
  SourceAdapterOptions,
  UnboundSourceSpec,
} from '@/trading/sources/define'
import type { SourceHttp, SourceRequest } from '@/trading/sources/types'
import { ConfigError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { isSourceId } from '@/trading/kernel/source/source-id'
import { SOURCE_KINDS } from '@/trading/kernel/source/source-result'
import { createSource, parsedSource, toRegisteredSource } from '@/trading/sources/define'

const IMPORT_TIMEOUT_MS = 5_000
const TRAILING_SLASH_RE = /\/$/

const RouteSchema = z.strictObject({
  kind: z.enum(SOURCE_KINDS),
  scope: z.string().min(1),
})

const ManifestSchema = z.strictObject({
  id: z.custom<SourceId>((value) => typeof value === 'string' && isSourceId(value), {
    message: 'Invalid source id',
  }),
  endpoint: z.url().refine(isHttpEndpoint, { message: 'Endpoint must use HTTP or HTTPS' }),
  rateLimitPerMinute: z.number().int().positive().optional(),
  credentialEnv: z.string().min(1).optional(),
  routes: z.array(RouteSchema).nonempty(),
})

type PluginSourceManifest = z.infer<typeof ManifestSchema>

/** The plugin's whole surface. `define` is `createSource` with the module's id and pinned transport
 *  already bound, so a plugin can neither claim another provider's id nor reach another host
 *  through the shared client. */
interface SourceKit {
  define<K extends SourceKind>(spec: UnboundSourceSpec<K>): RegisteredSource
  ok<T>(value: T, caveats?: readonly Caveat[]): ParsedSource<T>
}

export interface LoadedSourceModule {
  readonly pluginId: string
  readonly manifest: PluginSourceManifest
  create(options: SourceAdapterOptions): readonly RegisteredSource[]
}

type CreateSources = (kit: SourceKit) => readonly RegisteredSource[]

const ModuleSchema = z.strictObject({
  manifest: ManifestSchema,
  createSources: z.custom<CreateSources>((value) => typeof value === 'function'),
})

interface LoadPluginSourcesOptions {
  readonly modules: readonly PluginSourceModule[]
  readonly logger: Logger
}

/** Sequential, not `Promise.all`: a plugin module executes on import, and boot should not run
 *  several unknown modules concurrently. */
export async function loadPluginSourceModules(
  options: LoadPluginSourcesOptions
): Promise<readonly LoadedSourceModule[]> {
  const loaded: LoadedSourceModule[] = []

  for (const source of options.modules) {
    try {
      loaded.push(toLoadedModule(source, await importWithin(source.modulePath)))
    } catch (err: unknown) {
      options.logger.warn('trading.plugin_source_skipped', {
        plugin: source.pluginId,
        err: formatErrForLog(err),
      })
    }
  }

  return loaded
}

/** The import cannot be cancelled once started; the timeout bounds how long boot waits for it, and
 *  the timer is cleared on both paths so a fast module leaves nothing pending. */
async function importWithin(path: string): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      import(pathToFileURL(path).href),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new ConfigError(`plugin source module timed out: ${path}`)),
          IMPORT_TIMEOUT_MS
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function toLoadedModule(source: PluginSourceModule, exported: unknown): LoadedSourceModule {
  const shape = ModuleSchema.safeParse(exported)

  if (!shape.success) {
    throw new ConfigError(`plugin ${source.pluginId} sources.ts: ${shape.error.issues[0]?.message}`)
  }

  const { manifest, createSources } = shape.data

  return {
    pluginId: source.pluginId,
    manifest,
    create: (options) => createSources(createKit(manifest, options)),
  }
}

function createKit(manifest: PluginSourceManifest, options: SourceAdapterOptions): SourceKit {
  const http = createPinnedPluginHttp(manifest, options.http)

  return {
    define: <K extends SourceKind>(spec: UnboundSourceSpec<K>): RegisteredSource => {
      if ('load' in spec) {
        throw new ConfigError(`plugin source ${manifest.id} cannot define a loaded source`)
      }

      return toRegisteredSource(createSource({ ...spec, id: manifest.id, http }))
    },
    ok: parsedSource,
  }
}

function isHttpEndpoint(raw: string): boolean {
  const protocol = new URL(raw).protocol

  return protocol === 'http:' || protocol === 'https:'
}

function createPinnedPluginHttp(manifest: PluginSourceManifest, http: SourceHttp): SourceHttp {
  const endpoint = new URL(manifest.endpoint)
  const basePath = endpoint.pathname === '/' ? '' : endpoint.pathname.replace(TRAILING_SLASH_RE, '')
  const pin = <T extends SourceRequest>(request: T): T =>
    assertPinnedRequest({ id: manifest.id, endpoint, basePath, request })

  return {
    summary: http.summary,
    getText: (request) => http.getText(pin(request)),
    getJson: (request, parse) => http.getJson(pin(request), parse),
    postJson: (request, parse) => http.postJson(pin(request), parse),
    getJsonPages: (request, extractRows) => http.getJsonPages(pin(request), extractRows),
  }
}

interface PinnedRequestOptions<T extends SourceRequest> {
  readonly id: SourceId
  readonly endpoint: URL
  readonly basePath: string
  readonly request: T
}

function assertPinnedRequest<T extends SourceRequest>(options: PinnedRequestOptions<T>): T {
  if (options.request.feedId !== undefined) {
    throw new ConfigError(`plugin source ${options.id} cannot select a feed`)
  }

  const target = resolvePluginTarget(options)

  if (target.origin !== options.endpoint.origin) {
    throw new ConfigError(`plugin source ${options.id} request left its manifest origin`)
  }

  return options.request
}

function resolvePluginTarget(options: PinnedRequestOptions<SourceRequest>): URL {
  try {
    return new URL(`${options.endpoint.origin}${options.basePath}${options.request.path}`)
  } catch (err: unknown) {
    throw new ConfigError(`plugin source ${options.id} request has an invalid path`, err)
  }
}
