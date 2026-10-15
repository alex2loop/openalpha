import type { TradingHost, TradingHostDeps } from '@/trading/wiring/host/types'
import { renderAgentRecordLines } from '@/trading/features/suggestion/track-record/render-focus'
import { scoped } from '@/trading/wiring/host/scope'

export type AgentMethods = Pick<TradingHost, 'listAgentRecords'>

/** What each of the operator's agents has earned and how it sits beside the others, with the lines a
 *  terminal prints for it. One read per listing, however many agents it names. */
export function agentMethods(deps: TradingHostDeps): AgentMethods {
  return {
    listAgentRecords: (request) =>
      scoped(deps, request.signal, async (scope) => {
        const views = await deps.services.suggestions.agentRecords({
          agents: request.agents,
          signal: scope.signal,
        })

        return views.map((view) => ({
          ...view,
          lines: renderAgentRecordLines(request.locale, view),
        }))
      }),
  }
}
