import type { WireEvent } from '@/app/server/wire/events'
import type { EventBus } from '@/core/events'
import '@/app/events'
import { WIRE_NORMALIZERS } from '@/app/server/ws/wire-events'

interface AgentsFeedDeps {
  readonly bus: EventBus
  readonly broadcast: (event: WireEvent) => void
}

/** Tells the page a new agent joined the roster, the moment the create call finished. */
export function followAgents({ bus, broadcast }: AgentsFeedDeps): (() => void)[] {
  return [
    bus.on('agent_added', (e) => {
      broadcast(WIRE_NORMALIZERS.agent_added(e))
    }),
  ]
}
