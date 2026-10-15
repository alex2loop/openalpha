import type { AgentId, UserId } from '@/core/ids'
import type { FtsHit } from '@/core/types/storage'
export interface MemoryScope {
  readonly agentId: AgentId
  readonly userId: UserId
}

export type MemoryImportance = 'observation' | 'decision'

export interface MemoryWrite {
  readonly value: string
  /** `'decision'` never expires; `'observation'` (default) uses the configured TTL. */
  readonly importance?: MemoryImportance
}

export interface MemoryEntry {
  readonly key: string
  readonly value: string
  // Epoch-ms machine instant (two-tier time convention).
  readonly updatedAt: number
}

export interface MemoryListOptions {
  readonly prefix?: string
  readonly limit: number
}

export interface Memory {
  store(scope: MemoryScope, key: string, entry: MemoryWrite): Promise<void>
  recall(scope: MemoryScope, key: string): Promise<MemoryEntry | null>
  list(scope: MemoryScope, options: MemoryListOptions): Promise<readonly MemoryEntry[]>
  /** Returns the number of rows soft-deleted (0 when the key was absent). */
  remove(scope: MemoryScope, key: string): Promise<number>
  search(
    scope: MemoryScope,
    query: string,
    limit: number,
    keyPrefix?: string
  ): Promise<readonly FtsHit[]>
}
