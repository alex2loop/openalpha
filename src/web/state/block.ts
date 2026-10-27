import { type ReadonlySignal, signal } from '@preact/signals'
import { useEffect, useMemo } from 'preact/hooks'

import type { Capabilities } from '@/app/server/wire/system'
import type { RouteDef } from '@/web/api/routes'
import { ApiFailure, getJson } from '@/web/api/client'
import { startPoll } from '@/web/api/poll'
import { createSingleFlight } from '@/web/api/single-flight'
import { state } from '@/web/state/session'
import { mergeCautions } from '@/web/text/caution-text'

type BlockQuery = Readonly<Record<string, string | number>>

/** `stale` only when the response itself says so: it carries a warning caveat. */
type BlockStatus = 'loading' | 'ready' | 'stale' | 'failed' | 'absent'

interface WireCaveat {
  readonly severity: string
  readonly text: string
}

/** What a block shows: the last good `data` and its `readAt` survive a failed refresh. `cautions`
 *  are the daemon's own warning sentences, as it worded them. */
interface BlockView<T> {
  readonly state: BlockStatus
  readonly data?: T
  readonly readAt?: number
  readonly error?: ApiFailure
  readonly cautions: readonly string[]
}

export interface BlockReading<T> extends BlockView<T> {
  retry(): void
}

interface BlockOptions {
  /** A route the daemon does not run makes the block `absent`, never `failed`. */
  readonly capability?: keyof Capabilities | undefined
}

interface ReadOptions extends BlockOptions {
  /** Polled at this period while mounted; absent reads once. */
  readonly everyMs?: number | undefined
}

interface RouteOptions {
  readonly query?: BlockQuery
  readonly everyMs?: number
}

interface Block<T> {
  readonly view: ReadonlySignal<BlockView<T>>
  /** Reads now and, with `everyMs`, again at that period. The returned stop is idempotent. */
  start(everyMs?: number): () => void
  /** Reads again now; nothing before `start`. */
  retry(): void
}

/** The page's one owner of a block's load: it keeps the last good read, folds a failure into the
 *  view and never lets two reads of one block overlap. */
function createBlock<T>(
  read: (abort: AbortSignal) => Promise<T>,
  options: BlockOptions = {}
): Block<T> {
  const view = signal<BlockView<T>>({ state: 'loading', cautions: [] })
  let refresh: (() => Promise<void>) | undefined

  async function load(abort: AbortSignal): Promise<void> {
    if (isAbsent(options.capability)) {
      view.value = { state: 'absent', cautions: [] }
      return
    }

    try {
      view.value = toReadView(await read(abort))
    } catch (error: unknown) {
      // Anything but an `ApiFailure` is this block's own abort.
      if (error instanceof ApiFailure) {
        view.value = { ...view.value, state: 'failed', error }
      }
    }
  }

  function start(everyMs?: number): () => void {
    const lifetime = new AbortController()
    const flight = createSingleFlight(load, lifetime.signal)
    const stopPoll = everyMs === undefined ? undefined : startPoll(() => flight(), everyMs)

    refresh = flight

    if (stopPoll === undefined) {
      // `load` records its own failure, so the flight never rejects.
      flight().catch(() => undefined)
    }

    return () => {
      lifetime.abort()
      stopPoll?.()

      if (refresh === flight) {
        refresh = undefined
      }
    }
  }

  function retry(): void {
    // `load` records its own failure, so the flight never rejects.
    refresh?.().catch(() => undefined)
  }

  return { view, start, retry }
}

/** A block over one route: its query is fixed for the block's life. */
export function createRouteBlock<T>(def: RouteDef<T>, query?: BlockQuery): Block<T> {
  return createBlock(readRoute(def, query), { capability: def.capability })
}

/** A block read for as long as the component is mounted; the read and its options are taken once. */
export function useBlockRead<T>(
  read: (abort: AbortSignal) => Promise<T>,
  options: ReadOptions = {}
): BlockReading<T> {
  // One block per mount, by design: the read and its options never change for a mounted block.
  const block = useMemo(() => createBlock(read, options), [])

  useEffect(() => block.start(options.everyMs), [])

  return { ...block.view.value, retry: block.retry }
}

export function useBlock<T>(def: RouteDef<T>, options: RouteOptions = {}): BlockReading<T> {
  const { query, everyMs } = options

  return useBlockRead(readRoute(def, query), { capability: def.capability, everyMs })
}

/** The reading with the warnings of the parts of a response one frame shows, when the response
 *  itself carries them per part. */
export function withCautions<T>(
  reading: BlockReading<T>,
  parts: readonly { readonly caveats: readonly WireCaveat[] }[]
): BlockReading<T> {
  const cautions = toCautions(parts.flatMap((part) => part.caveats))

  return {
    ...reading,
    cautions,
    state: reading.state === 'ready' && cautions.length > 0 ? 'stale' : reading.state,
  }
}

/** A module-level block's current view with its retry, as a component reads it. */
export function readBlock<T>(block: Block<T>): BlockReading<T> {
  return { ...block.view.value, retry: block.retry }
}

function isAbsent(capability: keyof Capabilities | undefined): boolean {
  return capability !== undefined && state.value?.capabilities[capability] === false
}

function toReadView<T>(data: T): BlockView<T> {
  const cautions = toCautions(readCaveats(data))

  return { state: cautions.length > 0 ? 'stale' : 'ready', data, readAt: Date.now(), cautions }
}

function readRoute<T>(
  def: RouteDef<T>,
  query: BlockQuery | undefined
): (abort: AbortSignal) => Promise<T> {
  return (abort) => getJson(def, { ...(query === undefined ? {} : { query }), signal: abort })
}

function readCaveats(data: unknown): readonly WireCaveat[] {
  if (typeof data !== 'object' || data === null || !('caveats' in data)) {
    return []
  }

  return Array.isArray(data.caveats) ? data.caveats.filter(isWireCaveat) : []
}

function isWireCaveat(value: unknown): value is WireCaveat {
  return (
    typeof value === 'object' &&
    value !== null &&
    'severity' in value &&
    'text' in value &&
    typeof value.severity === 'string' &&
    typeof value.text === 'string'
  )
}

// A by-design note (`info`) is not a warning; the same sentence from two sources shows once.
function toCautions(caveats: readonly WireCaveat[]): readonly string[] {
  return mergeCautions(caveats.filter((caveat) => caveat.severity === 'warn').map((c) => c.text))
}
