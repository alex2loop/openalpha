import type { WireEvent } from '@/app/server/wire/events'
import type { EventBus } from '@/core/events'
import type { Locale } from '@/core/types/locale'
import '@/app/events'
import { WIRE_NORMALIZERS } from '@/app/server/ws/wire-events'

/** What every feed is given: the bus it follows, where its events go, and the language of the
 *  words it writes (a feed that writes none ignores it). */
export interface FeedDeps {
  readonly bus: EventBus
  readonly broadcast: (event: WireEvent) => void
  readonly locale: Locale
}

/** A plain relay: one bus topic becomes its wire event, unchanged. */
export function relay<K extends keyof typeof WIRE_NORMALIZERS>(
  { bus, broadcast }: FeedDeps,
  topic: K
): () => void {
  return bus.on(topic, (e) => {
    broadcast(WIRE_NORMALIZERS[topic](e))
  })
}
