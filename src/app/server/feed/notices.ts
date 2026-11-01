import type { FeedDeps } from '@/app/server/feed/relay'
import { relay } from '@/app/server/feed/relay'

/** Tells the page the app's own sentence the moment it is filed, and that the bell changed so it
 *  refetches. The notice log writes the rows; this only relays, so no row is broadcast twice. */
export function followNotices(deps: FeedDeps): (() => void)[] {
  return [relay(deps, 'daemon_notice'), relay(deps, 'notices_changed')]
}
