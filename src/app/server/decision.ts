import type { Decision } from '@/app/server/wire/chat'
import type { ApprovalDecision } from '@/engine/api'

// The wire vocabulary is the user's ("approve this once", "always allow"); the engine's is the
// gate's. They are frozen independently, so the two are mapped here rather than renamed on either side.
export const ENGINE_DECISION: Readonly<Record<Decision, ApprovalDecision>> = Object.freeze({
  approve: 'once',
  deny: 'deny',
  always: 'remember',
})

export const WIRE_DECISION: Readonly<Record<ApprovalDecision, Decision>> = Object.freeze({
  once: 'approve',
  deny: 'deny',
  remember: 'always',
})
