// Wired in app/providers.ts, NOT engine/services.ts — this factory needs persistence, which engine
// has no DAG edge to.

import type { EventBus } from '@/core/events'
import type { RunId, SessionId } from '@/core/ids'
import type { SessionMessageWrite } from '@/core/llm'
import type { RunResultReason } from '@/core/types/run'
import type { AfterRunHook, HookFn, RunView } from '@/engine/types/run'
import { formatErrForLog, scrubCredentials } from '@/core/security/credentials'

const SILENT_FAILURE_REASONS: ReadonlySet<RunResultReason> = new Set([
  'completed',
  'aborted',
  'timeout',
])

// Consumer-side interface: `persistence` implements it, `app` binds it.
export interface SessionSink {
  appendMessages(sessionId: SessionId, writes: readonly SessionMessageWrite[]): Promise<void>
  finalizeRun(
    sessionId: SessionId,
    runId: RunId,
    outcome: {
      readonly reason: RunResultReason
      readonly errorMessage?: string
    }
  ): Promise<void>
}

export interface SessionPersistenceHooks {
  readonly afterTurn: HookFn
  readonly afterRun: AfterRunHook
}

export function createSessionPersistenceHooks(
  sink: SessionSink,
  bus: EventBus
): SessionPersistenceHooks {
  return {
    // Persist each turn as it lands so a mid-run kill loses at most the turn in flight.
    afterTurn: async (run) => {
      if (run.env.persistence === 'ephemeral') {
        return
      }

      await flushNewMessages(sink, run)
    },

    afterRun: async (run, result) => {
      // A run refused at the claim never owned the row: nothing of its to flush or close.
      if (run.env.persistence === 'ephemeral' || result.haltCode === 'session_busy') {
        return
      }

      // Catch-up flush BEFORE finalizing: on throw the session stays "running" so a re-run
      // recovers, rather than finalizing with messages missing.
      await flushNewMessages(sink, run)

      if (run.env.callDepth > 0) {
        return
      }

      const errorMessage =
        result.errorMessage === undefined ? undefined : scrubCredentials(result.errorMessage)

      await sink.finalizeRun(run.identity.sessionId, run.identity.runId, {
        reason: result.reason,
        ...(errorMessage === undefined ? {} : { errorMessage }),
      })

      if (!SILENT_FAILURE_REASONS.has(result.reason)) {
        bus.emit('run_failed', {
          sessionId: run.identity.sessionId,
          agentId: run.identity.agentId,
          reason: result.reason,
          ...(errorMessage === undefined ? {} : { errorMessage }),
        })
      }
    },
  }
}

// The stored trail is an append-only audit record, not a mirror of live state. Rows queued in
// `unpersisted` survive compaction: when `history` shrinks, the queue still holds what the sink
// has not seen, so a mid-loop flush loses nothing and never re-writes a persisted row.
async function flushNewMessages(sink: SessionSink, run: RunView): Promise<void> {
  run.state.messages.flushPending()

  const writes = run.state.messages.takeUnpersisted()

  if (writes.length === 0) {
    return
  }

  try {
    await sink.appendMessages(run.identity.sessionId, writes)
  } catch (err: unknown) {
    run.state.messages.restoreUnpersisted(writes)
    run.services.logger.error('persistence.flush_failed', { err: formatErrForLog(err) })
    throw err
  }
}
