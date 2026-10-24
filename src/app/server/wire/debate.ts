// How one stored suggestion was argued, read after the fact. Carries no cost: the page shows the
// debate, not its bill.

/** One role's stored line. Bull and bear argue a side and carry no `verdict`; `summary` is empty
 *  when the risk role wrote no note. */
interface DebateRoleWire {
  /** The role's agent id (`bull-researcher`, `portfolio-manager`, `market-analyst`, ...). */
  readonly role: string
  /** In the daemon's language, in the words the report's debate block uses. */
  readonly verdict?: string
  readonly summary: string
}

interface DebateClaimWire {
  readonly id: string
  readonly text: string
}

/** GET /v1/suggestions/:id/debate. */
export interface DebateWire {
  /** `full` runs six roles in three waves; `lean` runs one analyst and the claim check. */
  readonly mode: 'full' | 'lean'
  /** The roles the mode runs; the stored debate keeps no rounds. */
  readonly steps: number
  readonly createdAt: number
  readonly strategyVersion: string
  /** The last session the evidence covered, `YYYY-MM-DD`. */
  readonly evidenceThrough?: string
  readonly roles: readonly DebateRoleWire[]
  /** The material claims the call rests on, in the order to number them. A claim carries no side. */
  readonly claims: readonly DebateClaimWire[]
  /** The claim ids the fact check refuted. Empty on a call stored before they were kept. */
  readonly refutedIds: readonly string[]
  /** The models that argued it, sorted; empty on a call stored before they were kept. */
  readonly models: readonly string[]
}
