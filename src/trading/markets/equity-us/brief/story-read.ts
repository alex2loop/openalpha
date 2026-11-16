import type { StoryRead } from '@/trading/kernel/operator/brief-story'
import type { BriefContext } from '@/trading/markets/brief-context'
import type { BreadthStoryInputs } from '@/trading/markets/brief-story'
import type { UsBoard } from '@/trading/markets/equity-us/board'
import { isAbortError } from '@/core/errors'
import { usBreadthAt } from '@/trading/markets/equity-us/breadth'
import { US_STORY_DETECTORS } from '@/trading/markets/equity-us/brief/story-detectors'
import { US_STORY_POLICY } from '@/trading/markets/equity-us/brief/story-policy'
import { latestSession } from '@/trading/markets/equity-us/overview'
import { US_CURRENCY } from '@/trading/markets/equity-us/policy'
import { usBoardProvenance } from '@/trading/markets/equity-us/raws'

const UNREAD: StoryRead = Object.freeze({ kind: 'unread' })

/** A throw costs the brief its story and nothing else; `features/brief` logs the `failed` arm. An
 *  abort is the caller's to see. */
export function tryReadUsStories(context: BriefContext<UsBoard>): StoryRead {
  try {
    return readUsStories(context)
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    return { kind: 'failed', err }
  }
}

/** A story follows the market's own board: without it, or without a breadth reading to gate on, no
 *  detector could have fired, so a quiet day would claim a reading that never happened. Both are
 *  `unread`, which prints nothing. */
function readUsStories(context: BriefContext<UsBoard>): StoryRead {
  const { board } = context
  const session = board === null ? undefined : latestSession(board)

  if (board === null || session === undefined) {
    return UNREAD
  }

  const breadth = usBreadthAt(board, session)
  const { aboveMa50Ratio } = breadth

  if (aboveMa50Ratio === undefined) {
    return UNREAD
  }

  const earlier = context.calendar.addTradingDays(session, -US_STORY_POLICY.breadthShiftSessions)
  const inputs: BreadthStoryInputs = {
    breadth: { ...breadth, aboveMa50Ratio },
    breadthBefore: usBreadthAt(board, earlier),
  }

  return {
    kind: 'read',
    session,
    currency: US_CURRENCY,
    candidates: US_STORY_DETECTORS.flatMap((detect) => detect(inputs) ?? []),
    provenance: usBoardProvenance(board.names),
  }
}
