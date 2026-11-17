import type { MessageKey } from '@/i18n'
import { tr } from '@/web/text/tr'

// The halt codes of `HaltCode` (core/errors.ts) that carry a line in the catalogs; the page cannot
// import the kernel. A code outside the table reads as the generic line.
const HALT_KEYS: Readonly<Record<string, MessageKey>> = Object.freeze({
  abort: 'errors.abort',
  budget: 'errors.budget',
  rate: 'errors.rate',
  llm_error: 'errors.llmError',
  turn_limit: 'errors.turnLimit',
  loop: 'errors.loop',
  length_limit: 'errors.lengthLimit',
  content_filter: 'errors.contentFilter',
  queue_full: 'errors.queueFull',
  session_busy: 'errors.sessionBusy',
  no_agents: 'halt.noAgents',
  hook_failed: 'halt.hookFailed',
  shutdown: 'halt.shutdown',
  agent_paused: 'ui.office.agent.pausedNote',
})

/** The line a run that halted without any reply is told by. */
export function haltTextOf(haltCode: string): string {
  return tr(HALT_KEYS[haltCode] ?? 'ui.office.error.generic')
}
