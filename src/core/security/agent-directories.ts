import type { FileHandle } from 'node:fs/promises'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'

import type { AgentId } from '@/core/ids'
import type { WorkspaceIdentity } from '@/core/security/path-policy'
import { ConfigError } from '@/core/errors'
import { AGENT_LOG_FILE_NAME, AGENT_LOG_SEGMENTS } from '@/core/logging/paths'
import { ensurePrivateDirectory } from '@/core/security/private-files'

const AGENT_WORKSPACES_SEGMENTS = ['workspaces'] as const
/** An approved shell's HOME inside its agent's workspace. */
export const AGENT_RUN_DIR_NAME = 'run'
const RUN_DIR_SEGMENTS = [AGENT_RUN_DIR_NAME, 'tmp'] as const

export async function prepareAgentScratchDir(
  dataDir: string,
  agentId: AgentId
): Promise<WorkspaceIdentity> {
  const workspace = await preparePrivateDirectory(dataDir, [...AGENT_WORKSPACES_SEGMENTS, agentId])

  try {
    for (const segment of RUN_DIR_SEGMENTS) {
      await preparePrivateChildDirectory(workspace.path, workspace, segment)
    }

    await assertDirectoryIdentity(workspace)
    return Object.freeze(workspace)
  } catch (err: unknown) {
    if (err instanceof ConfigError) {
      throw err
    }

    throw new ConfigError('cannot prepare private agent scratch directory', err)
  }
}

// Returns the path under the canonical prepared parent, which resolveAgentLogFile cannot do:
// that one is pure string math over an unverified dataDir.
export async function prepareAgentLogFile(dataDir: string, agentId: AgentId): Promise<string> {
  const parent = await preparePrivateDirectory(dataDir, [...AGENT_LOG_SEGMENTS, agentId])

  return join(parent.path, AGENT_LOG_FILE_NAME)
}

async function preparePrivateDirectory(
  dataDir: string,
  segments: readonly string[]
): Promise<WorkspaceIdentity> {
  try {
    const root = await openDirectoryIdentity(dataDir)
    let current = root

    for (const segment of segments) {
      current = await preparePrivateChildDirectory(root.path, current, segment)
    }

    return current
  } catch (err: unknown) {
    if (err instanceof ConfigError) {
      throw err
    }

    throw new ConfigError('cannot prepare private agent directory', err)
  }
}

async function preparePrivateChildDirectory(
  root: string,
  parent: WorkspaceIdentity,
  segment: string
): Promise<WorkspaceIdentity> {
  await assertDirectoryIdentity(parent)
  const child = join(parent.path, segment)

  await ensurePrivateDirectory(child)

  return openDirectoryIdentity(child, root)
}

async function openDirectoryIdentity(
  path: string,
  containmentRoot?: string
): Promise<WorkspaceIdentity> {
  let handle: FileHandle | undefined

  try {
    handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    const info = await handle.stat()

    if (!info.isDirectory()) {
      throw new ConfigError('agent path is not a directory')
    }

    const candidate = { path, dev: info.dev, ino: info.ino, containmentRoot }

    return await directoryIdentity(candidate)
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function directoryIdentity(options: {
  readonly path: string
  readonly dev: number
  readonly ino: number
  readonly containmentRoot: string | undefined
}): Promise<WorkspaceIdentity> {
  const canonical = await realpath(options.path)
  const pathInfo = await lstat(options.path)

  if (pathInfo.isSymbolicLink() || pathInfo.dev !== options.dev || pathInfo.ino !== options.ino) {
    throw new ConfigError('agent directory changed during preparation')
  }

  if (options.containmentRoot !== undefined) {
    assertContained(options.containmentRoot, canonical)
  }

  return { path: canonical, dev: options.dev, ino: options.ino }
}

async function assertDirectoryIdentity(identity: WorkspaceIdentity): Promise<void> {
  const [info, canonical] = await Promise.all([lstat(identity.path), realpath(identity.path)])

  if (
    info.isSymbolicLink() ||
    !info.isDirectory() ||
    info.dev !== identity.dev ||
    info.ino !== identity.ino ||
    canonical !== identity.path
  ) {
    throw new ConfigError('agent directory changed after preparation')
  }
}

function assertContained(root: string, candidate: string): void {
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    throw new ConfigError('agent path escapes the data directory')
  }
}
