import type { Readable } from 'node:stream'
import { type ChildProcess, spawn } from 'node:child_process'

import type { ToolInvocationContext } from '@/core/tool'
import { abortError, isErrno, ToolError } from '@/core/errors'

const SHELL_OUTPUT_CAP_BYTES = 1_048_576
const SHELL_KILL_GRACE_MS = 2_000
const SPAWN_INPUT_ERROR_CODES = ['ENOENT', 'EACCES', 'ENOTDIR']

interface ShellProcessInput {
  readonly command: string
  readonly args: readonly string[]
  readonly timeoutMs: number
}

interface ShellProcessResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | null
  readonly truncated: boolean
  readonly timedOut: boolean
}

interface StreamResult {
  readonly text: string
  readonly truncated: boolean
  readonly error?: Error
}

interface StreamCapture {
  readonly done: Promise<StreamResult>
  stop(): void
}

interface StreamBuffer {
  readonly chunks: Buffer[]
  size: number
}

type StopReason = 'abort' | 'error' | 'output_cap' | 'timeout'

type ProcessOutcome =
  | { readonly kind: 'close'; readonly exitCode: number | null }
  | { readonly kind: 'error'; readonly error: NodeJS.ErrnoException }
  | { readonly kind: 'stop' }

export async function runProcess(
  input: ShellProcessInput,
  ctx: ToolInvocationContext
): Promise<ShellProcessResult> {
  if (ctx.signal.aborted) {
    throw abortError(ctx.signal)
  }

  const child = spawnProcess(input, ctx.workspaceDir, ctx.childEnv)
  const stop = createProcessStop(child)
  const stdout = readCappedStream(child.stdout, SHELL_OUTPUT_CAP_BYTES, () =>
    stop.request('output_cap')
  )
  const stderr = readCappedStream(child.stderr, SHELL_OUTPUT_CAP_BYTES, () =>
    stop.request('output_cap')
  )
  const onAbort = (): void => stop.request('abort')
  const timer = setTimeout(() => stop.request('timeout'), input.timeoutMs)

  ctx.signal.addEventListener('abort', onAbort, { once: true })
  if (ctx.signal.aborted) {
    onAbort()
  }

  ctx.reportProgress?.({ key: 'progress.shellStarted', mode: 'transient' })

  try {
    const outcome = await waitForOutcome(child, stop.signal)

    if (outcome.kind !== 'close') {
      if (outcome.kind === 'error') {
        stop.request('error')
      }
      await waitForCloseOrGrace(child)
      stdout.stop()
      stderr.stop()
    }

    const [stdoutResult, stderrResult] = await Promise.all([stdout.done, stderr.done])
    const stopReason = stop.reason()

    assertProcessOutcome(outcome, stopReason, ctx.signal)
    assertStreamsCompleted(stdoutResult, stderrResult)

    if (stopReason === 'timeout') {
      ctx.reportProgress?.({ key: 'progress.shellTimedOut', mode: 'transient' })
    } else if (stopReason !== undefined) {
      ctx.reportProgress?.({ key: 'progress.shellTerminated', mode: 'transient' })
    }

    return {
      stdout: stdoutResult.text,
      stderr: stderrResult.text,
      exitCode: outcome.kind === 'close' ? outcome.exitCode : child.exitCode,
      truncated: stdoutResult.truncated || stderrResult.truncated,
      timedOut: stopReason === 'timeout',
    }
  } finally {
    clearTimeout(timer)
    ctx.signal.removeEventListener('abort', onAbort)
    terminateProcess(child)
    stdout.stop()
    stderr.stop()
  }
}

