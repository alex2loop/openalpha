import type { WireEvent } from '@/app/server/wire/events'
import type { LiveRunWire, LiveSnapshotWire } from '@/app/server/wire/live'
import type { ClientFrame, ServerFrame } from '@/app/server/wire/socket'
import { getJson } from '@/web/api/client'
import { startPoll } from '@/web/api/poll'
import { ROUTES } from '@/web/api/routes'
import { type ConnectionStatus, createFeedSocket, type FeedSocket } from '@/web/api/socket'
import { publishWireEvent } from '@/web/state/events'
import {
  appendStep,
  applyPendingEvent,
  findRun,
  LIVE_RESYNC_MS,
  nextArrivalSeq,
  noteAlertsChecked,
  noteFinishedTickers,
  type Run,
  readArrivalSeq,
  removeRun,
  replacePending,
  runs,
  updateRun,
  upsertRun,
} from '@/web/state/live'
import { connection, loadSession } from '@/web/state/session'

const FEED_PATH = '/v1/ws'
// Past this many events held during one snapshot, the page drops the rest of the pass and takes
// another snapshot instead.
const MAX_BUFFERED_EVENTS = 500
const MAX_TOMBSTONES = 400

/** One feed's life, from `startFeed` to its `stop`; nothing here outlives a sign-out. */
interface FeedState {
  readonly lifetime: AbortController
  socket: FeedSocket | undefined
  // While a snapshot is on its way, events wait here and replay in order once it is applied.
  buffered: WireEvent[]
  isSyncing: boolean
  isRerunWanted: boolean
  // Set on overflow: the rest of the pass is dropped, as the rerun snapshot covers it.
  isDropping: boolean
  // A run an event named that the page did not hold; the next snapshot either lists it or it ended.
  unknownRunId: string | undefined
  // Finished runs, oldest first, so a late or replayed event never brings one back.
  readonly tombstones: Set<string>
}

/** A run event, once its `runId` is known to be there. */
type RunEvent = WireEvent & { readonly runId: string }

export type ChatServerFrame = Extract<ServerFrame, { readonly type: 'chat' }>

// The running feed, for the offline bar's retry and the chat's sends.
let activeFeed: FeedState | undefined
// Every reader of chat frames; none registered drops them.
const chatSinks = new Set<(frame: ChatServerFrame) => void>()

/** Opens the socket and the snapshot poll. Every (re)connect takes a fresh snapshot and reloads the
 *  session, since language, zone and capabilities can change across a restart. */
export function startFeed(): () => void {
  const feed: FeedState = {
    lifetime: new AbortController(),
    socket: undefined,
    buffered: [],
    isSyncing: false,
    isRerunWanted: false,
    isDropping: false,
    unknownRunId: undefined,
    tombstones: new Set(),
  }
  const { signal } = feed.lifetime

  feed.socket = createFeedSocket({
    url: buildFeedUrl,
    onFrame: (frame) => routeFrame(feed, frame),
    onStatus: setConnection,
    // `resync` turns a failed snapshot into `false` and `loadSession` keeps a failed load in
    // `sessionFailure`, so neither rejects.
    onOpen: () => {
      resync(feed, signal).catch(() => undefined)
      loadSession(signal).catch(() => undefined)
    },
  })

  const stopPoll = startPoll((pollSignal) => resync(feed, pollSignal), LIVE_RESYNC_MS)

  activeFeed = feed

  return () => {
    feed.lifetime.abort()
    stopPoll()
    feed.socket?.close()

    if (activeFeed === feed) {
      activeFeed = undefined
    }
  }
}

export function retryFeedNow(): void {
  activeFeed?.socket?.retryNow()
}

/** False unless the socket is live and took the frame. */
export function sendFrame(frame: ClientFrame): boolean {
  return activeFeed?.socket?.send(frame) ?? false
}

/** Hands every chat frame to `sink` until the returned function is called. */
export function onChatFrame(sink: (frame: ChatServerFrame) => void): () => void {
  chatSinks.add(sink)

  return () => {
    chatSinks.delete(sink)
  }
}

