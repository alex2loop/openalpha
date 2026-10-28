import type { PendingWire } from '@/app/server/wire/live'
import { sessionId, thread } from '@/web/state/chat'
import { APPROVAL_KIND, findRun, pending, pendingRequestId } from '@/web/state/live'
import { PendingCard } from '@/web/ui/bell/approval-card'

/** The approvals and questions of a run this chat started, answered as in the bell; one answer
 *  clears both, since both read the same store. */
export function ApprovalInline() {
  const session = sessionId.value
  const runIds = new Set(
    thread.value.flatMap((turn) => (turn.runId === undefined ? [] : [turn.runId]))
  )
  const entries = pending.value.filter((entry) => isOfThisChat(entry, session, runIds))

  return (
    <>
      {entries.map((entry) => (
        <PendingCard key={pendingRequestId(entry)} entry={entry} />
      ))}
    </>
  )
}

function isOfThisChat(
  entry: PendingWire,
  session: string | undefined,
  runIds: ReadonlySet<string>
): boolean {
  const runId = entry.kind === APPROVAL_KIND ? entry.event.runId : entry.runId

  if (runId !== undefined && runIds.has(runId)) {
    return true
  }

  if (entry.kind === 'question') {
    return session !== undefined && entry.sessionId === session
  }

  const entrySession = runId === undefined ? undefined : findRun(runId)?.sessionId

  return session !== undefined && entrySession === session
}
