import type { FeedDeps } from '@/app/server/feed/relay'
import { relay } from '@/app/server/feed/relay'

/** Tells the page a new agent joined the roster, the moment the create call finished. */
export function followAgents(deps: FeedDeps): (() => void)[] {
  return [relay(deps, 'agent_added')]
}
