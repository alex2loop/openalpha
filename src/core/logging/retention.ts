import type { Dir } from 'node:fs'
import { lstat, opendir, rmdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import type { AgentId } from '@/core/ids'
import { ConfigError, isErrno } from '@/core/errors'
import { readDirectoryNames } from '@/core/fs'
import { type StableFileIdentity, unlinkStableFile } from '@/core/logging/files'
import { isLogSegmentName, resolveAgentLogsDir } from '@/core/logging/paths'

const MAX_AGENT_LOG_ENTRIES = 10_000
const AGENT_LOG_BASE = 'agent.log'

export interface AgentLogRetentionResult {
  readonly removedDirectories: number
  readonly removedBytes: number
  readonly failures: number
}

export interface DaemonLogRetentionResult {
  readonly removedFiles: number
  readonly removedBytes: number
  readonly failures: number
}

interface LogFileEntry {
  readonly path: string
  readonly identity: StableFileIdentity
  readonly mtimeMs: number
  readonly size: number
}

interface DirReadResult {
  readonly files: readonly LogFileEntry[]
  readonly invalid: boolean
}

type DirInspection =
  | { readonly status: 'empty' }
  | {
      readonly status: 'clearable'
      readonly removedBytes: number
      readonly files: readonly LogFileEntry[]
    }
  | { readonly status: 'too-new' }
  | { readonly status: 'missing' }
  | { readonly status: 'invalid' }

type DaemonLogSet =
  | { readonly status: 'clearable'; readonly files: readonly LogFileEntry[] }
  | { readonly status: 'skip' }
  | { readonly status: 'invalid' }

// Daemon policy: delete whole per-agent directories for agents no longer configured,
// age-gated. Distinct from the CLI clear policy, which honours no configured-skip.
export async function pruneRemovedAgentLogs(input: {
  readonly dataDir: string
  readonly configuredAgentIds: ReadonlySet<string>
  readonly cutoffAt: number
}): Promise<AgentLogRetentionResult> {
  const root = resolveAgentLogsDir(input.dataDir)
  const names = await listAgentLogDirs(root)

  let removedDirectories = 0
  let removedBytes = 0
  let failures = 0

  for (const name of names) {
    if (input.configuredAgentIds.has(name)) {
      continue
    }

    const result = await clearAgentLogDir(join(root, name), input.cutoffAt)

    removedDirectories += result.removedDirectories
    removedBytes += result.removedBytes
    failures += result.failures
  }

  return { removedDirectories, removedBytes, failures }
}

// CLI policy: age-gated per-agent log removal with optional single-agent scope,
// no configured-skip. `cutoffAt = Infinity` clears regardless of age.
export async function countAgentLogs(input: {
  readonly dataDir: string
  readonly agentId?: AgentId
  readonly cutoffAt: number
}): Promise<AgentLogRetentionResult> {
  const targets = await resolveAgentLogTargets(input.dataDir, input.agentId)

  let removedDirectories = 0
  let removedBytes = 0
  let failures = 0

  for (const dirPath of targets) {
    const result = await countAgentLogDir(dirPath, input.cutoffAt)

    removedDirectories += result.removedDirectories
    removedBytes += result.removedBytes
    failures += result.failures
  }

  return { removedDirectories, removedBytes, failures }
}

export async function clearAgentLogs(input: {
  readonly dataDir: string
  readonly agentId?: AgentId
  readonly cutoffAt: number
}): Promise<AgentLogRetentionResult> {
  const targets = await resolveAgentLogTargets(input.dataDir, input.agentId)

  let removedDirectories = 0
  let removedBytes = 0
  let failures = 0

  for (const dirPath of targets) {
    const result = await clearAgentLogDir(dirPath, input.cutoffAt)

    removedDirectories += result.removedDirectories
    removedBytes += result.removedBytes
    failures += result.failures
  }

  return { removedDirectories, removedBytes, failures }
}

// CLI policy: remove the daemon log and its rotated segments, age-gated on the newest segment.
// `cutoffAt = Infinity` clears regardless of age.
export async function countDaemonLogs(input: {
  readonly file: string
  readonly cutoffAt: number
}): Promise<DaemonLogRetentionResult> {
  const set = await findDaemonLogFiles(input.file, input.cutoffAt)

  if (set.status !== 'clearable') {
    return skippedDaemonResult(set.status)
  }

  return { removedFiles: set.files.length, removedBytes: totalBytes(set.files), failures: 0 }
}

export async function clearDaemonLogs(input: {
  readonly file: string
  readonly cutoffAt: number
}): Promise<DaemonLogRetentionResult> {
  const set = await findDaemonLogFiles(input.file, input.cutoffAt)

  if (set.status !== 'clearable') {
    return skippedDaemonResult(set.status)
  }

  let removedFiles = 0
  let removedBytes = 0
  let failures = 0

  for (const file of set.files) {
    try {
      await unlinkStableFile(file.path, file.identity)
      removedFiles += 1
      removedBytes += file.size
    } catch {
      failures += 1
    }
  }

  return { removedFiles, removedBytes, failures }
}

async function resolveAgentLogTargets(
  dataDir: string,
  agentId: AgentId | undefined
): Promise<readonly string[]> {
  const root = resolveAgentLogsDir(dataDir)

  if (agentId !== undefined) {
    return [join(root, agentId)]
  }

  const names = await listAgentLogDirs(root)

  return names.map((name) => join(root, name))
}

async function listAgentLogDirs(root: string): Promise<readonly string[]> {
  const result = await readDirectoryNames(root, MAX_AGENT_LOG_ENTRIES)

  if (result.kind === 'absent') {
    return []
  }

  if (result.kind === 'over-limit') {
    throw new ConfigError('agent log retention exceeds entry bound')
  }

  return result.names
}

// Preview what would be removed without touching the filesystem.
async function countAgentLogDir(
  dirPath: string,
  cutoffAt: number
): Promise<AgentLogRetentionResult> {
  const inspection = await inspectAgentLogDir(dirPath, cutoffAt)

  switch (inspection.status) {
    case 'clearable':
      return { removedDirectories: 1, removedBytes: inspection.removedBytes, failures: 0 }
    case 'empty':
      return { removedDirectories: 1, removedBytes: 0, failures: 0 }
    case 'invalid':
      return { removedDirectories: 0, removedBytes: 0, failures: 1 }
    case 'missing':
    case 'too-new':
      return { removedDirectories: 0, removedBytes: 0, failures: 0 }
  }
}

// Inspect then delete a single agent log directory.
async function clearAgentLogDir(
  dirPath: string,
  cutoffAt: number
): Promise<AgentLogRetentionResult> {
  const inspection = await inspectAgentLogDir(dirPath, cutoffAt)

  switch (inspection.status) {
    case 'clearable':
      return removeAgentLogFiles(dirPath, inspection.files)
    case 'empty':
      return removeAgentLogDir(dirPath)
    case 'invalid':
      return { removedDirectories: 0, removedBytes: 0, failures: 1 }
    case 'missing':
    case 'too-new':
      return { removedDirectories: 0, removedBytes: 0, failures: 0 }
  }
}

// Pure inspection: never unlinks. empty = no files (rmdir only); clearable = files aged out;
// too-new = newest segment newer than cutoff (skip); missing = ENOENT (no-op);
// invalid = non-dir, stray entries, unreadable.
async function inspectAgentLogDir(dirPath: string, cutoffAt: number): Promise<DirInspection> {
  const dirStatus = await statLogDir(dirPath)

  if (dirStatus === 'missing') {
    return { status: 'missing' }
  }
  if (dirStatus === 'invalid') {
    return { status: 'invalid' }
  }

  const read = await readLogFiles(dirPath, AGENT_LOG_BASE)

  if (read.invalid) {
    return { status: 'invalid' }
  }

  if (read.files.length === 0) {
    return { status: 'empty' }
  }

  if (newestMtime(read.files) >= cutoffAt) {
    return { status: 'too-new' }
  }

  return { status: 'clearable', removedBytes: totalBytes(read.files), files: read.files }
}

// The daemon log shares its directory with unrelated data files, so only the base name and its
// rotated segments are ever collected and the directory itself is never removed.
async function findDaemonLogFiles(file: string, cutoffAt: number): Promise<DaemonLogSet> {
  const parent = dirname(file)
  const dirStatus = await statLogDir(parent)

  if (dirStatus !== 'ok') {
    return { status: dirStatus === 'missing' ? 'skip' : 'invalid' }
  }

  const read = await readLogFiles(parent, basename(file))

  if (read.invalid) {
    return { status: 'invalid' }
  }

  if (read.files.length === 0 || newestMtime(read.files) >= cutoffAt) {
    return { status: 'skip' }
  }

  return { status: 'clearable', files: read.files }
}

function skippedDaemonResult(status: 'skip' | 'invalid'): DaemonLogRetentionResult {
  return { removedFiles: 0, removedBytes: 0, failures: status === 'invalid' ? 1 : 0 }
}

async function statLogDir(dirPath: string): Promise<'ok' | 'missing' | 'invalid'> {
  try {
    const info = await lstat(dirPath)

    return info.isSymbolicLink() || !info.isDirectory() ? 'invalid' : 'ok'
  } catch (err: unknown) {
    return isErrno(err, 'ENOENT') ? 'missing' : 'invalid'
  }
}

async function readLogFiles(dirPath: string, base: string): Promise<DirReadResult> {
  // A vanishing or unreadable directory is one bounded failure, never a sweep abort.
  const dir = await opendir(dirPath).catch(() => undefined)

  if (dir === undefined) {
    return { files: [], invalid: true }
  }

  const files: LogFileEntry[] = []
  let invalid = false

  try {
    while (true) {
      const entry = await dir.read()

      if (entry === null) {
        break
      }

      const name = entry.name

      if (!isRecognizedLogName(base, name)) {
        // A stray sibling (.DS_Store, an editor swap file) is not evidence the directory needs
        // attention — only a name matching the segment shape that then fails identity checks is.
        continue
      }

      const path = join(dirPath, name)
      const stat = await lstat(path).catch(() => undefined)

      if (stat === undefined || stat.isSymbolicLink() || !stat.isFile()) {
        invalid = true

        continue
      }

      files.push(logFileEntry(path, stat))
    }
  } catch {
    // Bun resolves `opendir` on a missing path and defers ENOENT to the first read, so a directory
    // that vanished after the lstat above surfaces here rather than at the open. The contract is
    // one bounded failure, not a sweep abort.
    invalid = true
  } finally {
    invalid = !(await tryCloseDirectory(dir)) || invalid
  }

  return { files, invalid }
}

function isRecognizedLogName(base: string, name: string): boolean {
  return name === base || isLogSegmentName(base, name)
}

function newestMtime(files: readonly LogFileEntry[]): number {
  return files.reduce((newest, file) => Math.max(newest, file.mtimeMs), Number.NEGATIVE_INFINITY)
}

function totalBytes(files: readonly LogFileEntry[]): number {
  return files.reduce((total, file) => total + file.size, 0)
}

async function removeAgentLogFiles(
  dirPath: string,
  files: readonly LogFileEntry[]
): Promise<AgentLogRetentionResult> {
  let removedBytes = 0
  let failures = 0

  for (const file of files) {
    try {
      await unlinkStableFile(file.path, file.identity)
      removedBytes += file.size
    } catch {
      failures += 1
    }
  }

  if (failures > 0) {
    return { removedDirectories: 0, removedBytes, failures }
  }

  return removeAgentLogDir(dirPath)
}

async function removeAgentLogDir(dirPath: string): Promise<AgentLogRetentionResult> {
  try {
    await rmdir(dirPath)

    return { removedDirectories: 1, removedBytes: 0, failures: 0 }
  } catch {
    return { removedDirectories: 0, removedBytes: 0, failures: 1 }
  }
}

function logFileEntry(
  path: string,
  stat: { dev: number; ino: number; mtimeMs: number; size: number }
): LogFileEntry {
  return {
    path,
    identity: { dev: stat.dev, ino: stat.ino },
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  }
}

async function tryCloseDirectory(dir: Dir): Promise<boolean> {
  try {
    await dir.close()

    return true
  } catch {
    return false
  }
}
