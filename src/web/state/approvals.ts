import type { Decision, RespondBody } from '@/app/server/wire/chat'
import { approvalDecisionLabel, type MessageKey } from '@/i18n'
import { sendJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { locale } from '@/web/state/session'
import { tr } from '@/web/text/tr'

/** The wire's decision to the name the engine's label catalog takes. */
const DECISION_BY_WIRE = Object.freeze({
  approve: 'once',
  deny: 'deny',
  always: 'remember',
} satisfies Record<Decision, Parameters<typeof approvalDecisionLabel>[1]>)
// A chat button's label leads with a mark (✓, ✗, ★); the page's buttons carry none.
const LABEL_GLYPH_RE = /^[^\p{L}\p{N}]+/u
const ANSWER_ON_KEYS: Readonly<Record<string, MessageKey>> = Object.freeze({
  telegram: 'ui.answerOn.telegram',
  zalo: 'ui.answerOn.zalo',
  cli: 'ui.answerOn.cli',
})

/** The decision's label, as the CLI and the chats word it, less its leading mark. */
export function decisionLabel(decision: Decision): string {
  return approvalDecisionLabel(locale.value, DECISION_BY_WIRE[decision]).replace(LABEL_GLYPH_RE, '')
}

/** Throws `ApiFailure`: a `conflict` carries the daemon's sentence. The card stays until the
 *  daemon's `approval_resolved`, so every surface clears it together. */
export async function answerApproval(requestId: string, decision: Decision): Promise<void> {
  await sendJson('POST', ROUTES.respond, { body: { requestId, decision } satisfies RespondBody })
}

/** Where a request the page cannot answer is answered instead. */
export function answerOnLine(channelId: string): string {
  const key = Object.hasOwn(ANSWER_ON_KEYS, channelId) ? ANSWER_ON_KEYS[channelId] : undefined

  return key === undefined ? tr('ui.answerOn.other', { channel: channelId }) : tr(key)
}

/** Tells a run to stop; the page asks the operator first. Throws `ApiFailure`. The run leaves the
 *  store on its `run_finished`. */
export async function stopRun(runId: string): Promise<void> {
  await sendJson('POST', ROUTES.runStop(runId))
}
