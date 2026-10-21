import { escapeXml } from '@/core/security/sanitize'

// Single source of truth for the durable-preference taxonomy: the extraction prompt and the
// write-time validation both derive from it. A closed set keeps memory bounded and
// self-consolidating (one row per attribute). Chosen to complement the user profile
// (risk, horizon, goal, watchlist) and locale (language), not overlap them.
export const PREF_ATTRS = {
  style: 'investing philosophy (e.g. "trusts fundamentals over charts, dislikes day-trading")',
  constraints: 'hard personal rules (e.g. "never uses margin", "avoids crypto")',
  interests: 'sectors/themes/assets they follow (e.g. "banks, tech, gold")',
  context: 'durable personal context (e.g. "retired", "checks markets in the evening")',
  communication: 'how they want answers (e.g. "keep it brief", "explain jargon")',
} as const

export type PrefAttr = keyof typeof PREF_ATTRS

const WITHDRAWN_WORDING = '(withdrawn)'
export const VALUE_MAX_CHARS = 200

/** A proposal is pending until the reply that asks about it, then asked until the operator's next
 *  message answers it. */
export interface PrefState {
  readonly saved: ReadonlyMap<string, string>
  readonly pending: ReadonlyMap<string, string>
  readonly asked: ReadonlyMap<string, string>
}

export function buildSavedBlock(saved: ReadonlyMap<string, string>): string {
  return [
    '<user_preferences>',
    ...toPrefLines(saved),
    'These are saved from what the operator says and confirmed with them; never change them with a',
    'memory tool.',
    '</user_preferences>',
  ].join('\n')
}

export function buildPendingNote(
  saved: ReadonlyMap<string, string>,
  pending: ReadonlyMap<string, string>
): string {
  const changes = [...pending].map(
    ([attr, value]) =>
      `- ${escapeXml(attr)}: "${escapeXml(saved.get(attr) ?? '')}" -> ${proposedValueOf(value)}`
  )

  return [
    '<pending_preference_changes>',
    'Earlier in this conversation the operator said something that changes these saved preferences:',
    ...changes,
    'Before anything else in this reply, ask them in one short line whether to apply this change,',
    'then answer their message as usual. Their next message is read as the answer; do not save the',
    'change with a memory tool.',
    '</pending_preference_changes>',
  ].join('\n')
}

export function buildExtractPrompt(message: string, state: PrefState): string {
  const attrLines = Object.entries(PREF_ATTRS).map(([attr, hint]) => `- ${attr}: ${hint}`)
  const savedLines = state.saved.size === 0 ? ['(none)'] : toPrefLines(state.saved)

  return [
    'Extract DURABLE preferences the user states about how they invest or want to be advised.',
    'Return ONLY a JSON array of {"attribute","value"} objects, or [] if the message states none.',
    'attribute MUST be one of:',
    ...attrLines,
    `value: a short phrase (max ${VALUE_MAX_CHARS} chars), in the user's own terms.`,
    'Only EXPLICIT, durable preferences - never infer, never one-off opinions, predictions, or mood.',
    'Do NOT include risk level, horizon, goal, watchlist tickers, or language.',
    'Those belong to the investor profile. If unsure, omit.',
    '',
    'Already saved:',
    ...savedLines,
    'For an attribute already saved, return its full new value: the saved value with the change',
    'applied, keeping every part the message leaves standing. If the message withdraws all of it,',
    'return the attribute with value "". Omit attributes the message leaves as they are.',
    '',
    ...askedLines(state.asked),
    'Message:',
    `"""${message}"""`,
  ].join('\n')
}

/** The operator was just asked about these, so the message may be the answer. */
function askedLines(asked: ReadonlyMap<string, string>): readonly string[] {
  if (asked.size === 0) {
    return []
  }

  const proposals = [...asked].map(
    ([attr, value]) => `- ${escapeXml(attr)}: ${proposedValueOf(value)}`
  )

  return [
    'Proposed changes the operator was just asked to confirm:',
    ...proposals,
    'If the message agrees to one, return that attribute with exactly the proposed value ("" for',
    `${WITHDRAWN_WORDING}). If it declines or does not answer, omit it.`,
    '',
  ]
}

/** An empty proposed value is a withdrawal. */
function proposedValueOf(value: string): string {
  return value === '' ? WITHDRAWN_WORDING : `"${escapeXml(value)}"`
}

export function isPrefAttr(value: string): value is PrefAttr {
  return Object.hasOwn(PREF_ATTRS, value)
}

// Stored values already passed the canonical secret and injection policy, so only escaping is
// needed before interpolation.
function toPrefLines(prefs: ReadonlyMap<string, string>): readonly string[] {
  return [...prefs].map(([attr, value]) => `- ${escapeXml(attr)}: ${escapeXml(value)}`)
}
