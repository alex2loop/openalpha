import { lstat, rmdir, unlink } from 'node:fs/promises'

import type { AgentId } from '@/core/ids'
import type { PathRemovalResolver } from '@/core/security/path-policy'
import { ToolError } from '@/core/errors'
import { agentId as brandAgentId, isPathId } from '@/core/ids'
import { PathPolicy } from '@/core/security/path-policy'

import type {
  WorkspaceAgentPlan,
  WorkspaceCleanupAgentResult,
  WorkspaceCleanupPlan,
  WorkspaceCleanupResult,
  WorkspaceCleanupScope,
  WorkspaceDirectoryCandidate,
  WorkspaceFileCandidate,
  WorkspaceFixedArea,
} from './types'
import {
  listAgentDirectories,
  resolveAgentDirectory,
  resolveWorkspaceRoot,
  type ScanContext,
  scanAgentWorkspace,
} from './scan'

interface WorkspaceCleanupRequest {
  readonly dataDir: string
  readonly scope: WorkspaceCleanupScope
  readonly cutoffAt: number | undefined
}

export async function planWorkspaceScratchCleanup(
  request: WorkspaceCleanupRequest
): Promise<WorkspaceCleanupPlan> {
  return planWorkspaceScratchCleanupInternal({ ...request, areas: ['run', 'tmp'] })
}

export async function applyWorkspaceScratchCleanup(
  plan: WorkspaceCleanupPlan
): Promise<WorkspaceCleanupResult> {
  if (plan.root === undefined || plan.agents.size === 0) {
    return { agents: new Map() }
  }

  const policy = PathPolicy.forRemoval(plan.root)
  const results = new Map<AgentId, WorkspaceCleanupAgentResult>()

  for (const [agentId, agentPlan] of plan.agents) {
    results.set(
      agentId,
      await applyAgentCleanup({ policy, agentId, plan: agentPlan, cutoffAt: plan.cutoffAt })
    )
  }

  return { agents: results }
}

export async function pruneExpiredWorkspaceTmp(input: {
  readonly dataDir: string
  readonly cutoffAt: number
}): Promise<WorkspaceCleanupResult> {
  const plan = await planWorkspaceScratchCleanupInternal({
    dataDir: input.dataDir,
    scope: { kind: 'all' },
    cutoffAt: input.cutoffAt,
    areas: ['tmp'],
  })

  return applyWorkspaceScratchCleanup(plan)
}

interface InternalRequest extends WorkspaceCleanupRequest {
  readonly areas: readonly WorkspaceFixedArea[]
}

async function planWorkspaceScratchCleanupInternal(
  request: InternalRequest
): Promise<WorkspaceCleanupPlan> {
  const root = resolveWorkspaceRoot(request.dataDir)

  if (request.scope.kind === 'agent') {
    return planAgentScope({ root, request })
  }

  return planAllScope({ root, request })
}

async function planAllScope(options: {
  readonly root: string
  readonly request: InternalRequest
}): Promise<WorkspaceCleanupPlan> {
  const { root, request } = options
  const budget = { count: 0 }
  const names = await listAgentDirectories(root)

  if (names === undefined) {
    return { root: undefined, cutoffAt: request.cutoffAt, agents: new Map(), failures: 0 }
  }

  const identity = await PathPolicy.identify(root)
  const policy = PathPolicy.forRemoval(identity)
  const context: ScanContext = {
    root,
    policy,
    cutoffAt: request.cutoffAt,
    budget,
  }
  const agents = new Map<AgentId, WorkspaceAgentPlan>()
  let failures = 0

  for (const name of names) {
    if (!isPathId(name)) {
      failures += 1
      continue
    }

    const id = brandAgentId(name)

    try {
      await resolveAgentDirectory(context, id)
      const plan = await scanAgentWorkspace(context, id, request.areas)
      agents.set(id, plan)
    } catch {
      // Workspace-root failures are re-thrown by the policy; everything else is an isolated agent failure.
      failures += 1
    }
  }

  return { root: identity, cutoffAt: request.cutoffAt, agents, failures }
}

