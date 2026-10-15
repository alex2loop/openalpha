import type { ResolvedConfig } from '@/core/config/resolve'
import { ConfigError } from '@/core/errors'

// resolve() is a service locator: call it ONLY in app/providers.ts and per-module
// services.ts files. Everywhere else, dependencies are injected as constructor/factory args.

// biome-ignore lint/suspicious/noEmptyInterface: modules declare their service slots here.
export interface Services {}

export interface App {
  resolve<K extends keyof Services>(key: K): Services[K]
  /** Whether `key` would resolve. Lets an optional binding (e.g. a host-supplied API) be probed without a throw. */
  has<K extends keyof Services>(key: K): boolean
  readonly config: ResolvedConfig
  readonly configPath: string
  readonly signal: AbortSignal
}

interface CreateAppOptions {
  readonly configPath: string
  readonly signal: AbortSignal
}

export type Bind = <K extends keyof Services>(key: K, factory: (app: App) => Services[K]) => void

export type Extend = <K extends keyof Services>(
  key: K,
  fn: (current: Services[K], app: App) => Services[K]
) => void

export interface ServiceProvider {
  readonly name: string
  register(bind: Bind, extend: Extend): void
}

export interface DaemonTask {
  readonly name: string
  start(signal: AbortSignal): Promise<void>
}

interface Registration<K extends keyof Services> {
  factory: (app: App) => Services[K]
  extensions: Array<(current: Services[K], app: App) => Services[K]>
}

export function createApp(
  config: ResolvedConfig,
  providers: readonly ServiceProvider[],
  options: CreateAppOptions
): App {
  const registry = new Map<keyof Services, Registration<keyof Services>>()
  const singletons = new Map<keyof Services, Services[keyof Services]>()
  const resolving = new Set<keyof Services>()
  const bind = createBind(registry)
  const extend = createExtend(registry)
  const app: App = {
    config,
    configPath: options.configPath,
    signal: options.signal,
    resolve: (key) => resolveService(key, { registry, singletons, resolving, app }),
    has: (key) => registry.has(key) || singletons.has(key),
  }

  for (const provider of providers) {
    provider.register(bind, extend)
  }

  return app
}

function createBind(registry: Map<keyof Services, Registration<keyof Services>>): Bind {
  return (key, factory) => {
    if (registry.has(key)) {
      throw new ConfigError(`service already bound: ${String(key)}`)
    }

    // The registry is keyed by the heterogenous `Services` index, so the per-key generic is erased
    // on the way in, and `resolveService` restores it on the way out under that same key.
    // why-safe: nothing between those two points reads the value at a different key.
    registry.set(key, { factory, extensions: [] } as Registration<keyof Services>)
  }
}

function createExtend(registry: Map<keyof Services, Registration<keyof Services>>): Extend {
  return (key, fn) => {
    const existing = registry.get(key)

    if (!existing) {
      throw new ConfigError(`cannot extend unbound service: ${String(key)}`)
    }

    existing.extensions.push(
      // The `unknown` hop is needed because once `Services` has 2+ keys, the union and the indexed
      // access stop overlapping structurally.
      // why-safe: stored under the key it was registered with, so it only sees the type it declared.
      fn as unknown as (current: Services[keyof Services], app: App) => Services[keyof Services]
    )
  }
}

function resolveService<K extends keyof Services>(
  key: K,
  ctx: {
    registry: Map<keyof Services, Registration<keyof Services>>
    singletons: Map<keyof Services, Services[keyof Services]>
    resolving: Set<keyof Services>
    app: App
  }
): Services[K] {
  if (ctx.singletons.has(key)) {
    // `has`, not a value check: a factory may cache `undefined` and that is still a hit.
    // why-safe: this function is the map's only writer, and it writes `Services[K]` under `key`.
    return ctx.singletons.get(key) as Services[K]
  }

  if (ctx.resolving.has(key)) {
    throw new ConfigError(`circular service dependency: ${String(key)}`)
  }

  const reg = ctx.registry.get(key)

  if (!reg) {
    throw new ConfigError(`service not bound: ${String(key)}`)
  }

  ctx.resolving.add(key)
  try {
    let value = reg.factory(ctx.app)
    for (const ext of reg.extensions) {
      value = ext(value, ctx.app)
    }

    ctx.singletons.set(key, value)
    // why-safe: `value` is what the factory and extensions bound to this same `key` produced.
    return value as Services[K]
  } finally {
    // Always clear the in-progress marker: a failed factory must surface its own error
    // on retry, not a bogus circular-dependency report.
    ctx.resolving.delete(key)
  }
}
