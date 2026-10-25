import type { FeedDeps } from '@/app/server/feed/relay'
import '@/app/events'
import { toCallScoredEvent } from '@/app/server/push/notice-event'
import { renderCallScoredNotice } from '@/trading/api'

/** Tells the page an own agent's focus call was scored, once per agent that called under that
 *  focus. The page only: the operator never asked for these in a chat or the bell. */
export function followFocusCalls({ bus, broadcast }: FeedDeps): (() => void)[] {
  return [
    bus.on('focus_call_scored', (e) => {
      const note = renderCallScoredNotice(e.locale, e.payload)

      for (const agentId of e.agentIds) {
        broadcast(toCallScoredEvent(e.payload, note, agentId))
      }
    }),
  ]
}
