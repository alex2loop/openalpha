import type { FileHandle } from 'node:fs/promises'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { basename, dirname, join, normalize, resolve, sep } from 'node:path'

import { isErrno, ToolError } from '@/core/errors'

const BLOCKED_DEVICE_PATHS: ReadonlySet<string> = new Set([
  '/dev/zero',
  '/dev/random',
  '/dev/urandom',
  '/dev/stdin',
  '/dev/stdout',
  '/dev/stderr',
  '/dev/tty',
  '/dev/console',
  '/dev/null',
  '/dev/full',
  '/dev/fd/0',
  '/dev/fd/1',
  '/dev/fd/2',
])
const BLOCKED_PROC_FD_RE = /^\/proc\/\d+\/fd\/[0-2]$/
const BACKSLASH_RE = /\\/g

// Stored upper-cased so the check is case-insensitive on case-insensitive
// file systems (macOS APFS, Windows). basename is upper-cased before lookup.
const PROTECTED_FILE_NAMES: ReadonlySet<string> = new Set(['AGENTS.MD', 'CLAUDE.MD', 'CONTEXT.MD'])

// POSIX-style relative suffixes. Match requires realPath to end with '/' + suffix,
// preventing false positives like 'not.ssh/config'.
const BLOCKED_PATH_SUFFIXES: ReadonlySet<string> = new Set([
  '.ssh/authorized_keys',
  '.ssh/id_rsa',
  '.ssh/id_ed25519',
  '.ssh/id_ecdsa',
  '.ssh/id_dsa',
  '.ssh/config',
  '.aws/credentials',
  '.aws/config',
  '.gnupg/private-keys-v1.d',
  '.kube/config',
  '.netrc',
  '.pgpass',
  '.docker/config.json',
])
// `.env` and every `.env.<suffix>` variant (`.env.local`, `.env.production`) — matched on
// basename rather than as a suffix, since the set above only guards fixed relative paths.
const ENV_FILE_BASENAME_RE = /^\.env(\..+)?$/
const BLOCKED_ABSOLUTE_PATHS: ReadonlySet<string> = new Set([
  '/etc/sudoers',
  '/etc/passwd',
  '/etc/shadow',
  '/etc/gshadow',
  '/var/run/docker.sock',
  '/run/docker.sock', // realpath of /var/run/docker.sock on Linux (/var/run -> /run symlink)
])

interface PathResolver {
  resolve(rel: string): Promise<string>
}

export interface WorkspaceIdentity {
  readonly path: string
  readonly dev: number
  readonly ino: number
}

export interface PathRemovalResolver {
  resolveDirectory(rel: string): Promise<string>
  resolveFile(rel: string): Promise<string>
}

export const PathPolicy = {
  async identify(path: string): Promise<WorkspaceIdentity> {
    try {
      const handle = await open(
        path,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
      )

      try {
        const info = await handle.stat()
        const canonical = await realpath(path)
        const identity = { path: canonical, dev: info.dev, ino: info.ino }

        await assertWorkspaceIdentity(identity)
        return Object.freeze(identity)
      } finally {
        await handle.close().catch(() => undefined)
      }
    } catch (err: unknown) {
      if (err instanceof ToolError) {
        throw err
      }

      throw new ToolError('path_escape', 'workspace root is unavailable or changed', err)
    }
  },

  forRead(workspace: WorkspaceIdentity): PathResolver {
    return { resolve: (rel) => resolveForRead(workspace, rel) }
  },

  forWrite(workspace: WorkspaceIdentity): PathResolver {
    return { resolve: (rel) => resolveForWrite(workspace, rel) }
  },

  forRemoval(workspace: WorkspaceIdentity): PathRemovalResolver {
    return {
      resolveDirectory: (rel) => resolveExistingForRemoval(workspace, rel, 'directory'),
      resolveFile: (rel) => resolveExistingForRemoval(workspace, rel, 'file'),
    }
  },

  // A resolver validates a path string, and the caller then reopens it by name: a parent directory
  // swapped for a symlink in between escapes, because O_NOFOLLOW only guards the final component.
  // Matching the reopened path against the descriptor rejects both the swap and its reversal.
  async assertOpenedWithin(
    workspace: WorkspaceIdentity,
    handle: FileHandle,
    path: string
  ): Promise<void> {
    const opened = await handle.stat()
    const target = await identifyOpenedTarget(path)

    assertInsideWorkspace(workspace, target.canonical, path)

    if (target.dev !== opened.dev || target.ino !== opened.ino) {
      throw new ToolError('path_escape', `path ${path} changed while opening`)
    }
  },

  // For a directory walk, where only the root went through `resolve`.
  isSensitive: (realPath: string): boolean => isSensitivePath(realPath),
} as const

