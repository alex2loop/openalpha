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

/** A live row as the store holds it: `expiresAt` is null for a row that never expires. */
export interface MemoryRow extends MemoryEntry {
  readonly expiresAt: number | null
}

/** One scope's live rows, newest first. */
export interface MemoryScopeEntries {
  readonly scope: MemoryScope
  readonly entries: readonly MemoryRow[]
}

export interface MemoryListOptions {
  readonly prefix?: string
  readonly limit: number
}

export interface Memory {
  store(scope: MemoryScope, key: string, entry: MemoryWrite): Promise<void>
  recall(scope: MemoryScope, key: string): Promise<MemoryEntry | null>
  list(scope: MemoryScope, options: MemoryListOptions): Promise<readonly MemoryEntry[]>
  /** Every scope's live rows in one read: the local user's scopes first, then by agent and user,
   *  at most `limit` rows in all. `now` is the epoch-ms instant a row must outlive. */
  listScopes(options: {
    readonly limit: number
    readonly now: number
  }): Promise<readonly MemoryScopeEntries[]>
  /** Returns the number of rows soft-deleted (0 when the key was absent). */
  remove(scope: MemoryScope, key: string): Promise<number>
  search(
    scope: MemoryScope,
    query: string,
    limit: number,
    keyPrefix?: string
  ): Promise<readonly FtsHit[]>
}
