import type { FileHandle } from 'node:fs/promises'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'

import { ConfigError } from '@/core/errors'

import type { LogSegment } from './segments'
import { listLogSegments } from './segments'

const READ_CHUNK_BYTES = 64 * 1024
const MAX_LOG_LINE_BYTES = 64 * 1024
const CURSOR_ANCHOR_BYTES = 64
const TAIL_COMPACT_THRESHOLD = 1024
// Read far enough back from the end of each segment that the requested tail is likely to be
// covered, without scanning every segment from byte zero.
const TAIL_READ_AHEAD_BYTES = 16 * 1024 * 1024
const MAX_TAIL_BYTES = 16 * 1024 * 1024
export const MAX_TAIL_LINES = 10_000

interface SegmentReadResult {
  readonly offset: number
  readonly pending: Buffer
  readonly anchor: Buffer
  readonly continuous: boolean
}

interface ReadSegmentOptions {
  readonly segment: LogSegment
  readonly offset: number
  readonly initialPending: Buffer
  readonly initialAnchor: Buffer
  readonly onLine: (line: string) => void
  readonly signal?: AbortSignal
}

interface TailAccumulator {
  readonly rows: string[]
  readonly maxLines: number
  bytes: number
  start: number
}

interface TailOptions {
  readonly file: string
  readonly lines: number
  readonly since?: number
  readonly output: (line: string) => void
  readonly signal?: AbortSignal
}

export interface TailCursor {
  readonly number: number
  readonly dev: number
  readonly ino: number
  readonly offset: number
  readonly pending: Buffer
  readonly anchor: Buffer
}

