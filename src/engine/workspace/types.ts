import type { AgentId } from '@/core/ids'
import type { WorkspaceIdentity } from '@/core/security/path-policy'

export type WorkspaceFixedArea = 'run' | 'tmp'

export type WorkspaceCleanupScope =
  | { readonly kind: 'agent'; readonly agentId: AgentId }
  | { readonly kind: 'all' }

export interface WorkspaceFileIdentity {
  readonly dev: number
  readonly ino: number
  readonly mtimeMs: number
  readonly ctimeMs: number
}

export interface WorkspaceFileCandidate {
  readonly area: WorkspaceFixedArea
  readonly rel: string
  readonly bytes: number
  readonly identity: WorkspaceFileIdentity
}

export interface WorkspaceDirectoryCandidate {
  readonly area: WorkspaceFixedArea
  readonly rel: string
  readonly depth: number
}

export interface WorkspaceAgentPlan {
  readonly agentId: AgentId
  readonly files: readonly WorkspaceFileCandidate[]
  readonly directories: readonly WorkspaceDirectoryCandidate[]
  readonly failures: number
}

export interface WorkspaceCleanupPlan {
  readonly root: WorkspaceIdentity | undefined
  readonly cutoffAt: number | undefined
  readonly agents: ReadonlyMap<AgentId, WorkspaceAgentPlan>
  readonly failures: number
}

export interface WorkspaceCleanupAgentResult {
  readonly removedFiles: number
  readonly removedBytes: number
  readonly failures: number
}

export interface WorkspaceCleanupResult {
  readonly agents: ReadonlyMap<AgentId, WorkspaceCleanupAgentResult>
}
