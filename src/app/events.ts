import type { OrderFill } from '@/trading/api'

declare module '@/core/events' {
  interface BusEventMap {
    /** A fill the book now holds, from `/trade` or a resting exit. */
    order_filled: OrderFill
    /** One alert pass finished: it read one cursor page, not the whole book. Epoch ms. */
    alerts_checked: { readonly at: number }
    /** A sentence the app files to the bell for itself (a restart finished, an agent deleted). It is
     *  never sent to a chat. Epoch ms. */
    daemon_notice: { readonly text: string; readonly at: number }
    /** The bell changed: a notice was written, or some were read. `unread` is the count after. */
    notices_changed: { readonly unread: number }
  }
}
