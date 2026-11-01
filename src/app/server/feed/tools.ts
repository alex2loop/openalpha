import type { FeedDeps } from '@/app/server/feed/relay'
import { relay } from '@/app/server/feed/relay'

/** Tells the page when a tool call starts and ends, so it can show who is working where. A call
 *  that never reached its tool has an end and no start. */
export function followTools(deps: FeedDeps): (() => void)[] {
  return [relay(deps, 'tool_started'), relay(deps, 'tool_finished')]
}
