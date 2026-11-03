import { signal } from '@preact/signals'

import type { StatePayload } from '@/app/server/wire/system'
import type { BrowserKeys, DbOpenOutcome, WorkerCall, WorkerReply } from '@/app/server/wire/worker'
import { setApiTransport } from '@/web/api/client'
import { setFeedSocketFactory } from '@/web/api/socket'
import { createWorkerTransport } from '@/web/edition/transport'
import { createWorkerFeedSocket } from '@/web/edition/worker-socket'
import { preferredLocale, resolveBrowserLocale } from '@/web/state/session'
import { readStorage, writeStorage } from '@/web/state/storage'

/** A stable name: the build writes the worker next to the page under it. */
const WORKER_URL = '/worker.js'
/** The most a request may wait for the worker, a backstop over the page's own per-route timeouts. */
const REQUEST_TIMEOUT_MS = 180_000
const LOCALE_KEY = 'oa.edition.locale'

type Locale = StatePayload['locale']
type Refusal = Extract<WorkerReply, { readonly kind: 'refused' }>['reason']

/** Where the worker stands. `restarting` is a deliberate restart of the engine (a new language or
 *  model tier): the page waits for the next `ready`. */
export type EditionPhase =
  | { readonly kind: 'starting' }
  | { readonly kind: 'restarting' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'refused'; readonly reason: Refusal }

export const editionPhase = signal<EditionPhase>({ kind: 'starting' })

let worker: Worker | undefined
let stopWorker: (() => void) | undefined
let readKeys: () => BrowserKeys = () => ({})

function hasBrowserSupport(): boolean {
  return (
    typeof Worker === 'function' &&
    'locks' in navigator &&
    typeof navigator.storage?.getDirectory === 'function'
  )
}

/** Starts the worker, routes the page's `/v1` requests and feed through it, and ends it with the
 *  page: terminating a worker frees the tab lock, which is how the database is let go. `keys` is
 *  asked at every start, so a restart carries the keys held now. Returns the way to stop. */
export function startEdition(keys: () => BrowserKeys): () => void {
  preferredLocale.value = storedLocale() ?? resolveBrowserLocale()
  readKeys = keys

  if (!hasBrowserSupport()) {
    editionPhase.value = { kind: 'refused', reason: 'unsupported' }

    return () => undefined
  }

  const next = new Worker(WORKER_URL, { type: 'module' })
  const transport = createWorkerTransport(next, REQUEST_TIMEOUT_MS)
  const lifetime = new AbortController()

  worker = next
  setApiTransport(transport.send)
  setFeedSocketFactory((deps) => createWorkerFeedSocket(next, deps))
  next.addEventListener('message', onReply, { signal: lifetime.signal })
  next.addEventListener('error', () => refuse('unsupported'), { signal: lifetime.signal })
  start(false)

  stopWorker = () => {
    lifetime.abort()
    transport.dispose()
    next.terminate()
    worker = undefined
    stopWorker = undefined
  }

  return stopEdition
}

/** Ends the worker now; the page keeps showing what it has. Safe to call twice. */
export function stopEdition(): void {
  stopWorker?.()
}

/** Takes the database from the tab that holds it. */
export function takeOver(): void {
  editionPhase.value = { kind: 'starting' }
  start(true)
}

export function postToWorker(call: WorkerCall): void {
  worker?.postMessage(call)
}

/** The language the page runs in, the one the visitor last chose or the browser's. */
export function currentLocale(): Locale {
  return preferredLocale.value
}

/** Restarts the engine in the worker, which stops the work in flight and reads the config and keys
 *  again. The caller has asked the visitor first. */
export function restartEngine(locale: Locale = currentLocale()): void {
  editionPhase.value = { kind: 'restarting' }
  writeStorage('local', LOCALE_KEY, locale)
  preferredLocale.value = locale
  postToWorker({ kind: 'locale', locale })
}

/** The database as one SQLite file. Rejects when the worker has none to give or does not answer. */
export async function requestDbExport(): Promise<ArrayBuffer> {
  const reply = await askWorker({ kind: 'export-db', id: crypto.randomUUID() }, 'db-exported')

  return reply.bytes ?? Promise.reject(new Error('the database could not be read'))
}

/** Replaces the database with a file's bytes. On `opened` the office starts again over the new
 *  data; any other outcome left everything as it was. */
export async function requestDbOpen(bytes: ArrayBuffer): Promise<DbOpenOutcome> {
  const reply = await askWorker({ kind: 'open-db', id: crypto.randomUUID(), bytes }, 'db-opened')

  if (reply.outcome === 'opened') {
    // Two writes in a row: the office stops on the first and boots again on the second.
    editionPhase.value = { kind: 'restarting' }
    editionPhase.value = { kind: 'ready' }
  }

  return reply.outcome
}

// The listener and the timer of one call are released the moment it settles.
function askWorker<K extends 'db-exported' | 'db-opened'>(
  call: Extract<WorkerCall, { readonly id: string }>,
  kind: K
): Promise<Extract<WorkerReply, { readonly kind: K }>> {
  const target = worker

  if (target === undefined) {
    return Promise.reject(new Error('worker is not running'))
  }

  return new Promise((resolve, reject) => {
    const done = new AbortController()
    const settle = (finish: () => void): void => {
      clearTimeout(timer)
      done.abort()
      finish()
    }
    const timer = setTimeout(
      () => settle(() => reject(new Error('worker call timed out'))),
      REQUEST_TIMEOUT_MS
    )

    target.addEventListener(
      'message',
      (event: MessageEvent<WorkerReply>) => {
        const reply = event.data

        if (reply.kind === kind && reply.id === call.id) {
          settle(() => resolve(reply as Extract<WorkerReply, { readonly kind: K }>))
        }
      },
      { signal: done.signal }
    )
    target.addEventListener('error', () => settle(() => reject(new Error('worker failed'))), {
      signal: done.signal,
    })
    target.postMessage(call)
  })
}

function start(steal: boolean): void {
  postToWorker({ kind: 'start', locale: currentLocale(), keys: readKeys(), steal })
}

function onReply(event: MessageEvent<WorkerReply>): void {
  const message = event.data

  if (message.kind === 'ready') {
    editionPhase.value = { kind: 'ready' }
  } else if (message.kind === 'refused') {
    refuse(message.reason)
  }
}

function refuse(reason: Refusal): void {
  editionPhase.value = { kind: 'refused', reason }
}

function storedLocale(): Locale | undefined {
  const stored = readStorage('local', LOCALE_KEY)

  return stored === 'vi' || stored === 'en' ? stored : undefined
}
