import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ToolError } from '@/core/errors'
import { settleWithin } from '@/core/utils/concurrency'
import { toPluginError } from '@/plugins/policy/errors'

// Cloning runs a third-party binary against an untrusted URL; it gets a path and a prompt-free
// terminal, never the provider keys in the daemon's environment.
const GIT_CLONE_ENV_KEYS = ['PATH', 'HOME', 'SSL_CERT_FILE', 'SSL_CERT_DIR'] as const
// Re-asserted here rather than trusted from the caller: git reads a leading `-` as an option
// (`--upload-pack=` runs a command), so the scheme is pinned where the spawn happens.
const HTTPS_SOURCE_RE = /^https:\/\//
const GIT_CLONE_TIMEOUT_MS = 60_000
const GIT_CLONE_STDERR_MAX_BYTES = 2_048
const CLONE_KILL_GRACE_MS = 5_000

/** Returns the temporary directory the clone landed in; the caller owns removing it. */
export async function cloneRemoteSource(url: string, signal?: AbortSignal): Promise<string> {
  if (!HTTPS_SOURCE_RE.test(url)) {
    throw new ToolError('invalid_input', 'plugin clone source must be an https URL')
  }

  if (signal?.aborted) {
    throw new ToolError('timeout', 'plugin clone aborted')
  }

  const dir = join(tmpdir(), `plugin-${randomUUID()}`)
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  const timeout = setTimeout(() => controller.abort(), GIT_CLONE_TIMEOUT_MS)
  let proc: ReturnType<typeof Bun.spawn> | undefined

  try {
    proc = Bun.spawn(buildGitCloneArgs(url, dir), {
      env: buildGitCloneEnv(),
      stderr: 'pipe',
      detached: process.platform !== 'win32',
    })

    // Drained concurrently with the exit: git blocks writing progress once the pipe buffer fills,
    // so a read that only starts after `exited` can never observe the exit it is waiting for.
    const stderr = readCloneStderr(proc)
    const exited = await raceCloneExit(proc, controller)
    const diagnostics = await stderr

    if (exited !== 0) {
      throw new ToolError(
        'invalid_input',
        diagnostics ? `git clone failed: ${diagnostics}` : 'git clone failed'
      )
    }

    return dir
  } catch (err: unknown) {
    await cleanupClone(proc, dir)
    throw toPluginError(err, 'git clone failed')
  } finally {
    signal?.removeEventListener('abort', onAbort)
    clearTimeout(timeout)
  }
}

// Diagnostics only: an unreadable or failing pipe must not replace the clone's own outcome.
function readCloneStderr(proc: ReturnType<typeof Bun.spawn>): Promise<string> {
  const stream = proc.stderr

  if (!(stream instanceof ReadableStream)) {
    return Promise.resolve('')
  }

  return readBoundedStderr(stream, GIT_CLONE_STDERR_MAX_BYTES).catch(() => '')
}

function buildGitCloneArgs(url: string, dir: string): string[] {
  return [
    'git',
    '-c',
    'protocol.allow=never',
    '-c',
    'protocol.https.allow=always',
    'clone',
    '--depth=1',
    url,
    dir,
  ]
}

function buildGitCloneEnv(): Record<string, string> {
  const env: Record<string, string> = { GIT_TERMINAL_PROMPT: '0' }

  for (const key of GIT_CLONE_ENV_KEYS) {
    const value = Bun.env[key]

    if (value !== undefined) {
      env[key] = value
    }
  }

  return env
}

async function raceCloneExit(
  proc: ReturnType<typeof Bun.spawn>,
  controller: AbortController
): Promise<number> {
  return await Promise.race([
    proc.exited,
    new Promise<never>((_, reject) => {
      controller.signal.addEventListener(
        'abort',
        () => reject(new ToolError('timeout', 'git clone timed out')),
        { once: true }
      )
    }),
  ])
}

async function cleanupClone(
  proc: ReturnType<typeof Bun.spawn> | undefined,
  dir: string
): Promise<void> {
  if (proc !== undefined) {
    await terminateClone(proc)
  }

  await rm(dir, { recursive: true, force: true }).catch(() => undefined)
}

async function terminateClone(proc: ReturnType<typeof Bun.spawn>): Promise<void> {
  signalClone(proc, 'SIGTERM')
  await settleWithin(proc.exited, CLONE_KILL_GRACE_MS)

  if (process.platform === 'win32') {
    if (proc.exitCode === null) {
      signalClone(proc, 'SIGKILL')
      await settleWithin(proc.exited, CLONE_KILL_GRACE_MS)
    }

    return
  }

  if (!hasCloneProcessGroup(proc.pid)) {
    return
  }

  signalClone(proc, 'SIGKILL')
  await settleWithin(proc.exited, CLONE_KILL_GRACE_MS)
}

function signalClone(proc: ReturnType<typeof Bun.spawn>, signal: 'SIGTERM' | 'SIGKILL'): void {
  try {
    if (process.platform === 'win32') {
      proc.kill(signal)

      return
    }

    process.kill(-proc.pid, signal)
  } catch {
    // Cleanup is idempotent when the process already exited.
  }
}

function hasCloneProcessGroup(pid: number): boolean {
  try {
    process.kill(-pid, 0)

    return true
  } catch {
    return false
  }
}

// Bytes are capped exactly and decoded once: a per-chunk decode would cap UTF-16 code units
// against a byte budget, and cancelling releases the pipe whether or not the stream drained.
async function readBoundedStderr(
  stream: ReadableStream<Uint8Array<ArrayBufferLike>>,
  maxBytes: number
): Promise<string> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0

  try {
    while (bytes < maxBytes) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      const kept = value.subarray(0, maxBytes - bytes)
      bytes += kept.byteLength
      chunks.push(kept)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }

  return new TextDecoder().decode(Buffer.concat(chunks))
}
