import type { WireEvent } from '@/app/server/wire/events'
import type { LiveRunWire, LiveSnapshotWire } from '@/app/server/wire/live'
import type { ServerFrame } from '@/app/server/wire/socket'
import { getJson } from '@/web/api/client'
import { startPoll } from '@/web/api/poll'
import { ROUTES } from '@/web/api/routes'
import { type ConnectionStatus, createFeedSocket, type FeedSocket } from '@/web/api/socket'
import { readToken } from '@/web/api/token'
import {
  appendStep,
  findRun,
  finishRun,
  isTombstoned,
  LIVE_RESYNC_MS,
  nextArrivalSeq,
  type Run,
  readArrivalSeq,
  runs,
  updateRun,
  upsertRun,
} from '@/web/state/live'
import { connection, loadSession } from '@/web/state/session'

const FEED_PATH = '/v1/ws'
// Past this many events held during one snapshot, the page drops them and takes another snapshot.
const MAX_BUFFERED_EVENTS = 500

interface Feed {
  readonly socket: FeedSocket
  readonly lifetime: AbortController
}

let feed: Feed | undefined
// While a snapshot is on its way, events wait here and replay in order once it is applied.
let buffered: WireEvent[] = []
let isSyncing = false
let isRerunWanted = false
// A run an event named that the page did not hold; the next snapshot either lists it or it ended.
let unknownRunId: string | undefined

/** Opens the socket and the snapshot poll. Every (re)connect takes a fresh snapshot and reloads the
 *  session, since language, zone and capabilities can change across a restart. */
export function startFeed(): () => void {
  const lifetime = new AbortController()
  const socket = createFeedSocket({
    url: buildFeedUrl,
    onFrame: routeFrame,
    onStatus: setConnection,
    onOpen: () => {
      resync(lifetime.signal)
      loadSession(lifetime.signal)
    },
  })
  const stopPoll = startPoll(resync, LIVE_RESYNC_MS)

  feed = { socket, lifetime }

  return () => {
    lifetime.abort()
    stopPoll()
    socket.close()

    if (feed?.socket === socket) {
      feed = undefined
    }
  }
}

export function retryFeedNow(): void {
  feed?.socket.retryNow()
}

function buildFeedUrl(): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const params = new URLSearchParams({ token: readToken() ?? '' })

  return `${scheme}//${location.host}${FEED_PATH}?${params}`
}

function setConnection(status: ConnectionStatus, retryAt?: number): void {
  connection.value = retryAt === undefined ? { status } : { status, retryAt }
}

// `chat` frames are dropped until the chat pane registers its sink.
function routeFrame(frame: ServerFrame): void {
  if (frame.type !== 'wire_event') {
    return
  }

  if (!isSyncing) {
    applyWireEvent(frame, false)
    return
  }

  buffered.push(frame)

  if (buffered.length > MAX_BUFFERED_EVENTS) {
    buffered = []
    isRerunWanted = true
  }
}

/** Single-flight: a call while one runs asks for one more run after it. */
async function resync(signal: AbortSignal): Promise<void> {
  if (isSyncing) {
    isRerunWanted = true
    return
  }

  isSyncing = true

  try {
    let isSynced = true

    do {
      isRerunWanted = false
      isSynced = await syncOnce(signal)
    } while (isSynced && isRerunWanted && !signal.aborted)
  } finally {
    isSyncing = false
  }
}

async function syncOnce(signal: AbortSignal): Promise<boolean> {
  const mark = readArrivalSeq()
  let snapshot: LiveSnapshotWire

  try {
    snapshot = await getJson(ROUTES.live, { signal })
  } catch {
    replayBuffered()

    // A live socket with no snapshot shows a stale view: reconnect, on the backoff.
    if (!signal.aborted && connection.value.status === 'live') {
      feed?.socket.retryNow()
    }

    return false
  }

  applySnapshot(snapshot, mark)
  replayBuffered()

  return true
}

function applySnapshot(snapshot: LiveSnapshotWire, mark: number): void {
  const listed = new Set(snapshot.runs.map((run) => run.runId))

  // A run the page held before asking and the snapshot no longer lists ended in the gap.
  for (const run of runs.value) {
    if (!listed.has(run.runId) && run.seenAt <= mark) {
      finishRun(run.runId)
    }
  }

  if (unknownRunId !== undefined && !listed.has(unknownRunId)) {
    finishRun(unknownRunId)
  }

  unknownRunId = undefined

  for (const wire of snapshot.runs) {
    if (!isTombstoned(wire.runId)) {
      upsertRun(toRun(wire))
    }
  }
}

function replayBuffered(): void {
  const events = buffered

  buffered = []

  for (const event of events) {
    applyWireEvent(event, true)
  }
}

function toRun(wire: LiveRunWire): Run {
  return {
    ...wire,
    seenAt: findRun(wire.runId)?.seenAt ?? nextArrivalSeq(),
    tickers: wire.tickers ?? [],
  }
}

/** Idempotent: the same event applied twice changes nothing. An unknown `kind` is ignored. */
function applyWireEvent(event: WireEvent, isReplay: boolean): void {
  if (event.runId === undefined) {
    return
  }

  switch (event.kind) {
    case 'run_started':
      applyStart(event.runId, event)
      return
    case 'run_progress':
    case 'run_thinking':
      applyUpdate(event.runId, event, isReplay)
      return
    case 'run_finished':
      finishRun(event.runId)
      return
    default:
      return
  }
}

function applyStart(runId: string, event: WireEvent): void {
  const start = event.run

  if (start === undefined || isTombstoned(runId)) {
    return
  }

  const held = findRun(runId)

  upsertRun({
    persistent: [],
    tickers: [],
    ...held,
    ...start,
    // The wire's `name` is the agent id for an agent run.
    ...(start.kind === 'agent' ? { agentId: start.name } : {}),
    runId,
    seenAt: held?.seenAt ?? nextArrivalSeq(),
  })
}

function applyUpdate(runId: string, event: WireEvent, isReplay: boolean): void {
  if (isTombstoned(runId)) {
    return
  }

  if (findRun(runId) !== undefined) {
    updateRun(runId, (run) => mergeUpdate(run, event))
    return
  }

  // The snapshot just applied was taken after this event's run began, so a run it lacks has ended.
  if (isReplay) {
    finishRun(runId)
    return
  }

  unknownRunId = runId
  resync(feed?.lifetime.signal ?? AbortSignal.abort())
}

function mergeUpdate(run: Run, event: WireEvent): Run {
  const { progress, thinking } = event

  if (thinking !== undefined) {
    return { ...run, thinking }
  }

  // An older line replayed after a newer snapshot never takes its place.
  if (progress === undefined || (run.progress !== undefined && progress.at < run.progress.at)) {
    return run
  }

  return {
    ...run,
    progress,
    persistent:
      progress.mode === 'persistent' ? appendStep(run.persistent, progress) : run.persistent,
  }
}
