import type { ResolvedResearch } from '@/core/config/resolve'
import type { RunId, SessionId } from '@/core/ids'
import type { Locale } from '@/core/types/locale'
import type { ExternalCharge } from '@/core/types/usage'

import type { GatherNeed, ResearchInvocation } from '../contracts'
import type { ResearchOperation } from '../events'
import type { ResearchFreshness, ResearchRetrievalAttempt } from '../evidence/model'
import type { ResearchRetrievedSource } from './material'
import type { ResearchRetrieval } from './retrieval'
import type { ResearchRetrievalState, ResearchSourceBinding } from './state'

export interface GatherGap {
  readonly code:
    | 'provider_unavailable'
    | 'content_limit'
    | 'freshness_out_of_window'
    | 'freshness_uncertain'
    | 'unsafe_content'
    | 'validation'
  readonly message: string
  readonly values: readonly string[]
  readonly params?: { readonly reason?: string }
}

export interface GatherResult {
  readonly sources: readonly ResearchRetrievedSource[]
  readonly gaps: readonly GatherGap[]
  readonly attempts: readonly ResearchRetrievalAttempt[]
  readonly need?: GatherNeed
}

export interface ResearchOperationReport {
  readonly operation: ResearchOperation
  readonly detail: string
  readonly pageCount?: number
}

export interface GatherInput {
  readonly query: string
  readonly queries?: readonly string[]
  readonly maxQueries?: number
  readonly locale: Locale
  /** The run's clock, so every candidate in a question is scored against the same instant. */
  readonly now: number
  readonly freshness?: ResearchFreshness
  readonly need?: GatherNeed
  readonly questionId?: string
  readonly retrieval: ResearchRetrieval
  readonly state: ResearchRetrievalState
  readonly config: ResolvedResearch
  readonly invocation: Pick<
    ResearchInvocation,
    'signal' | 'parent' | 'reportProgress' | 'allowedHosts'
  > & {
    readonly recordExternalCost: (charge: ExternalCharge) => Promise<void>
  }
  readonly observeAttempt?: (attempt: ResearchRetrievalAttempt) => void
  /** Called as each search or fetch starts, so the question line can show what is happening. */
  readonly reportOperation?: (report: ResearchOperationReport) => void
  readonly sourceBindings?: readonly ResearchSourceBinding[]
}

export interface GatherContext extends GatherInput {
  readonly attempts: ResearchRetrievalAttempt[]
  readonly gaps: GatherGap[]
  readonly cacheScope?: SessionId | RunId
}
