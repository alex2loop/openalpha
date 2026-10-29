import type { WireEvent } from '@/app/server/wire/events'
import { isCommandRun, runs as liveRuns } from '@/web/state/live'

type WireEventKind = WireEvent['kind']
type WireEventHandler = (event: WireEvent) => void

// Keyed by the closed kind list plus `any`, so the map stays a handful of entries; each set holds
// only the handlers still subscribed.
const handlers = new Map<WireEventKind | 'any', Set<WireEventHandler>>()

/** The page's one event hub. The feed publishes every wire event once it has applied it to the
 *  store; `any` hears them all. The returned function unsubscribes. */
export function onWireEvent(kind: WireEventKind | 'any', handler: WireEventHandler): () => void {
  const subscribed = handlers.get(kind) ?? new Set()

  handlers.set(kind, subscribed)
  subscribed.add(handler)

  return () => {
    subscribed.delete(handler)
  }
}

/** Calls `handler` with how it ended each time a run of the slash command `name` (no slash) ends,
 *  one that began before the call included. The returned function unsubscribes. */
export function onCommandFinished(
  name: string,
  handler: (outcome: string | undefined) => void
): () => void {
  const runs = new Set(liveRuns.peek().flatMap((run) => (isCommandRun(run, name) ? run.runId : [])))
  const offs = [
    onWireEvent('run_started', ({ run, runId }) => {
      if (runId !== undefined && run !== undefined && isCommandRun(run, name)) {
        runs.add(runId)
      }
    }),
    onWireEvent('run_finished', ({ runId, outcome }) => {
      if (runId !== undefined && runs.delete(runId)) {
        handler(outcome)
      }
    }),
  ]

  return () => {
    for (const off of offs) {
      off()
    }
  }
}

export function publishWireEvent(event: WireEvent): void {
  notify(handlers.get(event.kind), event)
  notify(handlers.get('any'), event)
}

// A copy, so a handler that unsubscribes while it runs does not skip the next one.
function notify(subscribed: Set<WireEventHandler> | undefined, event: WireEvent): void {
  for (const handler of [...(subscribed ?? [])]) {
    try {
      handler(event)
    } catch {
      // One consumer's fault never stops the others; each owns its own failure line.
    }
  }
}
