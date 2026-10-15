import type { ResearchPlan } from '../evidence/schemas'
import type { ResearchEffortProfile, ResearchObjective } from '../planning/profile'
import type { StageContext } from '../stages/funnel'
import { CALLS_PER_REVIEW_ROUND } from '../planning/profile'

export interface ApprovedResearchPlan {
  readonly plan: ResearchPlan
  readonly objective: ResearchObjective
  readonly effort: ResearchEffortProfile
}

// The plan can raise the run's effort (more review rounds) and adds a crawl per extra question;
// both are reserved here from the shared quota. A shortfall means a sibling took calls in between:
// rounds give way last and questions are trimmed, rather than the run failing after its spend.
export function fundPlan(ctx: StageContext, approved: ApprovedResearchPlan): ApprovedResearchPlan {
  const { quota } = ctx
  const reservedRounds = ctx.effort.reviewRoundLimit
  const extraRounds = Math.max(0, approved.effort.reviewRoundLimit - reservedRounds)
  const fundedRounds = Math.min(extraRounds, Math.floor(quota.spare() / CALLS_PER_REVIEW_ROUND))

  quota.reserveUpTo(fundedRounds * CALLS_PER_REVIEW_ROUND)

  const wanted = approved.plan.questions.length
  const funded = 1 + quota.reserveUpTo(wanted - 1)

  return {
    ...approved,
    plan:
      funded < wanted
        ? { ...approved.plan, questions: approved.plan.questions.slice(0, funded) }
        : approved.plan,
    effort: {
      ...approved.effort,
      reviewRoundLimit: Math.min(approved.effort.reviewRoundLimit, reservedRounds + fundedRounds),
    },
  }
}
