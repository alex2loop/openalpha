import type { Logger } from '@/core/logging/logger'
import type { CooldownTracker } from '@/core/utils/concurrency'
import type { Caveat, CaveatCode } from '@/trading/kernel/caveat'
import type { SourceId } from '@/trading/kernel/source/source-id'
import type {
  RegisteredSource,
  Source,
  SourceContext,
  SourceKind,
  SourceKindMap,
  SourceResult,
  SourceSummary,
} from '@/trading/kernel/source/source-result'
import type { ResolveSourceOptions, SourceRegistry } from '@/trading/markets/types'
import type { LoadedSourceModule } from '@/trading/sources/plugin-module'
import { abortError, ConfigError, isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { withCooldown } from '@/core/utils/concurrency'
import { unavailable } from '@/trading/kernel/source/source-result'
import { createRegistrationPhase } from '@/trading/registry-lifecycle'
import { createRequestCoalescer, sourceRequestKey } from '@/trading/sources/coalesce'
import { toRegisteredSource } from '@/trading/sources/define'
import { ANY_SCOPE, type SourceRouteTable } from '@/trading/sources/routes'

export type SourceRoutes = Readonly<Record<'firstParty' | 'plugins', SourceRouteTable>>

interface RegistryState {
  readonly routes: SourceRoutes
  readonly logger: Logger
  /** Scopes whose exhaustion has been reported recently, keyed `kind:scope`. */
  readonly announced: CooldownTracker
}

/** One line per scope per window while a provider family is dark. A universe-wide sweep exhausts
 *  the same route once per name, and a hundred identical lines bury the one that explains them. */
const ROUTE_EXHAUSTED_LOG_COOLDOWN_MS = 60_000

/** A provider that looked and could not name one asset still answered the question. Only a
 *  provider that could not look leaves it open, which is what separates a miss from an outage. */
const SETTLED_MISS_CODES: ReadonlySet<CaveatCode> = new Set([
  'source.symbol-not-found',
  'source.ambiguous-symbol',
  'source.empty-window',
])

/** Codes that report a provider's outage rather than the data that came back. A later provider
 *  answering makes them history, and a warning naming a source the operator never read from says
 *  the request broke when it succeeded. */
const OUTAGE_CODES: ReadonlySet<CaveatCode> = new Set([
  'source.unavailable',
  'source.timeout',
  'source.rate-limited',
  'source.quota-exhausted',
  'source.breaker-open',
  'source.payload-rejected',
  'source.empty-window',
  'source.stale-window',
  'source.symbol-not-found',
])

export function mergeSourceRoutes(
  base: SourceRouteTable,
  modules: readonly LoadedSourceModule[]
): SourceRoutes {
  const plugins: Partial<Record<SourceKind, Readonly<Record<string, readonly SourceId[]>>>> = {}

  for (const module of modules) {
    const id = module.manifest.id

    for (const route of module.manifest.routes) {
      const scopes = plugins[route.kind] ?? {}
      const current = routeAt(scopes, route.scope) ?? []

      if (!current.includes(id)) {
        plugins[route.kind] = { ...scopes, [route.scope]: [...current, id] }
      }
    }
  }

  // why-safe: every missing kind means that no plugin declared a route for it, which is the empty
  // scope table filled here.
  const completePlugins = Object.fromEntries(
    Object.keys(base).map((kind) => [kind, plugins[kind as SourceKind] ?? {}])
  ) as Record<SourceKind, Readonly<Record<string, readonly SourceId[]>>>

  return { firstParty: base, plugins: completePlugins }
}

export function createSourceRegistry(routes: SourceRoutes, logger: Logger): SourceRegistry {
  // `kind:id`, not `id`: one provider implements several kinds, each a separate Source.
  const phase = createRegistrationPhase<RegisteredSource>('source')
  // Fixed cardinality — one entry per kind and scope — so nothing needs eviction.
  const state: RegistryState = {
    routes,
    logger,
    announced: withCooldown(ROUTE_EXHAUSTED_LOG_COOLDOWN_MS),
  }
  const coalescer = createRequestCoalescer()

  return {
    register(source) {
      if (!isRoutedSource(routes, source.kind, source.id)) {
        throw new ConfigError(`source ${source.kind}:${source.id} has no failover position`)
      }

      phase.add(`${source.kind}:${source.id}`, toRegisteredSource(guardSource(source, state)))
    },
    close: phase.close,
    list: () => phase.entries().map((source) => source.summary()),
    resolve: (options) =>
      coalescer.share(sourceRequestKey(options.kind, options.context), options.signal, () =>
        resolveSource(state, phase.entries(), options)
      ),
    resolveAll: (options) => resolveAllSources(state, phase.entries(), options),
  }
}

/** The seam's promise, kept where every consumer passes: a source answers with a `SourceResult`.
 *  One adapter throwing — a derivation its payload cannot satisfy, a plugin's own bug — would
 *  otherwise abort the failover chain and take every provider behind it down with one request. An
 *  abort is the caller's own decision and still travels. */
function guardSource<K extends SourceKind>(source: Source<K>, state: RegistryState): Source<K> {
  return {
    ...source,
    covers: (context) => {
      try {
        return source.covers(context)
      } catch (err: unknown) {
        reportSourceThrow(state, source, err)

        return false
      }
    },
    fetch: async (context, signal) => {
      try {
        return await source.fetch(context, signal)
      } catch (err: unknown) {
        if (isAbortError(err)) {
          throw err
        }

        reportSourceThrow(state, source, err)

        return unavailable(
          'failed',
          [source.id],
          [
            {
              code: 'source.payload-rejected',
              detail: { source: source.id, sourceKind: source.kind },
            },
          ]
        )
      }
    },
  }
}

function reportSourceThrow(state: RegistryState, source: Source<SourceKind>, err: unknown): void {
  state.logger.warn('trading.source_threw', {
    sourceId: source.id,
    sourceKind: source.kind,
    err: formatErrForLog(err),
  })
}

export function isRoutedSource(routes: SourceRoutes, kind: SourceKind, id: SourceId): boolean {
  return [routes.firstParty, routes.plugins].some((table) =>
    Object.values(table[kind]).some((order) => order.includes(id))
  )
}

async function resolveSource<K extends SourceKind>(
  state: RegistryState,
  sources: readonly RegisteredSource[],
  options: ResolveSourceOptions<K>
): Promise<SourceResult<SourceKindMap[K]>> {
  const routed = routedSources(state.routes, sources, options)

  if (routed.length === 0) {
    return unavailable('unconfigured', [])
  }

  const eligible = routed.filter((source) => source.covers(options.context))

  if (eligible.length === 0) {
    return unavailable('unsupported', [])
  }

  return failoverSources(state, eligible, options)
}

/** Complementary providers run together, unlike failover's interchangeable ones: a kind whose value
 *  is a record of series has no single source that can answer the whole request. */
function resolveAllSources<K extends SourceKind>(
  state: RegistryState,
  sources: readonly RegisteredSource[],
  options: ResolveSourceOptions<K>
): Promise<readonly SourceResult<SourceKindMap[K]>[]> {
  if (options.signal.aborted) {
    return Promise.reject(abortError(options.signal))
  }

  // Health demotes on the failover path and is inert here, where every leg runs anyway — so an open
  // breaker has to skip, or one dark provider spends its whole deadline on every merged read. Only
  // the breaker, never `isDegraded`: a single failure must not drop a leg that is merely having a
  // bad minute.
  const eligible = routedSources(state.routes, sources, options).filter(
    (source) => source.covers(options.context) && source.summary().breaker !== 'open'
  )

  return Promise.all(eligible.map((source) => source.fetch(options.context, options.signal)))
}

function routedSources<K extends SourceKind>(
  routes: SourceRoutes,
  sources: readonly RegisteredSource[],
  options: ResolveSourceOptions<K>
): readonly Source<K>[] {
  return orderByHealth(
    orderByFailover(sources, options.kind, resolveRouteOrder(routes, options.kind, options.context))
  )
}

/** Health demotes, it never promotes: a provider whose last answer was a failure drops behind the
 *  healthy ones, and everything else keeps its route-table position (stable sort). Sorting on
 *  success recency instead would rank a fallback by work it did for another kind — one marketCap
 *  call put CoinGecko ahead of Binance for every bars request that followed, and the paced fallback
 *  then served a whole screen the unpaced primary was routed first for. */
function orderByHealth<K extends SourceKind>(sources: readonly Source<K>[]): readonly Source<K>[] {
  return sources
    .map((source) => ({ source, degraded: isDegraded(source.summary()) }))
    .sort((left, right) => Number(left.degraded) - Number(right.degraded))
    .map((entry) => entry.source)
}

/** `recordSuccess` clears the failure code, so one surviving means the newest event was a failure. */
function isDegraded(summary: Omit<SourceSummary, 'kind'>): boolean {
  return summary.breaker === 'open' || summary.lastFailureCode !== undefined
}

function resolveRouteOrder(
  routes: SourceRoutes,
  kind: SourceKind,
  context: SourceContext
): readonly SourceId[] {
  const firstParty = resolveScopedRoute(routes.firstParty[kind], context)
  const plugins = resolveScopedRoute(routes.plugins[kind], context)

  return [...firstParty, ...plugins.filter((id) => !firstParty.includes(id))]
}

function resolveScopedRoute(
  scoped: Readonly<Record<string, readonly SourceId[]>>,
  context: SourceContext
): readonly SourceId[] {
  return (
    (context.market === undefined ? undefined : routeAt(scoped, context.market)) ??
    (context.region === undefined ? undefined : routeAt(scoped, context.region)) ??
    routeAt(scoped, ANY_SCOPE) ??
    []
  )
}

function routeAt(
  scoped: Readonly<Record<string, readonly SourceId[]>>,
  scope: string
): readonly SourceId[] | undefined {
  return Object.hasOwn(scoped, scope) ? scoped[scope] : undefined
}

function orderByFailover<K extends SourceKind>(
  sources: readonly RegisteredSource[],
  kind: K,
  order: readonly SourceId[]
): readonly Source<K>[] {
  const byId = new Map<SourceId, RegisteredSource>(
    sources.filter((source) => source.kind === kind).map((source) => [source.id, source])
  )
  const ordered = order
    .map((id) => byId.get(id))
    .filter((source): source is RegisteredSource => source !== undefined)

  // why-safe: the map holds only sources whose `kind` equals the requested `kind`.
  return ordered as unknown as readonly Source<K>[]
}

async function failoverSources<K extends SourceKind>(
  state: RegistryState,
  sources: readonly Source<K>[],
  options: ResolveSourceOptions<K>
): Promise<SourceResult<SourceKindMap[K]>> {
  const attempted: SourceId[] = []
  const caveats: Caveat[] = []
  const empty: SourceId[] = []
  const silent: SourceId[] = []
  let settled = 0

  for (const source of sources) {
    if (options.signal.aborted) {
      throw abortError(options.signal)
    }

    attempted.push(source.id)

    const result = await source.fetch(options.context, options.signal)

    if (result.kind === 'available' && hasUsableValue(result.value)) {
      return { ...result, caveats: [...recoveredCaveats(caveats, source.id), ...result.caveats] }
    }

    caveats.push(...result.caveats)

    if (result.kind === 'available') {
      empty.push(source.id)
    } else if (result.caveats.length === 0) {
      silent.push(source.id)
    }

    if (isSettledAnswer(result)) {
      settled += 1
    }
  }

  // A provider that answered with nothing is not one that never answered: a suspended name or a
  // small cap with no foreign flow is healthy, and every provider answering that way is a settled
  // miss rather than an outage. The caveats are reported only on this path, so a recovered request
  // carries no note about the provider it passed over, and the kind travels with them because one
  // run reads several kinds from the same provider.
  if (settled < attempted.length) {
    reportExhausted(state, options, { attempted, caveats })

    // Whoever answered empty is not why this route failed, and naming them alone reads as that one
    // provider being at fault for an asset the route as a whole could not serve — the more so
    // because a provider that does not list the asset says nothing at all, so the only name printed
    // is the one that looked. What is true here is that every provider was tried.
    return unavailable('failed', attempted, [
      ...caveats,
      ...exhaustedCaveats(options.kind, { attempted, caveats }),
    ])
  }

  return unavailable('empty', attempted, [
    ...caveats,
    ...empty.map(
      (id): Caveat => ({
        code: 'source.empty-window',
        detail: { source: id, sourceKind: options.kind },
      })
    ),
    ...unlistedCaveats(silent, options.context),
  ])
}

/** A lone provider's own failure line already says the kind is missing. */
function exhaustedCaveats(
  kind: SourceKind,
  tried: { readonly attempted: readonly SourceId[]; readonly caveats: readonly Caveat[] }
): readonly Caveat[] {
  if (tried.attempted.length === 1 && tried.caveats.length > 0) {
    return []
  }

  return [{ code: 'source.no-available-provider', detail: { sourceKind: kind } }]
}

/** What a recovered route reports: the outage notes are replaced by one info line naming the
 *  provider that failed and the one that answered, so the provenance survives without reading as a
 *  degradation. A provider that declined silently carries no caveat, so nothing is announced for a
 *  route that simply fell through to the source covering the asset. */
function recoveredCaveats(caveats: readonly Caveat[], fallback: SourceId): readonly Caveat[] {
  const kept = caveats.filter((caveat) => !OUTAGE_CODES.has(caveat.code))

  if (kept.length === caveats.length) {
    return caveats
  }

  const failed = caveats.find((caveat) => OUTAGE_CODES.has(caveat.code))?.detail?.source

  return failed === undefined
    ? kept
    : [...kept, { code: 'source.recovered', detail: { source: failed, fallback } }]
}

/** The sources that declined without saying anything, named once the route as a whole came back
 *  with nothing: `define` strips a decline's code, so nothing below reports it and the surface
 *  prints "nothing reported" with no provider on it. Only where the request names an instrument,
 *  which is what the caveat claims about. */
function unlistedCaveats(silent: readonly SourceId[], context: SourceContext): readonly Caveat[] {
  const { instrument } = context

  if (instrument === undefined) {
    return []
  }

  return silent.map(
    (id): Caveat => ({
      code: 'source.symbol-not-found',
      detail: { source: id, ticker: instrument.ticker },
    })
  )
}

/** Every provider for a scope failed, which is the moment a surface degrades and the one thing the
 *  breaker's own line cannot say: a kind with no fallback left reads the same as one that never had
 *  a second provider. Reported once per scope per window, because a sweep exhausts the same route
 *  once per name. An `empty` answer is settled and says nothing about reachability. */
function reportExhausted<K extends SourceKind>(
  state: RegistryState,
  options: ResolveSourceOptions<K>,
  outcome: { readonly attempted: readonly SourceId[]; readonly caveats: readonly Caveat[] }
): void {
  const scope = options.context.market ?? options.context.region ?? ANY_SCOPE
  const key = `${options.kind}:${scope}`

  if (state.announced.isOnCooldown(key)) {
    return
  }

  state.announced.recordFailure(key)
  state.logger.warn('trading.source_route_exhausted', {
    sourceKind: options.kind,
    scope,
    attempted: outcome.attempted.join(', '),
    codes: [...new Set(outcome.caveats.map((caveat) => caveat.code))].join(', '),
  })
}

function hasUsableValue(value: unknown): boolean {
  return !Array.isArray(value) || value.length > 0
}

/** Whether the provider answered rather than failed to. A decline — a symbol it does not list, a
 *  shape it does not serve — is an answer, and `define` strips the code off one, so `reason` is all
 *  that is left to read it by. A silent failure is not settled: with nothing said at all, the
 *  request stays unanswered. */
function isSettledAnswer(result: SourceResult<unknown>): boolean {
  if (result.kind === 'available' || result.reason === 'unsupported') {
    return true
  }

  const { caveats } = result

  return caveats.length > 0 && caveats.every((caveat) => SETTLED_MISS_CODES.has(caveat.code))
}
