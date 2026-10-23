import type { EventBus } from '@/core/events'
import type { AfterRunHook } from '@/engine/types/run'

// Self-sufficient (bus only), so unlike the other factories in this directory it is wired in
// engine/services.ts rather than app/providers.ts.
export function createRunFinishedEmit(bus: EventBus): AfterRunHook {
  return async (run, result) => {
    bus.emit('run_finished', {
      runId: run.identity.runId,
      agentId: run.identity.agentId,
      sessionId: run.identity.sessionId,
      channel: run.identity.channel,
      ...(run.identity.chatId === undefined ? {} : { chatId: run.identity.chatId }),
      reason: result.reason,
      totals: result.totals,
    })
  }
}
