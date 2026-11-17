import type { FeedDeps } from '@/app/server/feed/relay'
import { relay } from '@/app/server/feed/relay'

/** Tells the page the profile was written, from any surface, so it re-reads the list it shows. */
export function followProfile(deps: FeedDeps): (() => void)[] {
  return [relay(deps, 'profile_saved')]
}
