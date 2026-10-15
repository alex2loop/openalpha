import { lstat } from 'node:fs/promises'
import { join } from 'node:path'

import type { AgentId } from '@/core/ids'
import type { PathRemovalResolver } from '@/core/security/path-policy'
import { ToolError } from '@/core/errors'
import { readDirectoryNames } from '@/core/fs'
import { WORKSPACES_DIR_NAME } from '@/engine/constants'

import type {
  WorkspaceAgentPlan,
  WorkspaceDirectoryCandidate,
  WorkspaceFileCandidate,
  WorkspaceFileIdentity,
  WorkspaceFixedArea,
} from './types'

const MAX_CLEANUP_ENTRIES = 10_000
const MAX_CLEANUP_DEPTH = 64

export interface ScanContext {
  readonly root: string
  readonly policy: PathRemovalResolver
  readonly cutoffAt: number | undefined
  readonly budget: { count: number }
}

interface ScanDirectory {
  readonly fullRel: string
  readonly subRel: string
  readonly depth: number
}

interface ScanState {
  readonly area: WorkspaceFixedArea
  readonly files: WorkspaceFileCandidate[]
  readonly directories: WorkspaceDirectoryCandidate[]
  readonly pending: ScanDirectory[]
  failures: number
}

export function resolveWorkspaceRoot(dataDir: string): string {
  return join(dataDir, WORKSPACES_DIR_NAME)
}

export async function listAgentDirectories(root: string): Promise<readonly string[] | undefined> {
  const result = await readDirectoryNames(root, MAX_CLEANUP_ENTRIES)

  if (result.kind === 'absent') {
    return undefined
  }

  if (result.kind === 'over-limit') {
    throw new ToolError('depth_limit', `workspace cleanup exceeds ${MAX_CLEANUP_ENTRIES} entries`)
  }

  return result.names
}

export async function resolveAgentDirectory(context: ScanContext, agentId: AgentId): Promise<void> {
  await context.policy.resolveDirectory(agentId)
}

export async function scanAgentWorkspace(
  context: ScanContext,
  agentId: AgentId,
  areas: readonly WorkspaceFixedArea[]
): Promise<WorkspaceAgentPlan> {
  const files: WorkspaceFileCandidate[] = []
  const directories: WorkspaceDirectoryCandidate[] = []
  let failures = 0

  for (const area of areas) {
    failures += await scanFixedArea({ context, agentId, area, files, directories })
  }

  return { agentId, files, directories, failures }
}

async function scanFixedArea(options: {
  readonly context: ScanContext
  readonly agentId: AgentId
  readonly area: WorkspaceFixedArea
  readonly files: WorkspaceFileCandidate[]
  readonly directories: WorkspaceDirectoryCandidate[]
}): Promise<number> {
  const { context, agentId, area, files, directories } = options
  const areaRel = `${agentId}/${area}`

  try {
    await context.policy.resolveDirectory(areaRel)
  } catch (err: unknown) {
    // Missing or non-directory areas are expected for agents that have not created them yet.
    // Workspace-root failures are re-thrown by the policy as path_escape.
    if (err instanceof ToolError && err.code === 'invalid_input') {
      return 0
    }

    throw err
  }

  consumeBudget(context.budget)

  const absolute = join(context.root, areaRel)
  const names = await readNamesBounded(absolute, MAX_CLEANUP_ENTRIES - context.budget.count)
  const state: ScanState = { area, files, directories, pending: [], failures: 0 }
  const root: ScanDirectory = { fullRel: areaRel, subRel: '', depth: 0 }

  for (const childName of names) {
    await inspectChild({ context, state, current: root, childName })
  }

  await drainPending(context, state)

  return state.failures
}

async function drainPending(context: ScanContext, state: ScanState): Promise<void> {
  while (state.pending.length > 0) {
    const current = state.pending.pop()

    if (current === undefined) {
      break
    }

    const currentAbsolute = join(context.root, current.fullRel)
    const remaining = MAX_CLEANUP_ENTRIES - context.budget.count

    try {
      const childNames = await readNamesBounded(currentAbsolute, remaining)

      for (const childName of childNames) {
        await inspectChild({ context, state, current, childName })
      }
    } catch (err: unknown) {
      if (err instanceof ToolError && (err.code === 'path_escape' || err.code === 'depth_limit')) {
        throw err
      }

      state.failures += 1
    }
  }
}

async function inspectChild(options: {
  readonly context: ScanContext
  readonly state: ScanState
  readonly current: ScanDirectory
  readonly childName: string
}): Promise<void> {
  const fullRel = join(options.current.fullRel, options.childName)
  const subRel =
    options.current.subRel === ''
      ? options.childName
      : join(options.current.subRel, options.childName)

  try {
    const info = await lstat(join(options.context.root, fullRel))

    consumeBudget(options.context.budget)

    if (info.isSymbolicLink()) {
      throw new ToolError('invalid_input', `symlink in workspace: ${fullRel}`)
    }

    if (info.isDirectory()) {
      const depth = options.current.depth + 1

      if (depth > MAX_CLEANUP_DEPTH) {
        throw new ToolError('depth_limit', `workspace cleanup exceeds depth limit: ${fullRel}`)
      }

      await options.context.policy.resolveDirectory(fullRel)
      options.state.directories.push({ area: options.state.area, rel: subRel, depth })
      options.state.pending.push({ fullRel, subRel, depth })

      return
    }

    if (!info.isFile()) {
      throw new ToolError('invalid_input', `non-file in workspace: ${fullRel}`)
    }

    await options.context.policy.resolveFile(fullRel)

    if (options.context.cutoffAt === undefined || info.mtimeMs < options.context.cutoffAt) {
      options.state.files.push({
        area: options.state.area,
        rel: subRel,
        bytes: info.size,
        identity: fileIdentity(info),
      })
    }
  } catch (err: unknown) {
    if (err instanceof ToolError && (err.code === 'path_escape' || err.code === 'depth_limit')) {
      throw err
    }

    options.state.failures += 1
  }
}

async function readNamesBounded(dirPath: string, remaining: number): Promise<readonly string[]> {
  if (remaining <= 0) {
    throw new ToolError('depth_limit', `workspace cleanup exceeds ${MAX_CLEANUP_ENTRIES} entries`)
  }

  const result = await readDirectoryNames(dirPath, remaining)

  if (result.kind === 'absent') {
    throw new ToolError('depth_limit', `workspace cleanup cannot read directory: ${dirPath}`)
  }

  if (result.kind === 'over-limit') {
    throw new ToolError('depth_limit', `workspace cleanup exceeds ${MAX_CLEANUP_ENTRIES} entries`)
  }

  return result.names
}

function consumeBudget(budget: { count: number }): void {
  if (budget.count >= MAX_CLEANUP_ENTRIES) {
    throw new ToolError('depth_limit', `workspace cleanup exceeds ${MAX_CLEANUP_ENTRIES} entries`)
  }

  budget.count += 1
}

function fileIdentity(info: {
  dev: number
  ino: number
  mtimeMs: number
  ctimeMs: number
}): WorkspaceFileIdentity {
  return { dev: info.dev, ino: info.ino, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs }
}