async function identifyOpenedTarget(
  path: string
): Promise<{ readonly canonical: string; readonly dev: number; readonly ino: number }> {
  try {
    const canonical = await realpath(path)
    const info = await lstat(canonical)

    return { canonical, dev: info.dev, ino: info.ino }
  } catch (err: unknown) {
    throw new ToolError('path_escape', `path resolution failed: ${path}`, err)
  }
}

// Sensitive paths are denied on read as well as write: containment already keeps the agent inside
// the workspace, but a workspace rooted at (or vendoring) a credential path would otherwise hand
// a private key straight into the transcript.
async function resolveForRead(workspace: WorkspaceIdentity, rel: string): Promise<string> {
  const real = await assertWithinWorkspace(workspace, rel)
  assertNotDevicePath(real)
  assertNotSensitivePath(real)

  return real
}

async function resolveForWrite(workspace: WorkspaceIdentity, rel: string): Promise<string> {
  const real = await assertWithinWorkspace(workspace, rel)
  assertNotDevicePath(real)
  assertNotSensitivePath(real)
  assertNotProtectedFile(real)

  return real
}

async function assertWithinWorkspace(
  workspace: WorkspaceIdentity,
  requestedPath: string
): Promise<string> {
  assertNoNul(requestedPath)

  await assertWorkspaceIdentity(workspace)
  const real = await resolveTarget(workspace.path, requestedPath)

  assertInsideWorkspace(workspace, real, requestedPath)

  await assertWorkspaceIdentity(workspace)
  return real
}

function assertInsideWorkspace(
  workspace: WorkspaceIdentity,
  real: string,
  requestedPath: string
): void {
  if (real !== workspace.path && !real.startsWith(workspace.path + sep)) {
    throw new ToolError('path_escape', `path ${requestedPath} escapes workspace`)
  }
}

async function resolveExistingForRemoval(
  workspace: WorkspaceIdentity,
  requestedPath: string,
  expected: 'directory' | 'file'
): Promise<string> {
  assertNoNul(requestedPath)

  await assertWorkspaceIdentity(workspace)
  const absolute = resolve(workspace.path, requestedPath)

  assertInsideWorkspace(workspace, absolute, requestedPath)

  const info = await lstat(absolute).catch((err: unknown) => {
    if (err instanceof ToolError) {
      throw err
    }

    if (isErrno(err, 'ENOENT')) {
      throw new ToolError('invalid_input', `removal target does not exist: ${requestedPath}`, err)
    }

    throw new ToolError('invalid_input', `removal target is unavailable: ${requestedPath}`, err)
  })

  if (info.isSymbolicLink()) {
    throw new ToolError('invalid_input', `refusing to remove symbolic link: ${requestedPath}`)
  }

  const matches = expected === 'directory' ? info.isDirectory() : info.isFile()

  if (!matches) {
    throw new ToolError('invalid_input', `removal target is not a ${expected}: ${requestedPath}`)
  }

  const targetReal = await realpath(absolute).catch((err: unknown) => {
    throw new ToolError('path_escape', `path resolution failed: ${requestedPath}`, err)
  })

  assertInsideWorkspace(workspace, targetReal, requestedPath)

  await assertWorkspaceIdentity(workspace)
  return targetReal
}

