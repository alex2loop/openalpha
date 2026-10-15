import type { Dirent } from 'node:fs'
import { lstat, realpath } from 'node:fs/promises'
import { basename, join, sep } from 'node:path'

import type { WorkspaceIdentity } from '@/core/security/path-policy'
import { readDirPinned } from '@/tools/fs/read-dir'

const DEFAULT_MAX_DEPTH = 3
const DEFAULT_MAX_FILES = 1_000
const DEFAULT_MAX_DIRECTORIES = 10_000
// Only these names are skipped: dot-directories in general are still descended into, and dot-files
// are surfaced normally.
const SKIP_DIR_NAMES: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'target',
  '__pycache__',
  'venv',
  '.venv',
  'dist',
  'build',
  '.next',
  '.turbo',
])

export interface WalkFileEntry {
  readonly kind: 'file'
  readonly relPath: string
  readonly size: number
  readonly mtimeMs: number
}

interface WalkDirectoryEntry {
  readonly kind: 'directory'
  readonly relPath: string
}

interface WalkSymlinkEntry {
  readonly kind: 'symlink'
  readonly relPath: string
}

export type WalkEntry = WalkFileEntry | WalkDirectoryEntry | WalkSymlinkEntry

interface WalkResult {
  readonly entries: readonly WalkEntry[]
  readonly truncated: boolean
  /** A directory below the depth bound was left unread, so its contents are unseen. */
  readonly depthCut: boolean
}

interface WalkOptions {
  readonly dirPath: string
  // Identity of the root, pinned per directory read; every descended dir must stay under its path.
  readonly workspace: WorkspaceIdentity
  readonly maxDepth?: number
  readonly maxFiles?: number
  readonly maxDirectories?: number
  readonly signal: AbortSignal
}

interface WalkState {
  readonly entries: WalkEntry[]
  fileCount: number
  directoriesVisited: number
  depthCut: boolean
  readonly root: string
  readonly workspace: WorkspaceIdentity
  readonly workspacePrefix: string
  readonly maxDepth: number
  readonly maxFiles: number
  readonly maxDirectories: number
  readonly signal: AbortSignal
}

// The one recursive walk shared by file_list and file_search. Returns a discriminated entry union
// so file_list can include directories and symlinks while file_search filters to files.
// Bounds are preserved: maxFiles governs files, maxDirectories governs directories visited.
export async function walkFiles(options: WalkOptions): Promise<WalkResult> {
  const state: WalkState = {
    entries: [],
    fileCount: 0,
    directoriesVisited: 0,
    depthCut: false,
    root: options.dirPath,
    workspace: options.workspace,
    workspacePrefix: withTrailingSep(options.workspace.path),
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES,
    maxDirectories: options.maxDirectories ?? DEFAULT_MAX_DIRECTORIES,
    signal: options.signal,
  }

  const truncated = await walkInto(state, options.dirPath, 0)

  return { entries: state.entries, truncated, depthCut: state.depthCut }
}

// Returns true once any bound is hit so callers unwind.
async function walkInto(state: WalkState, dirPath: string, depth: number): Promise<boolean> {
  if (isAtBound(state)) {
    return true
  }

  state.directoriesVisited += 1
  const read = await readDirPinned({
    workspace: state.workspace,
    dirPath,
    limit: state.maxFiles,
    signal: state.signal,
  })
  const dirents = [...read.entries].sort((a, b) => a.name.localeCompare(b.name))

  for (const dirent of dirents) {
    if (isAtFileBound(state) || (await collectEntry({ state, dirPath, dirent, depth }))) {
      return true
    }
  }

  return read.truncated
}

function isAtBound(state: WalkState): boolean {
  return (
    state.signal.aborted ||
    state.fileCount >= state.maxFiles ||
    state.directoriesVisited >= state.maxDirectories
  )
}

function isAtFileBound(state: WalkState): boolean {
  return state.signal.aborted || state.fileCount >= state.maxFiles
}

async function collectEntry(options: {
  readonly state: WalkState
  readonly dirPath: string
  readonly dirent: Dirent
  readonly depth: number
}): Promise<boolean> {
  const { state, dirPath, dirent, depth } = options
  const fullPath = join(dirPath, dirent.name)

  if (dirent.isFile()) {
    return collectFile(state, fullPath)
  }

  if (dirent.isSymbolicLink()) {
    collectSymlink(state, fullPath)
    return false
  }

  if (dirent.isDirectory()) {
    return collectDirectory(state, fullPath, depth)
  }

  return false
}

async function collectFile(state: WalkState, fullPath: string): Promise<boolean> {
  const info = await lstat(fullPath).catch(() => null)

  if (info === null) {
    return false
  }

  state.fileCount += 1
  state.entries.push({
    kind: 'file',
    relPath: relFromRoot(state.root, fullPath),
    size: info.size,
    mtimeMs: info.mtimeMs,
  })

  return state.fileCount >= state.maxFiles
}

function collectSymlink(state: WalkState, fullPath: string): void {
  state.entries.push({ kind: 'symlink', relPath: relFromRoot(state.root, fullPath) })
}

async function collectDirectory(
  state: WalkState,
  fullPath: string,
  depth: number
): Promise<boolean> {
  if (state.directoriesVisited >= state.maxDirectories) {
    return true
  }

  state.entries.push({ kind: 'directory', relPath: relFromRoot(state.root, fullPath) })

  if (SKIP_DIR_NAMES.has(basename(fullPath))) {
    return false
  }

  if (depth >= state.maxDepth) {
    state.depthCut = true

    return false
  }

  return descend(state, fullPath, depth)
}

async function descend(state: WalkState, fullPath: string, depth: number): Promise<boolean> {
  const stat = await lstat(fullPath).catch(() => null)

  // A symlinked directory is never followed — the guard against escaping the root.
  if (stat === null || stat.isSymbolicLink()) {
    return false
  }

  const resolved = await realpath(fullPath).catch(() => null)

  if (resolved === null || !isWithinWorkspace(resolved, state)) {
    return false
  }

  return walkInto(state, fullPath, depth + 1)
}

function isWithinWorkspace(resolved: string, state: WalkState): boolean {
  return (
    resolved === state.workspacePrefix.slice(0, -1) || resolved.startsWith(state.workspacePrefix)
  )
}

function relFromRoot(root: string, fullPath: string): string {
  const prefix = withTrailingSep(root)

  return fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : fullPath
}

function withTrailingSep(path: string): string {
  return path.endsWith(sep) ? path : `${path}${sep}`
}
