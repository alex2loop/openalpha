import type { WireEvent } from '@/app/server/wire/events'
import type { EventBus } from '@/core/events'
import '@/app/events'
import { WIRE_NORMALIZERS } from '@/app/server/ws/wire-events'

interface NoticesFeedDeps {
  readonly bus: EventBus
  readonly broadcast: (event: WireEvent) => void
}

/** Tells the page the app's own sentence the moment it is filed, and that the bell changed so it
 *  refetches. The notice log writes the rows; this only relays, so no row is broadcast twice. */
export function followNotices({ bus, broadcast }: NoticesFeedDeps): (() => void)[] {
  return [
    bus.on('daemon_notice', (e) => {
      broadcast(WIRE_NORMALIZERS.daemon_notice(e))
    }),
    bus.on('notices_changed', (e) => {
      broadcast(WIRE_NORMALIZERS.notices_changed(e))
    }),
  ]
}
