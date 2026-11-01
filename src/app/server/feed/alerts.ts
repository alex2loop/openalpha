import type { FeedDeps } from '@/app/server/feed/relay'
import '@/app/events'
import { WIRE_NORMALIZERS } from '@/app/server/ws/wire-events'

interface AlertsFeed {
  /** When the last alert pass finished, in epoch ms; undefined before the first one. */
  checkedAt(): number | undefined
  stop(): void
}

/** Tells the page each alert pass finished and keeps the last time for a client that connects late. */
export function createAlertsFeed({ bus, broadcast }: FeedDeps): AlertsFeed {
  let checkedAt: number | undefined
  const off = bus.on('alerts_checked', (e) => {
    checkedAt = e.at
    broadcast(WIRE_NORMALIZERS.alerts_checked(e))
  })

  return { checkedAt: () => checkedAt, stop: off }
}
