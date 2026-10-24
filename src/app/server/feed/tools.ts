import type { WireEvent } from '@/app/server/wire/events'
import type { EventBus } from '@/core/events'
import { WIRE_NORMALIZERS } from '@/app/server/ws/wire-events'

interface ToolsFeedDeps {
  readonly bus: EventBus
  readonly broadcast: (event: WireEvent) => void
}

/** Tells the page when a tool call starts and ends, so it can show who is working where. A call
 *  that never reached its tool has an end and no start. */
export function followTools({ bus, broadcast }: ToolsFeedDeps): (() => void)[] {
  return [
    bus.on('tool_started', (e) => {
      broadcast(WIRE_NORMALIZERS.tool_started(e))
    }),
    bus.on('tool_finished', (e) => {
      broadcast(WIRE_NORMALIZERS.tool_finished(e))
    }),
  ]
}