function buildFeedUrl(): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'

  return `${scheme}//${location.host}${FEED_PATH}`
}

function setConnection(status: ConnectionStatus, retryAt?: number): void {
  connection.value = retryAt === undefined ? { status } : { status, retryAt }
}

function routeFrame(feed: FeedState, frame: ServerFrame): void {
  if (frame.type === 'chat') {
    for (const sink of chatSinks) {
      sink(frame)
    }

    return
  }

  if (frame.type !== 'wire_event') {
    return
  }

  if (!feed.isSyncing) {
    applyWireEvent(feed, frame, false)
    return
  }

  if (feed.isDropping) {
    return
  }

  feed.buffered.push(frame)

  if (feed.buffered.length > MAX_BUFFERED_EVENTS) {
    feed.buffered = []
    feed.isDropping = true
    feed.isRerunWanted = true
  }
}

/** Single-flight: a call while one runs asks for one more run after it. */
async function resync(feed: FeedState, signal: AbortSignal): Promise<void> {
  if (feed.isSyncing) {
    feed.isRerunWanted = true
    return
  }

  feed.isSyncing = true

  try {
    let isSynced = true

    do {
      feed.isRerunWanted = false
      isSynced = await syncOnce(feed, signal)
    } while (isSynced && feed.isRerunWanted && !signal.aborted)
  } finally {
    feed.isSyncing = false
    feed.isDropping = false
  }
}

async function syncOnce(feed: FeedState, signal: AbortSignal): Promise<boolean> {
  const mark = readArrivalSeq()
  const snapshot = await getJson(ROUTES.live, { signal }).catch(() => undefined)

  // A failed request and an answer of the wrong shape take the same path.
  if (!isSnapshot(snapshot)) {
    replayBuffered(feed, false)

    // A live socket with no snapshot shows a stale view: reconnect, on the backoff.
    if (!signal.aborted && connection.value.status === 'live') {
      feed.socket?.retryNow()
    }

    return false
  }

  applySnapshot(feed, snapshot, mark)
  replayBuffered(feed, true)

  return true
}

function isSnapshot(value: unknown): value is LiveSnapshotWire {
  return (
    typeof value === 'object' &&
    value !== null &&
    'runs' in value &&
    Array.isArray(value.runs) &&
    'pending' in value &&
    Array.isArray(value.pending)
  )
}

function applySnapshot(feed: FeedState, snapshot: LiveSnapshotWire, mark: number): void {
  const listed = new Set(snapshot.runs.map((run) => run.runId))

  // A run the page held before asking and the snapshot no longer lists ended in the gap.
  for (const run of runs.value) {
    if (!listed.has(run.runId) && run.seenAt <= mark) {
      finishRun(feed, run.runId)
    }
  }

  if (feed.unknownRunId !== undefined && !listed.has(feed.unknownRunId)) {
    finishRun(feed, feed.unknownRunId)
  }

  feed.unknownRunId = undefined

  for (const wire of snapshot.runs) {
    if (!feed.tombstones.has(wire.runId)) {
      upsertRun(toRun(wire))
    }
  }

  replacePending(snapshot.pending, resolvedWhileSyncing(feed))
  noteAlertsChecked(snapshot.alertsCheckedAt)
}

// The snapshot may predate an answer an event held back for replay already carries.
function resolvedWhileSyncing(feed: FeedState): ReadonlySet<string> {
  const resolved = new Set<string>()

  for (const event of feed.buffered) {
    if (event.kind === 'approval_resolved' && event.requestId !== undefined) {
      resolved.add(event.requestId)
    }
  }

  return resolved
}

// Ends buffering for this pass. Only a pass whose snapshot was applied may judge an unknown run.
function replayBuffered(feed: FeedState, isSnapshotApplied: boolean): void {
  const events = feed.buffered

  feed.buffered = []
  feed.isDropping = false

  for (const event of events) {
    applyWireEvent(feed, event, isSnapshotApplied)
  }
}

