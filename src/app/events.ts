import type { AgentId } from '@/core/ids'
import type { OrderFill, RoleOutput } from '@/trading/api'

declare module '@/core/events' {
  interface BusEventMap {
    /** A fill the book now holds, from `/trade` or a resting exit. */
    order_filled: OrderFill
    /** One alert pass finished: it read one cursor page, not the whole book. Epoch ms. */
    alerts_checked: { readonly at: number }
    /** A sentence the app files to the bell for itself (a restart finished, an agent deleted). It is
     *  never sent to a chat. Epoch ms. */
    daemon_notice: { readonly text: string; readonly at: number }
    /** What one debate role said once the debate was verified. Shown on the operator's own page and
     *  never sent to a chat or a model. */
    role_output: RoleOutput
    /** An agent the operator just created is on the roster. `name` is what the operator called it. */
    agent_added: { readonly agentId: AgentId; readonly name: string }
    /** The bell changed: a notice was written, or some were read. `unread` is the count after. */
    notices_changed: { readonly unread: number }
  }
}
