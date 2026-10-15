import type { Caveat, CaveatCode } from '@/trading/kernel/caveat'
import type { SourceId } from '@/trading/kernel/source/source-id'
import type {
  RegisteredSource,
  Source,
  SourceContext,
  SourceKind,
  SourceKindMap,
  SourceResult,
} from '@/trading/kernel/source/source-result'
import type { SourceFetchOutcome, SourceHttp, SourceRequest } from '@/trading/sources/types'
import { isAbortError } from '@/core/errors'
import { available, unavailable } from '@/trading/kernel/source/source-result'

export interface SourceAdapterOptions {
  readonly http: SourceHttp
}

export interface ParsedSource<T> {
  readonly value: T
  readonly caveats: readonly Caveat[]
}

interface SourceSpecBase<K extends SourceKind> {
  readonly id: SourceId
  readonly kind: K
  readonly http: SourceHttp
  covers(context: SourceContext): boolean
  observedAt?(value: SourceKindMap[K]): number | undefined
}

interface RequestSourceSpec<K extends SourceKind> extends SourceSpecBase<K> {
  readonly format: 'json' | 'text'
  request(context: SourceContext): Omit<SourceRequest, 'sourceId' | 'signal'> | null
  parse(raw: unknown, context: SourceContext, fetchedAt: number): ParsedSource<SourceKindMap[K]>
  /** `extractRows` pulls one page's row array out of its raw JSON; `getJsonPages` chases follow-up
   *  pages and hands the concatenated rows to `parse` once, in that same shape. */
  readonly paged?: {
    readonly pageSize: number
    readonly pageParam?: string
    extractRows(raw: unknown): readonly unknown[]
  }
}

export interface LoadedSourceSpec<K extends SourceKind> extends SourceSpecBase<K> {
  load(
    context: SourceContext,
    signal: AbortSignal
  ): Promise<SourceFetchOutcome<ParsedSource<SourceKindMap[K]>>>
}

type SourceSpec<K extends SourceKind> = RequestSourceSpec<K> | LoadedSourceSpec<K>

type PluginSourceRequest = Omit<SourceRequest, 'sourceId' | 'signal' | 'feedId'> & {
  readonly feedId?: never
}

interface PluginRequestSourceSpec<K extends SourceKind>
  extends Omit<RequestSourceSpec<K>, 'id' | 'http' | 'request'> {
  request(context: SourceContext): PluginSourceRequest | null
}

/** A plugin writes a request-based spec minus the fields the kit binds. First-party adapters may
 *  still use `LoadedSourceSpec`; plugins always cross the kit's pinned HTTP boundary. */
export type UnboundSourceSpec<K extends SourceKind> = PluginRequestSourceSpec<K>

export function createSource<K extends SourceKind>(spec: SourceSpec<K>): Source<K> {
  return {
    id: spec.id,
    kind: spec.kind,
    covers: spec.covers,
    summary: () => ({ ...spec.http.summary(spec.id), kind: spec.kind }),

    async fetch(context, signal): Promise<SourceResult<SourceKindMap[K]>> {
      if (!spec.covers(context)) {
        return unavailable('unsupported', [spec.id])
      }

      const outcome =
        'load' in spec
          ? await spec.load(context, signal)
          : await requestOutcome(spec, context, signal)

      if (outcome === null) {
        return unavailable('unsupported', [spec.id])
      }

      if (outcome.kind === 'error') {
        return unavailableFromFetch(spec.id, spec.kind, outcome.code)
      }

      const observedAt = spec.observedAt?.(outcome.value.value)

      return available(
        outcome.value.value,
        [
          {
            sourceId: spec.id,
            fetchedAt: outcome.fetchedAt,
            freshness: 'live',
            ...(observedAt === undefined ? {} : { observedAt }),
          },
        ],
        [
          ...outcome.value.caveats,
          ...(outcome.truncated
            ? [{ code: 'source.truncated' as const, detail: { source: spec.id } }]
            : []),
        ]
      )
    },
  }
}

/** `Source<K>` for a concrete K is one member of the RegisteredSource union; the generic parameter
 *  is what keeps the compiler from seeing that. */
export function toRegisteredSource<K extends SourceKind>(source: Source<K>): RegisteredSource {
  return source as unknown as RegisteredSource
}

async function requestOutcome<K extends SourceKind>(
  spec: RequestSourceSpec<K>,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<SourceKindMap[K]>> | null> {
  const request = spec.request(context)

  return request === null
    ? null
    : fetchOutcome(spec, { ...request, sourceId: spec.id, signal }, context)
}

// Every path ends at the same parsed value: text is never handed back unparsed, and paged rows are
// parsed once, after pagination.
async function fetchOutcome<K extends SourceKind>(
  spec: RequestSourceSpec<K>,
  request: SourceRequest,
  context: SourceContext
): Promise<SourceFetchOutcome<ParsedSource<SourceKindMap[K]>>> {
  if (spec.paged) {
    const pages = await spec.http.getJsonPages(
      {
        ...request,
        pageSize: spec.paged.pageSize,
        ...(spec.paged.pageParam === undefined ? {} : { pageParam: spec.paged.pageParam }),
      },
      spec.paged.extractRows
    )

    return mapOutcome(pages, (rows, fetchedAt) => spec.parse({ data: rows }, context, fetchedAt))
  }

  if (spec.format === 'text') {
    return mapOutcome(await spec.http.getText(request), (raw, fetchedAt) =>
      spec.parse(raw, context, fetchedAt)
    )
  }

  return spec.http.getJson(request, (raw, fetchedAt) => spec.parse(raw, context, fetchedAt))
}

// getText carries a string and getJson the parsed T; after spec.parse both are the one shape
// fetch() reads. Throwing from `parse` is the only way an adapter rejects a payload, so the
// throw-to-caveat mapping lives here; the JSON path gets the same mapping inside the transport.
// Exported because an adapter folding after its transport call is outside that mapping: the
// registry's guard still catches the throw, but it reports `trading.source_threw` — an adapter
// defect — for what is only a payload this provider cannot satisfy.
export function mapOutcome<T, U>(
  outcome: SourceFetchOutcome<T>,
  map: (value: T, fetchedAt: number) => U
): SourceFetchOutcome<U> {
  if (outcome.kind !== 'ok') {
    return outcome
  }

  try {
    return { ...outcome, value: map(outcome.value, outcome.fetchedAt) }
  } catch (err: unknown) {
    // The caller's cancel is not a payload rejection — it must keep propagating.
    if (isAbortError(err)) {
      throw err
    }

    return { kind: 'error', code: 'source.payload-rejected' }
  }
}

export function parsedSource<T>(value: T, caveats: readonly Caveat[] = []): ParsedSource<T> {
  return { value, caveats }
}

// The failure code is threaded through: `unavailable/failed` alone cannot tell a timeout from a
// payload rejection. The kind travels with it because `source.empty-window` names what the provider
// had nothing of, and one provider answers several kinds.
function unavailableFromFetch(
  id: SourceId,
  kind: SourceKind,
  code: CaveatCode
): SourceResult<never> {
  // A business miss is a property of the request, not a provider failure.
  if (code === 'source.symbol-not-found') {
    return unavailable('unsupported', [id])
  }

  return unavailable('failed', [id], [{ code, detail: { source: id, sourceKind: kind } }])
}