// The snapshot is the daemon's view, except a thinking line it does not carry: the page keeps its own.
function toRun(wire: LiveRunWire): Run {
  const held = findRun(wire.runId)
  const thinking = wire.thinking ?? held?.thinking

  return {
    ...wire,
    ...(thinking === undefined ? {} : { thinking }),
    seenAt: held?.seenAt ?? nextArrivalSeq(),
    heardAt: isSameLine(held, wire) ? held.heardAt : Date.now(),
    tickers: wire.tickers ?? [],
  }
}

/** Idempotent: the same event applied twice changes nothing. An unknown `kind` is ignored.
 *  `isAfterSnapshot` marks a replay right after a snapshot was applied. The hub hears each event
 *  once the store holds it. */
function applyWireEvent(feed: FeedState, event: WireEvent, isAfterSnapshot: boolean): void {
  applyPendingEvent(event)

  if (event.kind === 'alerts_checked') {
    noteAlertsChecked(event.checkedAt)
  }

  if (hasRunId(event)) {
    applyRunEvent(feed, event, isAfterSnapshot)
  }

  publishWireEvent(event)
}

function applyRunEvent(feed: FeedState, event: RunEvent, isAfterSnapshot: boolean): void {
  switch (event.kind) {
    case 'run_started':
      applyStart(feed, event)
      return
    case 'run_progress':
    case 'run_thinking':
      applyUpdate(feed, event, isAfterSnapshot)
      return
    case 'run_finished':
      noteFinishedTickers(event.runId, event.tickers)
      finishRun(feed, event.runId)
      return
    default:
      return
  }
}

// A snapshot repeating the line the page holds keeps the time it first arrived.
function isSameLine(held: Run | undefined, wire: LiveRunWire): held is Run {
  return held !== undefined && held.progress?.at === wire.progress?.at
}

function applyStart(feed: FeedState, event: RunEvent): void {
  const { runId, run: start } = event

  if (start === undefined || feed.tombstones.has(runId)) {
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
    heardAt: Date.now(),
  })
}

function applyUpdate(feed: FeedState, event: RunEvent, isAfterSnapshot: boolean): void {
  const { runId } = event

  if (feed.tombstones.has(runId)) {
    return
  }

  if (findRun(runId) !== undefined) {
    updateRun(runId, (run) => mergeUpdate(run, event))
    return
  }

  // The snapshot just applied was taken after this event's run began, so a run it lacks has ended.
  if (isAfterSnapshot) {
    finishRun(feed, runId)
    return
  }

  // A replay after a failed snapshot leaves it to the next one.
  if (feed.isSyncing) {
    return
  }

  feed.unknownRunId = runId
  // `resync` turns a failed snapshot into `false` and clears its flags in `finally`.
  resync(feed, feed.lifetime.signal).catch(() => undefined)
}

function hasRunId(event: WireEvent): event is RunEvent {
  return event.runId !== undefined
}

function mergeUpdate(run: Run, event: WireEvent): Run {
  const { progress, thinking } = event

  if (thinking !== undefined) {
    return { ...run, thinking, heardAt: Date.now() }
  }

  // An older line replayed after a newer snapshot never takes its place.
  if (progress === undefined || (run.progress !== undefined && progress.at < run.progress.at)) {
    return run
  }

  return {
    ...run,
    progress,
    heardAt: Date.now(),
    persistent:
      progress.mode === 'persistent' ? appendStep(run.persistent, progress) : run.persistent,
  }
}

/** Removes the run and tombstones it; a second call is a no-op. */
function finishRun(feed: FeedState, runId: string): void {
  const { tombstones } = feed

  tombstones.delete(runId)
  tombstones.add(runId)

  for (const oldest of tombstones) {
    if (tombstones.size <= MAX_TOMBSTONES) {
      break
    }

    tombstones.delete(oldest)
  }

  removeRun(runId)
}
