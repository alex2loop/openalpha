import { constants, open, write } from 'node:fs'

import { ConfigError } from '@/core/errors'

import type { LogDestinationHooks, SegmentState } from './files'
import type { PendingLogQueue } from './queue'
import type { OwnedLogDestination } from './types'
import {
  assertOpenFd,
  assertParentIdentity,
  closeFd,
  closeFdAsync,
  pruneSegments,
  segmentPath,
} from './files'
import { createPendingLogQueue } from './queue'

const LOG_FILE_MODE = 0o600
// A failed write drops its record and reopens a fresh segment for the next one; past this many in a
// row the destination is treated as gone, so a dead disk neither spins nor litters empty segments.
const MAX_CONSECUTIVE_WRITE_FAILURES = 5
const RUNTIME_FAILURE_TEXT = 'Logging destination unavailable; further file logs were dropped.\n'
const WRITE_FAILURE_TEXT = 'Log write failed; the record was dropped and logging will retry.\n'
const ROTATION_FAILURE_TEXT =
  'Log rotation failed; the current segment keeps growing past its size cap.\n'

type WriteCallback = (err: NodeJS.ErrnoException | null, bytesWritten: number) => void
type OpenCallback = (err: NodeJS.ErrnoException | null, fd: number) => void

interface WriterOptions {
  readonly parent: string
  readonly base: string
  readonly parentRealpath: string
  readonly maxBytes: number
  readonly maxRetained: number
  readonly initial: SegmentState
  readonly hooks?: LogDestinationHooks
}

interface WriteChunkOptions {
  readonly fd: number
  readonly buffer: Buffer
  readonly offset: number
  readonly generation: number
}

interface WriterState {
  fd: number | null
  number: number
  size: number
}

export class AsyncLogWriter {
  readonly #options: WriterOptions
  readonly #queue: PendingLogQueue
  #state: WriterState
  #tail = Promise.resolve()
  #generation = 0
  #inFlightWrites = 0
  #accepting = true
  #failed = false
  #closed = false
  #closeWhenIdle = false
  #fallbackWritten = false
  #rotationWarned = false
  #writeFailureWarned = false
  #consecutiveWriteFailures = 0

  constructor(options: WriterOptions) {
    this.#options = options
    this.#queue = createPendingLogQueue(options.hooks)
    this.#state = { ...options.initial }
  }

