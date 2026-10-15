import type { IndexReviewKind } from '@/trading/kernel/market/market-data'
import type {
  IndexReviewProximity,
  IndexReviewSession,
} from '@/trading/markets/equity-vn/index-review'
import type { Stage, StageDecision, StageInput } from '@/trading/markets/stage'
import { orderSessionOf } from '@/trading/markets/calendar'
import { indexReviewProximity, nextIndexReview } from '@/trading/markets/equity-vn/index-review'
import { VN_MARKET_REF } from '@/trading/markets/equity-vn/policy'
import { STAGE_PASS } from '@/trading/markets/stage'

const INDEX_REVIEW_STAGE_ID = 'equity-vn-index-review'
const INDEX_REVIEW_STAGE_ORDER = 40

/** Passive money trades index constituents at the close of a review session and the move reverses
 *  in the sessions after. A buy that would fill on the session itself is refused; the eve and any
 *  hold carry the date so the operator reads the run into it for what it is. */
export function createVnIndexReviewStage(): Stage {
  return {
    id: INDEX_REVIEW_STAGE_ID,
    phase: 'risk',
    order: INDEX_REVIEW_STAGE_ORDER,
    evaluate: (input) => Promise.resolve(evaluate(input)),
  }
}

function evaluate(input: StageInput): StageDecision {
  const { suggestion, market } = input

  if (suggestion.instrument.market !== VN_MARKET_REF || suggestion.indexTier === undefined) {
    return STAGE_PASS
  }

  const calendar = market.manifest.calendar
  // The session an order placed now fills in, not the day the run is dated: an evening run's buy
  // fills on the next session, which is the one the review can fall on.
  const session = orderSessionOf(calendar, input.now)
  const proximity: IndexReviewProximity | undefined = indexReviewProximity(session, calendar)
  const next: IndexReviewSession | undefined = nextIndexReview(session, calendar)

  if (proximity === undefined || next === undefined) {
    return STAGE_PASS
  }

  const kind: IndexReviewKind = next.kind

  const caveats =
    proximity === 'session'
      ? [
          {
            code: 'market.index-review-session' as const,
            detail: { review: kind, day: next.day },
          },
        ]
      : [{ code: 'market.index-review-eve' as const, detail: { review: kind, day: next.day } }]

  return proximity === 'session' && suggestion.action === 'buy'
    ? { kind: 'block', reasonCode: 'index-review-session', caveats }
    : { kind: 'pass', caveats }
}
