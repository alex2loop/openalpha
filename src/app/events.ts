import type { OrderFill } from '@/trading/api'

declare module '@/core/events' {
  interface BusEventMap {
    /** A fill the book now holds, from `/trade` or a resting exit. */
    order_filled: OrderFill
  }
}
