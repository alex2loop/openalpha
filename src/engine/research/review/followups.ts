import type { ResearchReview, ResearchReviewIssue, ReviewRoundWarning } from '../contracts'
import type { AdmittedEvidence, ClaimId } from '../evidence/model'
import type { ResearchEvidenceBranch, ResearchQuestion } from '../evidence/schemas'

const MIN_REVIEW_DIMENSION = 0.4
const REVIEW_DIMENSION_COUNT = 6

export interface PreparedReviewFollowup {
  readonly question: ResearchQuestion
  readonly issue: ResearchReviewIssue
}

interface PreparedReviewFollowups {
  readonly followups: readonly PreparedReviewFollowup[]
  readonly warnings: readonly ReviewRoundWarning[]
}

interface PrepareReviewFollowupsInput {
  readonly questions: readonly ResearchQuestion[]
  readonly issues: readonly ResearchReviewIssue[]
  readonly evidence: AdmittedEvidence
  readonly maxQuestions: number
  readonly completedReviewIndex: number
}

type ReviewFollowupScreen =
  | { readonly kind: 'query'; readonly query: string }
  | { readonly kind: 'warning'; readonly warning: ReviewRoundWarning }

interface ScreenReviewFollowupInput {
  readonly issue: ResearchReviewIssue
  readonly questionsById: ReadonlyMap<string, ResearchQuestion>
  readonly claimIds: ReadonlySet<ClaimId>
  readonly maxQuestions: number
  readonly questionCount: number
}

export function computeReviewVerdict(
  review: ResearchReview,
  threshold: number
): 'approve' | 'revise' {
  const scores = Object.values(review.scores)
  const allFinite = scores.every(Number.isFinite)
  const everyDimensionPasses = scores.every((score) => score >= MIN_REVIEW_DIMENSION)
  const composite = scores.reduce((sum, score) => sum + score, 0) / REVIEW_DIMENSION_COUNT

  return review.verdict === 'approve' &&
    allFinite &&
    everyDimensionPasses &&
    composite >= threshold &&
    review.unsupportedClaimIds.length === 0 &&
    review.issues.length === 0
    ? 'approve'
    : 'revise'
}

export function prepareReviewFollowups(
  input: PrepareReviewFollowupsInput
): PreparedReviewFollowups {
  const questionsById = new Map(input.questions.map((question) => [question.id, question]))
  const claimIds = new Set(input.evidence.claims.map((claim) => claim.id))
  const occupiedIds = new Set(questionsById.keys())
  const followups: PreparedReviewFollowup[] = []
  const warnings: ReviewRoundWarning[] = []

  for (const [index, issue] of input.issues.entries()) {
    if (!issue.requiresResearch) {
      continue
    }

    const screened = screenReviewFollowup({
      issue,
      questionsById,
      claimIds,
      maxQuestions: input.maxQuestions,
      questionCount: followups.length,
    })
    if (screened.kind === 'warning') {
      warnings.push(screened.warning)
      continue
    }

    const original = issue.questionIds
      .map((questionId) => questionsById.get(questionId))
      .find((candidate) => candidate !== undefined)
    const preferredSourceKinds =
      issue.sourceGuidance !== undefined && issue.sourceGuidance.length > 0
        ? issue.sourceGuidance
        : (original?.preferredSourceKinds ?? ['primary'])
    const question = {
      id: nextReviewQuestionId(input.completedReviewIndex, index, occupiedIds),
      question: screened.query,
      objective: issue.description,
      searchTerms: [screened.query],
      preferredSourceKinds,
    }

    occupiedIds.add(question.id)
    followups.push({ question, issue })
  }

  return { followups, warnings }
}

export function selectNewBranches(
  existingBranches: readonly ResearchEvidenceBranch[],
  candidates: readonly ResearchEvidenceBranch[]
): {
  readonly branches: readonly ResearchEvidenceBranch[]
  readonly duplicateWarnings: readonly ReviewRoundWarning[]
} {
  const seen = new Set(existingBranches.map(branchSignature))
  const branches: ResearchEvidenceBranch[] = []
  const duplicateWarnings: ReviewRoundWarning[] = []

  for (const branch of candidates) {
    const signature = branchSignature(branch)

    if (seen.has(signature)) {
      duplicateWarnings.push({ kind: 'duplicate_candidate', questionId: branch.questionId })
      continue
    }

    seen.add(signature)
    branches.push(branch)
  }

  return { branches, duplicateWarnings }
}

function screenReviewFollowup(input: ScreenReviewFollowupInput): ReviewFollowupScreen {
  const { issue } = input
  const unresolved = [
    ...issue.claimIds
      .filter((claimId) => !input.claimIds.has(claimId))
      .map((claimId) => `claim:${claimId}`),
    ...issue.questionIds
      .filter((questionId) => !input.questionsById.has(questionId))
      .map((questionId) => `question:${questionId}`),
  ]
  const query = issue.followUpQuery

  if (unresolved.length > 0) {
    return { kind: 'warning', warning: { kind: 'unresolved_reference', values: unresolved } }
  }
  if (query === undefined || query.trim() === '') {
    return { kind: 'warning', warning: { kind: 'empty_followup' } }
  }
  if (input.questionCount >= input.maxQuestions) {
    return { kind: 'warning', warning: { kind: 'followup_bound', values: [query] } }
  }
  return { kind: 'query', query }
}

function nextReviewQuestionId(
  completedReviewIndex: number,
  issueIndex: number,
  occupiedIds: ReadonlySet<string>
): string {
  const base = `review-${completedReviewIndex + 1}-${issueIndex + 1}`
  let candidate = base
  let suffix = 2

  while (occupiedIds.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }

  return candidate
}

function branchSignature(branch: ResearchEvidenceBranch): string {
  return JSON.stringify(branch)
}
