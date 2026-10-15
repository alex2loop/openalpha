import type { AgentId } from '@/core/ids'

export type SocialNetworkState = 'active' | 'paused'
/** Why a network is paused: the operator said so, or its pinned files no longer match their hashes. */
export type SocialPauseReason = 'operator' | 'pin-mismatch'
export type SocialMembershipState = 'active' | 'paused' | 'refused'
/** Why a request waits for the operator instead of going out. */
export type SocialDraftReason = 'dm' | 'delete' | 'outside-link' | 'review-all'

export interface SocialNetworkRow {
  readonly name: string
  readonly state: SocialNetworkState
  readonly pauseReason?: SocialPauseReason
  readonly addedAt: number
  readonly changedAt: number
}

export interface SocialMembershipRow {
  readonly agentId: AgentId
  readonly network: string
  /** The name the agent is registered under on the network. */
  readonly publicName: string
  readonly state: SocialMembershipState
  readonly reviewAll: boolean
  /** The agent's own visit interval; absent uses `[social] heartbeat_interval_ms`. */
  readonly intervalMs?: number
  /** 403 answers in a row; five pause the membership. */
  readonly forbiddenStreak: number
  /** No request goes out before this instant, set from a 429's retry time. */
  readonly cooldownUntil?: number
  readonly joinedAt: number
  readonly changedAt: number
}

/** One request that changed something on a network, kept for its daily cap, the duplicate guard and
 *  the visit prompt. Never a read. */
export interface SocialWriteRow {
  readonly id: string
  readonly agentId: AgentId
  readonly network: string
  readonly label: string
  readonly bodyHash: string
  /** The body's first characters, for the visit prompt and `social list`. */
  readonly excerpt: string
  /** The id the network gave what was written, when it said. */
  readonly returnedId?: string
  readonly at: number
}

export interface SocialDraftRow {
  readonly id: string
  readonly agentId: AgentId
  readonly network: string
  readonly method: string
  readonly path: string
  readonly query?: Readonly<Record<string, string>>
  /** The JSON body as the agent wrote it. Never the key: a body holding it is refused before this. */
  readonly body?: string
  readonly reason: SocialDraftReason
  /** The pin id the request was checked against. Approval re-checks against the current one. */
  readonly pinId: string
  readonly createdAt: number
  readonly expiresAt: number
}

interface SocialWriteScope {
  readonly agentId: AgentId
  readonly network: string
  readonly since: number
}

/** Agent social networks the operator added, which of their agents joined them, what they wrote,
 *  and the requests waiting for the operator. Consumer-side for `social/`; persistence implements
 *  it and `app` binds the two. */
export interface SocialStore {
  listNetworks(): Promise<readonly SocialNetworkRow[]>
  findNetwork(name: string): Promise<SocialNetworkRow | undefined>
  /** False when the name is taken. */
  addNetwork(name: string, at: number): Promise<boolean>
  /** `social remove`, and undoing an install whose files could not be written. */
  removeNetwork(name: string): Promise<boolean>
  /** True only when the state changed, so a caller tells the operator once per change. */
  setNetworkState(
    name: string,
    state: SocialNetworkState,
    change: { readonly reason?: SocialPauseReason; readonly at: number }
  ): Promise<boolean>

  listMemberships(filter?: {
    readonly agentId?: AgentId
    readonly network?: string
  }): Promise<readonly SocialMembershipRow[]>
  findMembership(agentId: AgentId, network: string): Promise<SocialMembershipRow | undefined>
  /** False when the agent is already a member. */
  addMembership(row: SocialMembershipRow): Promise<boolean>
  removeMembership(agentId: AgentId, network: string): Promise<boolean>
  /** True only when the state changed. Becoming `active` clears the 403 streak. */
  setMembershipState(
    agentId: AgentId,
    network: string,
    change: { readonly state: SocialMembershipState; readonly at: number }
  ): Promise<boolean>
  setReviewAll(agentId: AgentId, network: string, on: boolean): Promise<boolean>
  /** One more 403 in a row; returns the streak after it. */
  countForbidden(agentId: AgentId, network: string): Promise<number>
  clearForbidden(agentId: AgentId, network: string): Promise<void>
  setCooldown(agentId: AgentId, network: string, until: number): Promise<void>

  recordWrite(row: SocialWriteRow): Promise<void>
  countWrites(scope: SocialWriteScope & { readonly label: string }): Promise<number>
  hasWrite(scope: SocialWriteScope & { readonly bodyHash: string }): Promise<boolean>
  /** Newest first; every network when `network` is absent. */
  listWrites(scope: {
    readonly agentId: AgentId
    readonly network?: string
    readonly limit: number
  }): Promise<readonly SocialWriteRow[]>
  pruneWrites(before: number): Promise<number>

  addDraft(row: SocialDraftRow): Promise<void>
  /** Unexpired drafts, oldest first. */
  listDrafts(now: number): Promise<readonly SocialDraftRow[]>
  findDraft(id: string): Promise<SocialDraftRow | undefined>
  removeDraft(id: string): Promise<boolean>
  removeDrafts(agentId: AgentId, network: string): Promise<number>
  pruneDrafts(now: number): Promise<number>
}