  destination(): OwnedLogDestination {
    return {
      stream: { write: (msg) => this.enqueue(msg) },
      isAvailable: () => this.isCurrent(this.#generation) && this.#accepting,
      stopWrites: () => {
        this.#accepting = false
      },
      flush: () => this.flush(),
      close: () => this.close(),
      forceClose: () => this.forceClose(),
    }
  }

  enqueue(msg: string): void {
    if (!(this.#accepting && this.isCurrent(this.#generation))) {
      return
    }

    const bytes = Buffer.byteLength(msg)

    if (!this.#queue.reserve(bytes)) {
      return
    }

    let buffer: Buffer

    try {
      buffer = Buffer.from(msg)
    } catch {
      this.#queue.release(bytes)
      this.fail()
      return
    }

    this.#tail = this.#tail
      .then(() => this.writeRecord(buffer))
      .catch(() => this.recoverFromWriteFailure())
      .finally(() => this.#queue.release(bytes))
  }

  async rotate(): Promise<void> {
    const generation = this.#generation

    if (!this.isCurrent(generation)) {
      return
    }

    await assertParentIdentity(this.#options.parent, this.#options.parentRealpath)

    if (!this.isCurrent(generation)) {
      return
    }

    const nextNumber = this.#state.number + 1
    const path = segmentPath(this.#options.parent, this.#options.base, nextNumber)
    const nextFd = await this.openNew(path, generation)
    let installed = false

    try {
      await assertOpenFd(nextFd, generation, (value) => this.isCurrent(value))

      if (!this.isCurrent(generation)) {
        this.closeWriterFd(nextFd)
        return
      }

      const previousFd = this.#state.fd

      this.#state = { fd: nextFd, number: nextNumber, size: 0 }
      installed = true

      if (previousFd !== null) {
        await this.closeWriterFdAsync(previousFd)
      }

      if (this.isCurrent(generation)) {
        await this.prune()
      }
    } catch (err: unknown) {
      if (!installed) {
        this.closeWriterFd(nextFd)
      }

      throw err
    }
  }

  async prune(): Promise<void> {
    const generation = this.#generation

    if (!this.isCurrent(generation)) {
      return
    }

    await pruneSegments({
      parent: this.#options.parent,
      base: this.#options.base,
      current: this.#state.number,
      maxRetained: this.#options.maxRetained,
      parentRealpath: this.#options.parentRealpath,
      generation,
      isCurrent: (value) => this.isCurrent(value),
      ...(this.#options.hooks === undefined ? {} : { hooks: this.#options.hooks }),
    })
  }

  async flush(): Promise<void> {
    await this.#tail
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return
    }

    this.#accepting = false
    await this.#tail

    if (!this.#closed) {
      this.#closed = true
      this.#generation += 1
      const fd = this.takeOwnedFd()

      if (fd !== null) {
        await this.closeWriterFdAsync(fd)
      }
    }
  }

  forceClose(): void {
    if (this.#closed) {
      return
    }

    this.#accepting = false
    this.#closed = true
    this.#generation += 1

    if (this.#inFlightWrites > 0) {
      this.#closeWhenIdle = true
      return
    }

    this.closeOwnedFd()
  }

  private async writeRecord(buffer: Buffer): Promise<void> {
    const generation = this.#generation

    if (!this.isCurrent(generation)) {
      return
    }

    if (this.#state.fd === null) {
      await this.rotate()
    } else if (this.#state.size > 0 && this.#state.size + buffer.length > this.#options.maxBytes) {
      await this.rotateOrContinue()
    }

    if (!this.isCurrent(generation)) {
      return
    }

    const fd = this.#state.fd

    if (fd === null) {
      throw new ConfigError('log destination has no writable segment')
    }

    await this.writeBuffer(fd, buffer, generation)

    if (this.isCurrent(generation)) {
      this.#state.size += buffer.length
      this.#consecutiveWriteFailures = 0
    }
  }

  // The record is lost either way; the segment may hold a torn line, so the next record starts a
  // new one instead of appending after it.
  private recoverFromWriteFailure(): void {
    if (this.#closed || this.#failed) {
      return
    }

    this.#consecutiveWriteFailures += 1

    if (this.#consecutiveWriteFailures >= MAX_CONSECUTIVE_WRITE_FAILURES) {
      this.fail()
      return
    }

    this.closeOwnedFd()

    if (!this.#writeFailureWarned) {
      this.#writeFailureWarned = true
      emitStderr(WRITE_FAILURE_TEXT)
    }
  }

  // Rotation is size hygiene, not correctness: a failure keeps the record on the current segment
  // and lets the next one retry, rather than dropping every later log line for the process lifetime.
  private async rotateOrContinue(): Promise<void> {
    try {
      await this.rotate()
    } catch {
      if (!this.#rotationWarned) {
        this.#rotationWarned = true
        emitStderr(ROTATION_FAILURE_TEXT)
      }
    }
  }

  private async writeBuffer(fd: number, buffer: Buffer, generation: number): Promise<void> {
    let offset = 0

    while (offset < buffer.length) {
      if (!this.isCurrent(generation) || fd !== this.#state.fd) {
        return
      }

      const written = await this.writeChunk({ fd, buffer, offset, generation })

      if (written <= 0) {
        throw new ConfigError('log write made no progress')
      }

      offset += written
    }
  }

  private openNew(path: string, generation: number): Promise<number> {
    if (!this.isCurrent(generation)) {
      return Promise.reject(new ConfigError('log destination closed before segment open'))
    }

    const flags =
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_APPEND |
      constants.O_WRONLY |
      constants.O_NOFOLLOW

    return new Promise((resolve, reject) => {
      const done: OpenCallback = (err, fd) => {
        if (err !== null) {
          reject(err)
          return
        }

        if (!this.isCurrent(generation)) {
          this.closeWriterFd(fd)
          reject(new ConfigError('log destination closed during segment open'))
          return
        }

        resolve(fd)
      }

      if (this.#options.hooks?.open === undefined) {
        open(path, flags, LOG_FILE_MODE, done)
      } else {
        this.#options.hooks.open(path, flags, LOG_FILE_MODE, done)
      }
    })
  }

  private writeChunk(options: WriteChunkOptions): Promise<number> {
    if (!this.isCurrent(options.generation) || options.fd !== this.#state.fd) {
      return Promise.reject(new ConfigError('log destination closed before write'))
    }

    return new Promise((resolve, reject) => {
      let settled = false
      const done: WriteCallback = (err, bytesWritten) => {
        if (settled) {
          return
        }

        settled = true
        this.finishWrite()

        if (err !== null) {
          reject(err)
          return
        }

        if (!this.isCurrent(options.generation) || options.fd !== this.#state.fd) {
          reject(new ConfigError('log destination closed during write'))
          return
        }

        resolve(bytesWritten)
      }

      this.#inFlightWrites += 1

      try {
        if (this.#options.hooks?.write === undefined) {
          write(
            options.fd,
            options.buffer,
            options.offset,
            options.buffer.length - options.offset,
            null,
            done
          )
        } else {
          this.#options.hooks.write(options.fd, options.buffer, options.offset, done)
        }
      } catch (err: unknown) {
        if (settled) {
          return
        }

        settled = true
        this.finishWrite()
        reject(err)
      }
    })
  }

  private finishWrite(): void {
    this.#inFlightWrites -= 1

    if (this.#inFlightWrites === 0 && this.#closeWhenIdle) {
      this.#closeWhenIdle = false
      this.closeOwnedFd()
    }
  }

  private closeOwnedFd(): void {
    const fd = this.takeOwnedFd()

    if (fd !== null) {
      this.closeWriterFd(fd)
    }
  }

  private takeOwnedFd(): number | null {
    const fd = this.#state.fd
    this.#state.fd = null
    return fd
  }

  private closeWriterFd(fd: number): void {
    this.notifyFdClose(fd)
    closeFd(fd)
  }

  private async closeWriterFdAsync(fd: number): Promise<void> {
    this.notifyFdClose(fd)
    await closeFdAsync(fd)
  }

  private notifyFdClose(fd: number): void {
    try {
      this.#options.hooks?.onFdClose?.(fd)
    } catch {
      // Diagnostics must not affect descriptor release.
    }
  }

  private isCurrent(generation: number): boolean {
    return !(this.#closed || this.#failed) && generation === this.#generation
  }

  private fail(): void {
    this.#failed = true
    this.forceClose()

    if (!this.#fallbackWritten) {
      this.#fallbackWritten = true
      emitStderr(RUNTIME_FAILURE_TEXT)
    }
  }
}

// The last reporting boundary: it must never recurse into logging.
function emitStderr(text: string): void {
  try {
    process.stderr.write(text)
  } catch {
    // Nothing left to report to.
  }
}
