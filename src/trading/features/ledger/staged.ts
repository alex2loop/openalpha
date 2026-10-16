import type { SessionId } from '@/core/ids'
import type { FillSource, LedgerTxnDraft } from '@/trading/features/ledger/types'
import { ttlCache } from '@/core/utils/collections'

/** A previewed row waiting for `/record confirm`: the resolved draft, where its figures came from,
 *  and the request id it is written under, so a repeated confirm books it once. */
interface StagedRecord {
  readonly draft: LedgerTxnDraft
  readonly fillSource: FillSource
  readonly requestId: string
}

export interface StagedRecords {
  /** Holds a row for this session, replacing any it held. */
  stage(sessionId: SessionId, record: StagedRecord): void
  peek(sessionId: SessionId): StagedRecord | undefined
  /** Drops the session's held row; true when there was one. */
  discard(sessionId: SessionId): boolean
}

export function createStagedRecords(policy: {
  readonly ttlMs: number
  readonly max: number
}): StagedRecords {
  const staged = ttlCache<SessionId, StagedRecord>(policy.ttlMs, policy.max)

  return {
    stage: (sessionId, record) => staged.set(sessionId, record),
    peek: (sessionId) => staged.get(sessionId),
    discard(sessionId) {
      const held = staged.get(sessionId) !== undefined

      staged.delete(sessionId)

      return held
    },
  }
}
