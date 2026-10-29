import type { PendingWire, QuestionPendingWire } from '@/app/server/wire/live'
import type { EventBus } from '@/core/events'
import type { RunId } from '@/core/ids'
import type { Locale } from '@/core/types/locale'
import { isApiChannel } from '@/app/server/channel'
import { toApprovalWire } from '@/app/server/ws/wire-events'
import { scrubCredentials } from '@/core/security/credentials'
import { trimToSize } from '@/core/utils/collections'
import { MS_PER_DAY } from '@/core/utils/time'

/** Bounds the questions a client can ask about; the oldest go first. */
const MAX_PENDING_QUESTIONS = 50
/** A question has no deadline of its own: the operator answers when they next open the chat. */
const QUESTION_PENDING_TTL_MS = MS_PER_DAY

interface ApprovalEntry {
  readonly wire: Extract<PendingWire, { kind: 'approval' }>
  readonly channelId: string
  readonly runId: RunId
  readonly expiresAt: number
}

interface PendingFeed {
  /** The approvals and questions still waiting, on every channel: approvals first, each oldest first. */
  list(): readonly PendingWire[]
  /** The raw channel an approval was asked on; undefined for an id no longer waiting (answered,
   *  timed out, its run gone, or never asked). */
  originOf(requestId: string): string | undefined
  stop(): void
}

interface PendingFeedDeps {
  readonly bus: EventBus
  readonly locale: Locale
  /** The runs still running; an approval of a run that is gone can no longer be answered. */
  readonly liveRunIds: () => ReadonlySet<RunId>
}

/** Follows the approvals and questions of every channel on the bus. An approval leaves on its
 *  `approval_resolved` (the gate settles a timeout the same way), or when its run or deadline is gone;
 *  a question ends its run at once, so it leaves on the next agent run in its session, or after a day.
 *  Approvals are never evicted for count: each carries a deadline, so the map is bounded by the
 *  approvals pending at once, and an id it lacks is one that no longer waits. */
export function createPendingFeed(deps: PendingFeedDeps): PendingFeed {
  const approvals = new Map<string, ApprovalEntry>()
  const questions = new Map<string, QuestionPendingWire>()
  const offs = [
    ...followApprovals(deps, approvals, questions),
    ...followQuestions(deps, questions, approvals),
  ]

  return {
    list() {
      prune(approvals, questions, deps.liveRunIds())

      return [...[...approvals.values()].map((entry) => entry.wire), ...questions.values()]
    },
    originOf(requestId) {
      prune(approvals, questions, deps.liveRunIds())

      return approvals.get(requestId)?.channelId
    },
    stop() {
      for (const off of offs) {
        off()
      }

      approvals.clear()
      questions.clear()
    },
  }
}

function followApprovals(
  { bus, locale }: PendingFeedDeps,
  approvals: Map<string, ApprovalEntry>,
  questions: Map<string, QuestionPendingWire>
): (() => void)[] {
  return [
    bus.on('approval_requested', (e) => {
      prune(approvals, questions)
      approvals.set(e.requestId, {
        wire: { kind: 'approval', event: toApprovalWire(e, locale) },
        channelId: e.channel,
        runId: e.runId,
        expiresAt: e.expiresAt,
      })
    }),
    // The gate takes an answer only from the channel that asked, so any other channel's is no answer.
    bus.on('approval_resolved', (e) => {
      if (approvals.get(e.requestId)?.channelId === e.channel) {
        approvals.delete(e.requestId)
      }
    }),
  ]
}

function followQuestions(
  { bus }: PendingFeedDeps,
  questions: Map<string, QuestionPendingWire>,
  approvals: Map<string, ApprovalEntry>
): (() => void)[] {
  return [
    bus.on('clarification_requested', (e) => {
      prune(approvals, questions)
      questions.set(e.requestId, {
        kind: 'question',
        requestId: e.requestId,
        runId: e.runId,
        sessionId: e.sessionId,
        channelId: e.channel,
        question: scrubCredentials(e.question),
        askedAt: e.askedAt,
        answerable: isApiChannel(e.channel),
      })
      trimToSize(questions, MAX_PENDING_QUESTIONS)
    }),
    // The answer turn is an agent run in the question's session; a slash command typed in the same
    // chat starts a command, which answers nothing.
    bus.on('run_started', (e) => {
      for (const [requestId, question] of questions) {
        if (question.sessionId === e.sessionId) {
          questions.delete(requestId)
        }
      }
    }),
  ]
}

// Expiry is checked on insert and on read instead of by timers, so nothing here needs clearing. A
// read also drops the approvals of runs that are gone; an insert has no run to doubt.
function prune(
  approvals: Map<string, ApprovalEntry>,
  questions: Map<string, QuestionPendingWire>,
  running?: ReadonlySet<RunId>
): void {
  const now = Date.now()

  for (const [requestId, entry] of approvals) {
    if (entry.expiresAt <= now || (running !== undefined && !running.has(entry.runId))) {
      approvals.delete(requestId)
    }
  }

  for (const [requestId, question] of questions) {
    if (question.askedAt + QUESTION_PENDING_TTL_MS <= now) {
      questions.delete(requestId)
    }
  }
}
