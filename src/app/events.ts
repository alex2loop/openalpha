import type { RestartWhen } from '@/app/server/wire/vocab'
import type { AgentId } from '@/core/ids'
import type { Locale } from '@/core/types/locale'
import type { CallScoredPayload, OrderFill, RoleOutput } from '@/trading/api'

declare module '@/core/events' {
  interface BusEventMap {
    /** A fill the book now holds, from `/trade` or a resting exit. */
    order_filled: OrderFill
    /** One alert pass finished: it read one cursor page, not the whole book. Epoch ms. */
    alerts_checked: { readonly at: number }
    /** A sentence the app files to the bell for itself (a restart finished, an agent deleted). It is
     *  never sent to a chat. `kind` lets a page tell the ones it waits for from the rest. Epoch ms. */
    daemon_notice: {
      readonly text: string
      readonly at: number
      readonly kind?: 'restart-done' | 'restart-failed'
    }
    /** A restart request reached its end: the helper took over (`completed`), it was refused or the
     *  daemon began stopping first (`aborted`), or it failed (`error`). `requestedAt` is epoch ms. */
    restart_ended: {
      readonly when: RestartWhen
      readonly requestedAt: number
      readonly outcome: 'completed' | 'aborted' | 'error'
    }
    /** What one debate role said once the debate was verified. Shown on the operator's own page and
     *  never sent to a chat or a model. */
    role_output: RoleOutput
    /** A call an own agent made under its focus was just scored. Shown on the operator's own page
     *  and never sent to a chat or filed to the bell. */
    focus_call_scored: {
      readonly agentIds: readonly string[]
      readonly locale: Locale
      readonly payload: CallScoredPayload
    }
    /** An agent the operator just created is on the roster. `name` is what the operator called it. */
    agent_added: { readonly agentId: AgentId; readonly name: string }
    /** The bell changed: a notice was written, or some were read. `unread` is the count after. */
    notices_changed: { readonly unread: number }
  }
}