function spawnProcess(
  input: ShellProcessInput,
  cwd: string,
  env: Readonly<Record<string, string>>
): ChildProcess {
  return spawn(input.command, [...input.args], {
    cwd,
    env: { ...env },
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function createProcessStop(child: ChildProcess) {
  const controller = new AbortController()
  let current: StopReason | undefined

  return {
    signal: controller.signal,
    reason: (): StopReason | undefined => current,
    request(reason: StopReason): void {
      if (current !== undefined) {
        return
      }

      current = reason
      terminateProcess(child)
      controller.abort()
    },
  }
}

function readCappedStream(
  stream: Readable | null,
  cap: number,
  onFull?: () => void
): StreamCapture {
  if (stream === null) {
    return { done: Promise.resolve({ text: '', truncated: false }), stop: () => undefined }
  }

  let truncated = false
  let settled = false
  const buffer: StreamBuffer = { chunks: [], size: 0 }
  const { promise: done, resolve } = Promise.withResolvers<StreamResult>()

  const finish = (error?: Error): void => {
    if (settled) {
      return
    }

    settled = true
    cleanup()
    resolve({
      text: Buffer.concat(buffer.chunks).toString('utf8'),
      truncated,
      ...(error === undefined ? {} : { error }),
    })
  }
  const onData = (chunk: Buffer): void => {
    if (!appendCappedChunk(buffer, chunk, cap)) {
      return
    }

    truncated = true
    onFull?.()
    finish()
  }
  const onDone = (): void => finish()
  const onError = (error: Error): void => finish(error)
  const cleanup = (): void => {
    stream.off('data', onData)
    stream.off('end', onDone)
    stream.off('error', onError)
    stream.off('close', onDone)
  }

  stream.on('data', onData)
  stream.once('end', onDone)
  stream.once('error', onError)
  stream.once('close', onDone)

  return {
    done,
    stop(): void {
      if (!stream.destroyed) {
        stream.destroy()
      }
      finish()
    },
  }
}

function appendCappedChunk(buffer: StreamBuffer, chunk: Buffer, cap: number): boolean {
  const remaining = cap - buffer.size

  if (chunk.length <= remaining) {
    buffer.size += chunk.length
    buffer.chunks.push(chunk)
    return false
  }

  if (remaining > 0) {
    buffer.chunks.push(chunk.subarray(0, remaining))
  }
  buffer.size = cap
  return true
}

function waitForOutcome(child: ChildProcess, signal: AbortSignal): Promise<ProcessOutcome> {
  if (signal.aborted) {
    return Promise.resolve({ kind: 'stop' })
  }

  return new Promise((resolve) => {
    const finish = (outcome: ProcessOutcome): void => {
      child.off('close', onClose)
      child.off('error', onError)
      signal.removeEventListener('abort', onStop)
      resolve(outcome)
    }
    const onClose = (exitCode: number | null): void => finish({ kind: 'close', exitCode })
    const onError = (error: NodeJS.ErrnoException): void => finish({ kind: 'error', error })
    const onStop = (): void => finish({ kind: 'stop' })

    child.once('close', onClose)
    child.once('error', onError)
    signal.addEventListener('abort', onStop, { once: true })
  })
}

function assertProcessOutcome(
  outcome: ProcessOutcome,
  stopReason: StopReason | undefined,
  signal: AbortSignal
): void {
  if (stopReason === 'abort') {
    throw abortError(signal)
  }

  if (outcome.kind === 'error') {
    throw new ToolError(
      spawnErrorCode(outcome.error),
      `spawn failed: ${outcome.error.message}`,
      outcome.error
    )
  }
}

// A missing or non-executable command is the caller's argv, not an internal fault: reporting it as
// `unexpected` tells the model to retry the same thing instead of fixing the command.
function spawnErrorCode(error: Error): 'invalid_input' | 'unexpected' {
  return SPAWN_INPUT_ERROR_CODES.some((code) => isErrno(error, code))
    ? 'invalid_input'
    : 'unexpected'
}

function assertStreamsCompleted(stdout: StreamResult, stderr: StreamResult): void {
  const streamError = stdout.error ?? stderr.error

  if (streamError !== undefined) {
    throw new ToolError('unexpected', `process stream failed: ${streamError.message}`, streamError)
  }
}

function terminateProcess(child: ChildProcess): void {
  if (child.pid === undefined) {
    return
  }

  if (process.platform === 'win32') {
    child.kill()
    return
  }

  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    // Cleanup is idempotent when the process has already exited.
  }
}

function waitForCloseOrGrace(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (): void => {
      child.off('close', finish)
      if (timer !== undefined) {
        clearTimeout(timer)
      }
      resolve()
    }

    child.once('close', finish)
    timer = setTimeout(finish, SHELL_KILL_GRACE_MS)
  })
}