async function assertWorkspaceIdentity(workspace: WorkspaceIdentity): Promise<void> {
  try {
    const [info, canonical] = await Promise.all([lstat(workspace.path), realpath(workspace.path)])

    if (
      info.isSymbolicLink() ||
      !info.isDirectory() ||
      info.dev !== workspace.dev ||
      info.ino !== workspace.ino ||
      canonical !== workspace.path
    ) {
      throw new ToolError('path_escape', 'workspace root changed after preparation')
    }
  } catch (err: unknown) {
    if (err instanceof ToolError) {
      throw err
    }

    throw new ToolError('path_escape', 'workspace root is unavailable or changed', err)
  }
}

async function resolveTarget(workspaceDir: string, requestedPath: string): Promise<string> {
  const absolute = resolve(workspaceDir, requestedPath)

  try {
    return await realpath(absolute)
  } catch (err: unknown) {
    if (!isErrno(err, 'ENOENT')) {
      throw new ToolError('path_escape', `path resolution failed: ${requestedPath}`, err)
    }
  }

  // ENOENT — walk ancestors until an existing dir is found, realpath it, re-attach the
  // unresolved suffix. Handles macOS /var → /private/var even when intermediate dirs
  // are about to be created (e.g. mkdir -p sub/dir/file.txt).
  const normalized = normalize(absolute)
  let cursor = dirname(normalized)
  const suffix: string[] = [basename(normalized)]

  while (cursor !== dirname(cursor)) {
    try {
      const cursorReal = await realpath(cursor)
      return join(cursorReal, ...suffix.reverse())
    } catch (ancestorErr: unknown) {
      if (isErrno(ancestorErr, 'ENOENT')) {
        suffix.push(basename(cursor))
        cursor = dirname(cursor)
        continue
      }

      throw new ToolError('path_escape', `path resolution failed: ${requestedPath}`, ancestorErr)
    }
  }

  // No ancestor exists — fall back to the lexically-normalized path; the caller's
  // workspace prefix check still catches escapes.
  return normalized
}

function assertNoNul(requestedPath: string): void {
  // NUL bytes truncate on some platforms and throw on others — reject explicitly.
  if (requestedPath.includes('\x00')) {
    throw new ToolError('invalid_input', 'path contains NUL byte')
  }
}

function assertNotDevicePath(realPath: string): void {
  if (BLOCKED_DEVICE_PATHS.has(realPath) || BLOCKED_PROC_FD_RE.test(realPath)) {
    throw new ToolError('invalid_input', `cannot read device path: ${realPath}`)
  }
}

function assertNotSensitivePath(realPath: string): void {
  if (isSensitivePath(realPath)) {
    throw new ToolError('invalid_input', `sensitive path is not accessible: ${realPath}`)
  }
}

function isSensitivePath(realPath: string): boolean {
  if (BLOCKED_ABSOLUTE_PATHS.has(realPath)) {
    return true
  }

  // A case-insensitive FS (macOS APFS) or a backslash-separated Windows realpath would otherwise
  // slip past the POSIX-style suffixes.
  const lower = realPath.toLowerCase().replace(BACKSLASH_RE, '/')

  if (ENV_FILE_BASENAME_RE.test(basename(lower))) {
    return true
  }

  for (const suffix of BLOCKED_PATH_SUFFIXES) {
    if (lower.endsWith(`/${suffix}`) || lower.includes(`/${suffix}/`)) {
      return true
    }
  }

  return false
}

function assertNotProtectedFile(realPath: string): void {
  const base = basename(realPath)

  if (PROTECTED_FILE_NAMES.has(base.toUpperCase())) {
    throw new ToolError('invalid_input', `cannot write ${base} - reserved for operator`)
  }
}
