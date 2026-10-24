import type { ResearchDepth } from '@/core/config/resolve'
import type { DisplayText, LocalizedMessageParam } from '@/core/stream-events'

import type { ResearchFailureCode, ResearchPhase } from './contracts'

/** Interpolated into the stage label, so it may nest no further. */
export type ResearchStageDetail = string | LocalizedMessageParam

/** `evidence`: a check fired and the report is thinner but sound. `run`: a stage or provider failed. */
export type ResearchIssueKind = 'evidence' | 'run'

export interface ResearchIssueSummary {
  readonly display: DisplayText
  readonly kind: ResearchIssueKind
  readonly count: number
}

export interface ResearchIssueGroup {
  readonly kind: ResearchIssueKind
  readonly summary: DisplayText
  readonly issues: readonly ResearchIssueSummary[]
}

export interface ResearchReviewFollowupProgress {
  readonly index: number
  readonly total: number
}

export type ResearchStageState = 'running' | 'complete' | 'failed'

export type ResearchOperation = 'search' | 'fetch'

export type ResearchWarningCode = 'fallback_started'

export type ResearchProgress =
  | {
      readonly key: 'progress.researchStart'
      readonly mode: 'persistent'
      readonly params: { readonly depth: ResearchDepth }
    }
  | {
      readonly key: 'progress.researchPlan'
      readonly mode: 'persistent'
      readonly params: { readonly questions: readonly string[] }
    }
  | {
      readonly key: 'progress.researchStage'
      readonly params: {
        readonly stage: ResearchPhase
        readonly state: ResearchStageState
        readonly detail?: ResearchStageDetail
      }
    }
  | {
      readonly key: 'progress.researchQuestion'
      readonly params: {
        readonly questionId: string
        readonly question: string
        readonly index: number
        readonly total: number
        readonly state: ResearchStageState
        readonly elapsedMs?: number
        readonly attempts?: number
        readonly extractedClaims?: number
        readonly candidateSources?: number
        readonly failureCode?: ResearchFailureCode
        readonly reviewFollowup?: ResearchReviewFollowupProgress
        readonly fallback?: true
        // Current-operation texture for a running question: what the crawler is doing right now.
        readonly operation?: ResearchOperation
        readonly detail?: string
        readonly pageCount?: number
      }
    }
  | {
      readonly key: 'progress.researchTotals'
      readonly mode: 'persistent'
      readonly params: {
        readonly queries: number
        readonly pagesRead: number
        readonly admittedSources: number
        readonly supportedClaims: number
        readonly issues: readonly ResearchIssueSummary[]
        readonly elapsedMs: number
        readonly outcome: DisplayText
        readonly evidenceLevel?: DisplayText
        readonly action?: DisplayText
      }
    }
  | {
      readonly key: 'progress.researchWarning'
      readonly params: {
        readonly code: ResearchWarningCode
        readonly values: Readonly<Record<string, string | number>>
      }
    }

// A record, not a list: a key added to `ResearchProgress` fails to compile until it is named here.
const RESEARCH_PROGRESS_KEYS: Readonly<Record<ResearchProgress['key'], true>> = {
  'progress.researchStart': true,
  'progress.researchPlan': true,
  'progress.researchStage': true,
  'progress.researchQuestion': true,
  'progress.researchTotals': true,
  'progress.researchWarning': true,
}

export function isResearchProgress(message: { readonly key: string }): message is ResearchProgress {
  return Object.hasOwn(RESEARCH_PROGRESS_KEYS, message.key)
}

export type ResearchTotalsProgress = Extract<
  ResearchProgress,
  { readonly key: 'progress.researchTotals' }
>['params']
