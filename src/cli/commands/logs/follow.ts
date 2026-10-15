import type { FSWatcher } from 'node:fs'
import { watch } from 'node:fs'
import { dirname } from 'node:path'

import type { CliApp } from '@/cli/types'
import { ConfigError } from '@/core/errors'

import type { TailCursor } from './reader'
import type { LogSegment } from './segments'
import { isLogLineAtOrAfter, readLogSegment } from './reader'
import { listLogSegments } from './segments'

const FOLLOW_POLL_INTERVAL_MS = 250

type FollowState = TailCursor | undefined

interface FollowOptions {
  readonly file: string
  readonly initial?: TailCursor
  readonly since?: number
}

export async function followLog(app: CliApp, options: FollowOptions): Promise<void> {
  await new LogFollower(app, options).run()
}

class LogFollower {
  readonly #app: CliApp
  readonly #options: FollowOptions
  readonly #stop: Promise<void>
  readonly #scanController = new AbortController()
  #state: FollowState
  #watcher: FSWatcher | undefined
  #poll: NodeJS.Timeout | undefined
  #active: Promise<void> | undefined
  #resolveStop: (() => void) | undefined
  #rejectStop: ((reason: unknown) => void) | undefined
  #dirty = false
  #stopped = false

  constructor(app: CliApp, options: FollowOptions) {
    this.#app = app
    this.#options = options
    this.#state = options.initial
    this.#stop = new Promise((resolve, reject) => {
      this.#resolveStop = resolve
      this.#rejectStop = reject
    })
  }

  async run(): Promise<void> {
    if (this.#app.signal.aborted) {
      return
    }

    try {
      this.#app.signal.addEventListener('abort', this.#abort, { once: true })

      if (this.#app.signal.aborted) {
        this.#abort()
      } else {
        this.#start()
      }

      await this.#stop
    } finally {
      await this.#close()
    }
  }

  #start(): void {
    this.#watcher = watch(dirname(this.#options.file), this.#queueScan)
    this.#watcher.on('error', this.#fail)
    this.#poll = setInterval(this.#queueScan, FOLLOW_POLL_INTERVAL_MS)
    this.#queueScan()
  }

  #queueScan = (): void => {
    if (this.#stopped) {
      return
    }

    this.#dirty = true

    if (this.#active === undefined) {
      this.#active = this.#drainQueued().then(this.#scanComplete, this.#scanFailed)
    }
  }

  #drainQueued = async (): Promise<void> => {
    while (this.#dirty && !this.#stopped) {
      this.#dirty = false
      this.#state = await drainChanges(this.#app, {
        file: this.#options.file,
        state: this.#state,
        signal: this.#scanController.signal,
        ...(this.#options.since === undefined ? {} : { since: this.#options.since }),
      })
    }
  }

  #scanComplete = (): void => {
    this.#active = undefined

    if (this.#dirty) {
      this.#queueScan()
    }
  }

  #scanFailed = (err: unknown): void => {
    this.#active = undefined
    this.#fail(err)
  }

  #fail = (err: unknown): void => {
    if (!this.#stopped) {
      this.#stopResources()
      this.#rejectStop?.(err)
    }
  }

  #abort = (): void => {
    this.#stopResources()
    this.#resolveStop?.()
  }

  async #close(): Promise<void> {
    this.#stopResources()
    this.#resolveStop?.()
    this.#app.signal.removeEventListener('abort', this.#abort)
    await this.#active
  }

  #stopResources(): void {
    this.#stopped = true
    this.#scanController.abort()

    if (this.#watcher !== undefined) {
      this.#watcher.off('error', this.#fail)
      try {
        this.#watcher.close()
      } catch {
        // Cleanup is idempotent and must not mask the boundary that stopped the follower.
      }
      this.#watcher = undefined
    }

    clearInterval(this.#poll)
    this.#poll = undefined
  }
}

