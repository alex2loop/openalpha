import type { Capability, ToolCall } from '@/core/tool'
import type { RunView } from '@/engine/types/run'

export interface ToolEventTracker {
  /** The call passed admission and approval and is about to execute. */
  readonly started: () => void
  /** The call ended; after `started` it ran, before it the call never reached its tool. */
  readonly finished: (ok: boolean) => void
}

type ToolCallPhase = 'pending' | 'running' | 'finished'

// One tracker per call: `finished` is the sole emitter of the closing event, so a throw and the
// result recording that follows it cannot both report. A name with no registered tool (an unknown
// name, the engine's own search) has no capability to place it, so it reports nothing.
export function createToolEventTracker(run: RunView, call: ToolCall): ToolEventTracker {
  const capability: Capability | undefined = run.env.tools.find(
    (tool) => tool.name === call.name
  )?.capability
  let phase: ToolCallPhase = 'pending'

  return {
    started(): void {
      if (capability === undefined || phase !== 'pending') {
        return
      }

      phase = 'running'
      run.services.bus.emit('tool_started', {
        runId: run.identity.runId,
        agentId: run.identity.agentId,
        channel: run.identity.channel,
        callId: call.id,
        name: call.name,
        capability,
      })
    },
    finished(ok: boolean): void {
      if (capability === undefined || phase === 'finished') {
        return
      }

      const skipped = phase === 'pending'

      phase = 'finished'
      run.services.bus.emit('tool_finished', {
        runId: run.identity.runId,
        channel: run.identity.channel,
        callId: call.id,
        name: call.name,
        capability,
        ok,
        ...(skipped ? { skipped: true } : {}),
      })
    },
  }
}