export async function printLogTail(options: TailOptions): Promise<TailCursor | undefined> {
  if (options.signal?.aborted) {
    return undefined
  }

  const segments = await listLogSegments(options.file, options.signal)
  const accumulator: TailAccumulator = { rows: [], maxLines: options.lines, bytes: 0, start: 0 }
  let cursor: TailCursor | undefined

  for (const segment of segments) {
    if (options.signal?.aborted) {
      return undefined
    }

    const result = await readLogSegment({
      segment,
      offset: Math.max(0, segment.size - TAIL_READ_AHEAD_BYTES),
      initialPending: Buffer.alloc(0),
      initialAnchor: Buffer.alloc(0),
      onLine: (line) => {
        if (isLogLineAtOrAfter(line, options.since)) {
          retainTail(accumulator, line)
        }
      },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    const isLatest = segment === segments.at(-1)

    if (!isLatest && result.pending.length > 0) {
      throw new ConfigError('completed log segment ends with a partial record')
    }
    if (isLatest) {
      cursor = {
        ...segment,
        offset: result.offset,
        pending: result.pending,
        anchor: result.anchor,
      }
    }
  }

  for (const row of accumulator.rows.slice(accumulator.start)) {
    if (options.signal?.aborted) {
      return undefined
    }

    options.output(row)
  }

  return cursor
}

export function isLogLineAtOrAfter(line: string, since: number | undefined): boolean {
  if (since === undefined) {
    return true
  }

  try {
    const parsed: unknown = JSON.parse(line)

    if (typeof parsed !== 'object' || parsed === null || !('time' in parsed)) {
      return false
    }

    return typeof parsed.time === 'number' && Number.isFinite(parsed.time) && parsed.time >= since
  } catch {
    return false
  }
}

export async function readLogSegment(options: ReadSegmentOptions): Promise<SegmentReadResult> {
  if (options.signal?.aborted) {
    return {
      offset: options.offset,
      pending: options.initialPending,
      anchor: options.initialAnchor,
      continuous: true,
    }
  }

  let handle: FileHandle | undefined

  try {
    handle = await open(options.segment.path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const info = await handle.stat()

    if (options.signal?.aborted) {
      return {
        offset: options.offset,
        pending: options.initialPending,
        anchor: options.initialAnchor,
        continuous: true,
      }
    }

    if (
      !info.isFile() ||
      info.dev !== options.segment.dev ||
      info.ino !== options.segment.ino ||
      options.offset > options.segment.size ||
      info.size < options.segment.size
    ) {
      throw new ConfigError('log segment changed before reading')
    }

    const continuous = await hasExpectedAnchor(handle, options.offset, options.initialAnchor)

    if (options.signal?.aborted) {
      return {
        offset: options.offset,
        pending: options.initialPending,
        anchor: options.initialAnchor,
        continuous: true,
      }
    }
    if (!continuous) {
      return {
        offset: options.offset,
        pending: options.initialPending,
        anchor: options.initialAnchor,
        continuous: false,
      }
    }

    return await readChunks(handle, {
      offset: options.offset,
      end: options.segment.size,
      initialPending: options.initialPending,
      initialAnchor: options.initialAnchor,
      onLine: options.onLine,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

function retainTail(accumulator: TailAccumulator, line: string): void {
  const bytes = Buffer.byteLength(line)

  if (bytes > MAX_LOG_LINE_BYTES) {
    throw new ConfigError('log line exceeds the viewing limit')
  }

  accumulator.rows.push(line)
  accumulator.bytes += bytes

  while (accumulator.rows.length - accumulator.start > accumulator.maxLines) {
    accumulator.bytes -= Buffer.byteLength(accumulator.rows[accumulator.start] ?? '')
    accumulator.start += 1
  }

  if (accumulator.start >= TAIL_COMPACT_THRESHOLD) {
    accumulator.rows.splice(0, accumulator.start)
    accumulator.start = 0
  }

  if (accumulator.bytes > MAX_TAIL_BYTES) {
    throw new ConfigError('requested log tail exceeds the viewing limit')
  }
}

async function readChunks(
  handle: FileHandle,
  options: {
    readonly offset: number
    readonly end: number
    readonly initialPending: Buffer
    readonly initialAnchor: Buffer
    readonly onLine: (line: string) => void
    readonly signal?: AbortSignal
  }
): Promise<SegmentReadResult> {
  let position = options.offset
  let pending = options.initialPending
  let anchor = options.initialAnchor

  while (position < options.end) {
    if (options.signal?.aborted) {
      break
    }

    const length = Math.min(READ_CHUNK_BYTES, options.end - position)
    const buffer = Buffer.allocUnsafe(length)
    const { bytesRead } = await handle.read(buffer, 0, length, position)

    if (options.signal?.aborted) {
      break
    }
    if (bytesRead === 0) {
      throw new ConfigError('log segment truncated during reading')
    }

    position += bytesRead
    const chunk = buffer.subarray(0, bytesRead)

    pending = consumeLines(Buffer.concat([pending, chunk]), options.onLine)
    anchor = Buffer.concat([anchor, chunk]).subarray(-CURSOR_ANCHOR_BYTES)

    if (pending.length > MAX_LOG_LINE_BYTES) {
      throw new ConfigError('log line exceeds the viewing limit')
    }
  }

  return { offset: position, pending, anchor, continuous: true }
}

async function hasExpectedAnchor(
  handle: FileHandle,
  offset: number,
  expected: Buffer
): Promise<boolean> {
  if (offset === 0 || expected.length === 0) {
    return true
  }

  const actual = Buffer.allocUnsafe(expected.length)
  const { bytesRead } = await handle.read(actual, 0, actual.length, offset - actual.length)

  return bytesRead === expected.length && actual.equals(expected)
}

function consumeLines(buffer: Buffer, onLine: (line: string) => void): Buffer {
  let start = 0
  let newline = buffer.indexOf(0x0a, start)

  while (newline >= 0) {
    const end = newline > start && buffer[newline - 1] === 0x0d ? newline - 1 : newline

    if (end - start > MAX_LOG_LINE_BYTES) {
      throw new ConfigError('log line exceeds the viewing limit')
    }

    onLine(buffer.toString('utf8', start, end))
    start = newline + 1
    newline = buffer.indexOf(0x0a, start)
  }

  return buffer.subarray(start)
}
