import type { DebateWire } from '@/app/server/wire/debate'
import type { DebateView } from '@/trading/api'
import { scrubCredentials } from '@/core/security/credentials'

/** Model prose passes through the credential scrub before it leaves the daemon. */
export function toDebateWire(view: DebateView): DebateWire {
  return {
    mode: view.mode,
    steps: view.steps,
    createdAt: view.createdAt,
    strategyVersion: view.strategyVersion,
    ...(view.evidenceThrough === undefined ? {} : { evidenceThrough: view.evidenceThrough }),
    roles: view.roles.map((role) => ({
      role: role.role,
      ...(role.verdict === undefined ? {} : { verdict: role.verdict }),
      summary: scrubCredentials(role.summary),
    })),
    claims: view.claims.map((claim) => ({ id: claim.id, text: scrubCredentials(claim.text) })),
    refutedIds: [...view.refutedIds],
    models: [...view.models],
  }
}
