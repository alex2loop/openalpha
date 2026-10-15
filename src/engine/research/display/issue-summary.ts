import type { DisplayText } from '@/core/stream-events'

import type { ResearchIssueGroup, ResearchIssueKind, ResearchIssueSummary } from '../events'
import type {
  EvidenceConflict,
  EvidenceGap,
  EvidenceGapCode,
  ValidationGapReason,
} from '../evidence/gaps'
import type { ResearchArtifact } from '../evidence/model'
import { ValidationGapReasonSchema } from '../evidence/gaps'
import {
  RESEARCH_CONFLICT_DISPLAY_KEYS,
  RESEARCH_NUMERIC_CONFLICT_REASON_KEYS,
  toResearchGapDisplay,
} from './progress'

const RESEARCH_ISSUE_KINDS = ['evidence', 'run'] as const satisfies readonly ResearchIssueKind[]

const ISSUE_GROUP_SUMMARY_KEYS = {
  evidence: 'progress.researchEvidenceLimits',
  run: 'progress.researchRunProblems',
} as const satisfies Record<ResearchIssueKind, string>

// Rendering a correct refusal beside a stage failure makes the refusal read as a bug, so every gap
// declares which of the two it is. `validation` is the default for a reason the table below misses.
const RESEARCH_GAP_ISSUE_KINDS = {
  missing_support: 'evidence',
  freshness_out_of_window: 'evidence',
  freshness_uncertain: 'evidence',
  numeric_mismatch: 'evidence',
  unsafe_content: 'evidence',
  provider_unavailable: 'run',
  content_limit: 'run',
  artifact_limit: 'run',
  unresolved_reference: 'run',
  duplicate_reference: 'run',
  truncation: 'run',
  validation: 'run',
  synthesis_recovery: 'run',
  review_incomplete: 'run',
  revision_incomplete: 'run',
  review_revision_required: 'evidence',
  semantic_unsupported: 'evidence',
  unverified_claim: 'evidence',
  answer_claim_absent: 'evidence',
} as const satisfies Record<EvidenceGapCode, ResearchIssueKind>

const RESEARCH_VALIDATION_ISSUE_KINDS = {
  source_url_not_canonical: 'evidence',
  source_not_retrieved: 'evidence',
  source_content_empty: 'evidence',
  quote_not_in_content: 'evidence',
  quote_reanchored: 'evidence',
  numeric_fields_absent: 'evidence',
  numeric_source_undated: 'evidence',
  numeric_value_not_in_quotes: 'evidence',
  duplicate_subquery: 'run',
  unresolved_full_content: 'run',
  followup_missing_query: 'run',
  followup_unknown_reference: 'run',
  followup_bound: 'run',
  followup_duplicate: 'run',
  coverage_unchanged: 'run',
  question_failed: 'run',
  // The searches ran and returned; what came back was thin. That is the evidence, not a stage.
  low_recall: 'evidence',
} as const satisfies Record<ValidationGapReason, ResearchIssueKind>

export function toResearchIssueSummaries(
  evidence: Pick<ResearchArtifact, 'gaps' | 'conflicts'>
): readonly ResearchIssueSummary[] {
  const groups = new Map<string, ResearchIssueSummary>()

  for (const gap of evidence.gaps) {
    addResearchIssue(groups, gapGroupKey(gap), {
      display: toResearchGapDisplay(gap),
      kind: toResearchIssueKind(gap),
    })
  }
  // Sources disagreeing about a fact is a property of the evidence, never a stage misbehaving.
  for (const conflict of evidence.conflicts) {
    addResearchIssue(groups, conflictGroupKey(conflict), {
      display: toResearchConflictDisplay(conflict),
      kind: 'evidence',
    })
  }
  return [...groups.values()]
}

// Both surfaces render the same two blocks, so the split and its headers live here rather than in
// each renderer. Empty groups are dropped: a run with no stage failure must not print an empty one.
export function toResearchIssueGroups(
  issues: readonly ResearchIssueSummary[]
): readonly ResearchIssueGroup[] {
  return RESEARCH_ISSUE_KINDS.flatMap((kind) => {
    const group = issues.filter((issue) => issue.kind === kind)
    if (group.length === 0) {
      return []
    }

    const count = group.reduce((total, issue) => total + issue.count, 0)

    return [
      { kind, summary: { key: ISSUE_GROUP_SUMMARY_KEYS[kind], params: { count } }, issues: group },
    ]
  })
}

function toResearchIssueKind(gap: EvidenceGap): ResearchIssueKind {
  if (gap.code === 'validation') {
    const parsed = ValidationGapReasonSchema.safeParse(gap.params?.reason)
    if (parsed.success) {
      return RESEARCH_VALIDATION_ISSUE_KINDS[parsed.data]
    }
  }
  return RESEARCH_GAP_ISSUE_KINDS[gap.code]
}

function toResearchConflictDisplay(conflict: EvidenceConflict): DisplayText {
  const key = RESEARCH_CONFLICT_DISPLAY_KEYS[conflict.code]

  if (conflict.code === 'numeric_mismatch') {
    return {
      key,
      params: { reason: { key: RESEARCH_NUMERIC_CONFLICT_REASON_KEYS[conflict.params.reason] } },
    }
  }
  return { key }
}

function gapGroupKey(gap: EvidenceGap): string {
  return `gap:${gap.code}:${gap.params?.reason ?? ''}`
}

function conflictGroupKey(conflict: EvidenceConflict): string {
  const reason = conflict.code === 'numeric_mismatch' ? conflict.params.reason : ''
  return `conflict:${conflict.code}:${reason}`
}

function addResearchIssue(
  groups: Map<string, ResearchIssueSummary>,
  key: string,
  issue: Omit<ResearchIssueSummary, 'count'>
): void {
  const existing = groups.get(key)
  groups.set(key, { ...(existing ?? issue), count: (existing?.count ?? 0) + 1 })
}