async function drainChanges(
  app: CliApp,
  options: {
    readonly file: string
    readonly state: FollowState
    readonly signal: AbortSignal
    readonly since?: number
  }
): Promise<FollowState> {
  if (options.signal.aborted) {
    return options.state
  }

  const segments = await listLogSegments(options.file, options.signal)
  const current = findCurrent(segments, options.state)
  const effectiveState = isRestartedSequence(segments, current, options.state)
    ? undefined
    : options.state
  const newer = newerSegments(segments, effectiveState)
  let next = current === undefined ? discardVanishedPartial(effectiveState) : effectiveState
  const output = (line: string): void => {
    if (isLogLineAtOrAfter(line, options.since)) {
      app.out(line)
    }
  }

  if (current !== undefined && effectiveState !== undefined) {
    next = await drainCurrent(output, {
      segment: current,
      state: effectiveState,
      signal: options.signal,
    })
  }

  for (const [index, segment] of newer.entries()) {
    if (options.signal.aborted) {
      return next
    }
    if (next?.pending.length) {
      throw new ConfigError('completed log segment ends with a partial record')
    }

    next = await drainNew(output, {
      segment,
      kind: index === newer.length - 1 ? 'latest' : 'completed',
      signal: options.signal,
    })
  }

  return next
}

function discardVanishedPartial(state: FollowState): FollowState {
  return state === undefined ? undefined : { ...state, pending: Buffer.alloc(0) }
}

function isRestartedSequence(
  segments: readonly LogSegment[],
  current: LogSegment | undefined,
  state: FollowState
): boolean {
  return (
    state !== undefined &&
    current === undefined &&
    segments.length > 0 &&
    !segments.some((segment) => segment.number > state.number)
  )
}

function findCurrent(segments: readonly LogSegment[], state: FollowState): LogSegment | undefined {
  return state === undefined
    ? undefined
    : segments.find((segment) => segment.number === state.number)
}

function newerSegments(segments: readonly LogSegment[], state: FollowState): readonly LogSegment[] {
  return state === undefined
    ? segments
    : segments.filter((segment) => segment.number > state.number)
}

async function drainCurrent(
  output: (line: string) => void,
  options: {
    readonly segment: LogSegment
    readonly state: TailCursor
    readonly signal: AbortSignal
  }
): Promise<TailCursor> {
  const sameIdentity =
    options.segment.dev === options.state.dev && options.segment.ino === options.state.ino
  const start =
    sameIdentity && options.segment.size >= options.state.offset ? options.state.offset : 0
  const pending = start === options.state.offset ? options.state.pending : Buffer.alloc(0)
  const result = await readLogSegment({
    segment: options.segment,
    offset: start,
    initialPending: pending,
    initialAnchor: start === options.state.offset ? options.state.anchor : Buffer.alloc(0),
    onLine: output,
    signal: options.signal,
  })

  if (!result.continuous) {
    return await drainNew(output, {
      segment: options.segment,
      kind: 'latest',
      signal: options.signal,
    })
  }

  return {
    ...options.segment,
    offset: result.offset,
    pending: result.pending,
    anchor: result.anchor,
  }
}

async function drainNew(
  output: (line: string) => void,
  options: {
    readonly segment: LogSegment
    readonly kind: 'completed' | 'latest'
    readonly signal: AbortSignal
  }
): Promise<TailCursor> {
  const result = await readLogSegment({
    segment: options.segment,
    offset: 0,
    initialPending: Buffer.alloc(0),
    initialAnchor: Buffer.alloc(0),
    onLine: output,
    signal: options.signal,
  })

  if (!(options.kind === 'latest' || options.signal.aborted) && result.pending.length > 0) {
    throw new ConfigError('completed log segment ends with a partial record')
  }

  return {
    ...options.segment,
    offset: result.offset,
    pending: options.kind === 'latest' ? result.pending : Buffer.alloc(0),
    anchor: result.anchor,
  }
}
