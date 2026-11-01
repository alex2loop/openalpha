import type { FeedDeps } from '@/app/server/feed/relay'
import { relay } from '@/app/server/feed/relay'

/** Tells the page each preference a chat stored or dropped, so it can say so under that answer. */
export function followPreferences(deps: FeedDeps): (() => void)[] {
  return [relay(deps, 'preference_saved')]
}