async function planAgentScope(options: {
  readonly root: string
  readonly request: InternalRequest
}): Promise<WorkspaceCleanupPlan> {
  const { root, request } = options
  const scope = request.scope

  if (scope.kind !== 'agent') {
    throw new ToolError('invalid_input', 'expected agent scope')
  }

  const identity = await PathPolicy.identify(root)
  const policy = PathPolicy.forRemoval(identity)
  const context: ScanContext = {
    root,
    policy,
    cutoffAt: request.cutoffAt,
    budget: { count: 0 },
  }

  await resolveAgentDirectory(context, scope.agentId)
  const plan = await scanAgentWorkspace(context, scope.agentId, request.areas)

  return {
    root: identity,
    cutoffAt: request.cutoffAt,
    agents: new Map([[scope.agentId, plan]]),
    failures: 0,
  }
}

async function applyAgentCleanup(options: {
  readonly policy: PathRemovalResolver
  readonly agentId: AgentId
  readonly plan: WorkspaceAgentPlan
  readonly cutoffAt: number | undefined
}): Promise<WorkspaceCleanupAgentResult> {
  const { policy, agentId, plan, cutoffAt } = options
  let removedFiles = 0
  let removedBytes = 0
  let failures = plan.failures

  for (const file of plan.files) {
    try {
      removedBytes += await deleteFile({ policy, agentId, file, cutoffAt })
      removedFiles += 1
    } catch {
      // Isolated deletion failure: the entry was already ineligible or removed under us.
      failures += 1
    }
  }

  const deepestFirst = [...plan.directories].sort((left, right) => right.depth - left.depth)

  for (const directory of deepestFirst) {
    try {
      await deleteDirectory(policy, agentId, directory)
    } catch {
      // Isolated directory removal failure; continue with siblings.
      failures += 1
    }
  }

  return { removedFiles, removedBytes, failures }
}

async function deleteFile(options: {
  readonly policy: PathRemovalResolver
  readonly agentId: AgentId
  readonly file: WorkspaceFileCandidate
  readonly cutoffAt: number | undefined
}): Promise<number> {
  const { policy, agentId, file, cutoffAt } = options
  const rel = fullRel(agentId, file.area, file.rel)
  const path = await policy.resolveFile(rel)
  const info = await lstat(path)

  if (info.isSymbolicLink() || !info.isFile()) {
    throw new ToolError('invalid_input', `removal target type changed: ${rel}`)
  }

  if (cutoffAt !== undefined && info.mtimeMs >= cutoffAt) {
    throw new ToolError('invalid_input', `removal target no longer meets cutoff: ${rel}`)
  }

  if (info.size !== file.bytes) {
    throw new ToolError('invalid_input', `removal target size changed: ${rel}`)
  }

  if (
    info.dev !== file.identity.dev ||
    info.ino !== file.identity.ino ||
    info.mtimeMs !== file.identity.mtimeMs ||
    info.ctimeMs !== file.identity.ctimeMs
  ) {
    throw new ToolError('invalid_input', `removal target changed after scan: ${rel}`)
  }

  await unlink(path)
  return info.size
}

async function deleteDirectory(
  policy: PathRemovalResolver,
  agentId: AgentId,
  directory: WorkspaceDirectoryCandidate
): Promise<void> {
  const rel = fullRel(agentId, directory.area, directory.rel)
  const path = await policy.resolveDirectory(rel)
  const info = await lstat(path)

  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new ToolError('invalid_input', `removal target type changed: ${rel}`)
  }

  await rmdir(path)
}

function fullRel(agentId: AgentId, area: WorkspaceFixedArea, rel: string): string {
  return rel === '' ? `${agentId}/${area}` : `${agentId}/${area}/${rel}`
}
