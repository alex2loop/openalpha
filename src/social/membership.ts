import type { AgentId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import type { ToolDefinition } from '@/core/tool'
import type { SocialMembershipState, SocialStore } from '@/core/types/social'
import type { SocialConfig } from '@/social/config'
import type { SocialKeyFiles } from '@/social/credentials'
import type { SocialBundles } from '@/social/pin/bundle'
import type { NetworkPin, SocialAgent, SocialAgentDirectory } from '@/social/types'
import { ValidationError } from '@/core/errors'
import { agentId } from '@/core/ids'
import { formatErrForLog } from '@/core/security/credentials'
import { stripControls, toSingleLine } from '@/core/utils/text'
import { refuse } from '@/social/refusal'
import {
  type RegisterInput,
  type Registration,
  registerAgent,
  registrationBody,
} from '@/social/registration'
import {
  SOCIAL_REQUEST_TOOL,
  SOCIAL_SKILL_TOOL,
  socialToolSet,
  toolsOutsideRules,
} from '@/social/tool-rules'

export interface MembershipDeps {
  readonly config: SocialConfig
  readonly store: SocialStore
  readonly bundles: SocialBundles
  readonly keys: SocialKeyFiles
  readonly agents: SocialAgentDirectory
  tools(): ReadonlyMap<string, ToolDefinition>
  readonly logger: Logger
  now(): number
}

export interface JoinInput {
  readonly agentId: string
  readonly network: string
  readonly intervalMs?: number
  /** From `--key-env`: skips registration. */
  readonly apiKey?: string
  readonly publicName?: string
}

export interface JoinOutcome {
  /** The claim link, verification code and the like, as the network named them. */
  readonly claims: Registration['claims']
  readonly keyPath: string
  readonly registered: boolean
}

export interface SocialMemberView {
  readonly agentId: AgentId
  readonly network: string
  readonly publicName: string
  readonly state: SocialMembershipState
  readonly reviewAll: boolean
  readonly intervalMs: number
  readonly drafts: number
  readonly cooldownUntil?: number
}

/** An id typed on a command line: a malformed one is simply an agent that does not exist. */
export function toAgentId(raw: string): AgentId {
  try {
    return agentId(raw)
  } catch {
    return refuse('social.agentUnknown', { agent: raw })
  }
}

function assertCanJoin(deps: MembershipDeps, raw: string): SocialAgent {
  const agent = deps.agents.get(raw)

  if (agent === undefined) {
    return refuse('social.agentUnknown', { agent: raw })
  }

  if (!deps.agents.isUserAgent(raw)) {
    refuse('social.agentNotUser', { agent: raw })
  }

  return agent
}

async function assertAgentReady(deps: MembershipDeps, agent: SocialAgent): Promise<void> {
  const raw: string = agent.id

  if (await deps.agents.isPaused(raw)) {
    refuse('social.agentPaused', { agent: raw })
  }

  if (!deps.agents.hasOwnFocus(raw)) {
    refuse('social.needsFocus', { agent: raw })
  }

  const outside = toolsOutsideRules(
    agent.tools,
    socialToolSet(deps.config.allowedTools, deps.tools())
  )

  if (outside.length > 0) {
    refuse('social.toolsOutside', { agent: raw, tools: outside.join(', ') })
  }

  if (!(agent.tools.includes(SOCIAL_REQUEST_TOOL) && agent.tools.includes(SOCIAL_SKILL_TOOL))) {
    refuse('social.needsSocialTools', {
      agent: raw,
      tools: `${SOCIAL_REQUEST_TOOL}, ${SOCIAL_SKILL_TOOL}`,
    })
  }
}

async function readActivePin(deps: MembershipDeps, network: string): Promise<NetworkPin> {
  const row = await deps.store.findNetwork(network)

  if (row === undefined) {
    return refuse('social.unknownNetwork', { network })
  }

  if (row.state !== 'active') {
    refuse('social.networkPaused', { network })
  }

  const pointer = await deps.bundles.readPointer(network)
  const pin =
    pointer === undefined ? 'mismatch' : await deps.bundles.readPin(network, pointer.current)

  return pin === 'mismatch' ? refuse('social.pinDamaged', { network }) : pin
}

/** What `join` would send to register, after the same checks, so the operator reads it first;
 *  `undefined` when the skill registers no one. */
export async function previewRegistration(
  deps: MembershipDeps,
  input: Pick<JoinInput, 'agentId' | 'network' | 'publicName'>
): Promise<Readonly<Record<string, string>> | undefined> {
  const agent = assertCanJoin(deps, input.agentId)

  await assertAgentReady(deps, agent)

  const pin = await readActivePin(deps, input.network)

  return registrationBody({ pin, agent, publicName: input.publicName ?? agent.name })
}

export async function joinNetwork(
  deps: MembershipDeps,
  input: JoinInput,
  signal: AbortSignal
): Promise<JoinOutcome> {
  const agent = assertCanJoin(deps, input.agentId)

  await assertAgentReady(deps, agent)

  const { network } = input
  const pin = await readActivePin(deps, network)
  const publicName = input.publicName ?? agent.name
  const now = deps.now()
  // Claim the slot first: a paused row is never visited and never sends, and a second `join` of the
  // same pair stops here, before it can touch the first one's key.
  const claimed = await deps.store.addMembership({
    agentId: agent.id,
    network,
    publicName,
    state: 'paused',
    reviewAll: false,
    ...(input.intervalMs === undefined ? {} : { intervalMs: input.intervalMs }),
    forbiddenStreak: 0,
    joinedAt: now,
    changedAt: now,
  })

  if (!claimed) {
    return refuse('social.alreadyMember', { agent: agent.id, network })
  }

  try {
    return await activateMembership(deps, { pin, agent, publicName, apiKey: input.apiKey }, signal)
  } catch (err: unknown) {
    // The network side of a registration cannot be undone; everything local is removed.
    await undoJoin(deps, agent.id, network)
    throw err
  }
}

/** Key first, then the row, so the slot stays claimed until the key is gone. A cleanup failure is
 *  logged and never hides why the join failed. */
async function undoJoin(deps: MembershipDeps, id: AgentId, network: string): Promise<void> {
  try {
    await deps.keys.remove(network, id)
    await deps.store.removeMembership(id, network)
  } catch (err: unknown) {
    deps.logger.warn('social.join_undo_failed', { agent: id, network, err: formatErrForLog(err) })
  }
}

async function activateMembership(
  deps: MembershipDeps,
  input: RegisterInput & { readonly apiKey: string | undefined },
  signal: AbortSignal
): Promise<JoinOutcome> {
  const { pin, agent } = input
  const registration: Registration | undefined =
    input.apiKey === undefined ? await registerAgent(input, signal) : undefined
  const apiKey = input.apiKey ?? registration?.apiKey ?? ''
  const claims = registration?.claims ?? []

  try {
    await deps.keys.write(pin.name, agent.id, apiKey)
  } catch (err: unknown) {
    if (registration === undefined) {
      throw err
    }

    throw new ValidationError(
      'registered but the key could not be saved',
      {
        key: 'social.keySaveFailed',
        params: {
          network: pin.name,
          claims: claims
            .map((claim) => toSingleLine(stripControls(`${claim.field}: ${claim.value}`)))
            .join(' · '),
        },
      },
      err
    )
  }

  await deps.store.setMembershipState(agent.id, pin.name, { state: 'active', at: deps.now() })

  return {
    claims,
    keyPath: deps.keys.pathOf(pin.name, agent.id),
    registered: registration !== undefined,
  }
}

export async function leaveNetwork(
  deps: MembershipDeps,
  input: { readonly agentId: string; readonly network: string }
): Promise<void> {
  const id = toAgentId(input.agentId)

  if ((await deps.store.findMembership(id, input.network)) === undefined) {
    refuse('social.notMember', { agent: input.agentId, network: input.network })
  }

  // The key goes before the row: a `join` landing in between stops at the row that is still there,
  // so it never has its fresh key removed.
  try {
    await deps.keys.remove(input.network, id)
  } catch (err: unknown) {
    deps.logger.warn('social.key_remove_failed', {
      agent: id,
      network: input.network,
      err: formatErrForLog(err),
    })
  }

  await deps.store.removeDrafts(id, input.network)
  await deps.store.removeMembership(id, input.network)
}

export async function rekeyMembership(
  deps: MembershipDeps,
  input: { readonly agentId: string; readonly network: string; readonly apiKey: string }
): Promise<void> {
  const id = toAgentId(input.agentId)

  const membership = await deps.store.findMembership(id, input.network)

  if (membership === undefined) {
    refuse('social.notMember', { agent: input.agentId, network: input.network })
  }

  await deps.keys.write(input.network, id, input.apiKey)

  // Only a key the network turned away is cured by a new one; a pause the operator set, or one from
  // five 403s, stays until `social resume`.
  if (membership.state === 'refused') {
    await deps.store.setMembershipState(id, input.network, { state: 'active', at: deps.now() })
  }

  await deps.store.clearForbidden(id, input.network)
}

export async function setReview(
  deps: MembershipDeps,
  input: { readonly agentId: string; readonly network: string; readonly on: boolean }
): Promise<void> {
  const id = toAgentId(input.agentId)

  if (!(await deps.store.setReviewAll(id, input.network, input.on))) {
    refuse('social.notMember', { agent: input.agentId, network: input.network })
  }
}

export async function setMemberState(
  deps: MembershipDeps,
  input: {
    readonly agentId: string
    readonly network: string
    readonly state: 'active' | 'paused'
  }
): Promise<void> {
  const id = toAgentId(input.agentId)
  const row = await deps.store.findMembership(id, input.network)

  if (row === undefined) {
    return refuse('social.notMember', { agent: input.agentId, network: input.network })
  }

  // A refused key sends nothing already, and only `social rekey` lifts it: a pause must not turn it
  // into something `resume` could reactivate.
  if (row.state === 'refused') {
    if (input.state === 'active') {
      refuse('social.refusedNeedsRekey', { agent: input.agentId, network: input.network })
    }

    return
  }

  await deps.store.setMembershipState(id, input.network, {
    state: input.state,
    at: deps.now(),
  })
}

export async function listMemberViews(
  deps: MembershipDeps,
  now: number
): Promise<readonly SocialMemberView[]> {
  const members = await deps.store.listMemberships()
  const drafts = new Map<string, number>()

  for (const draft of await deps.store.listDrafts(now)) {
    const key = `${draft.agentId}:${draft.network}`

    drafts.set(key, (drafts.get(key) ?? 0) + 1)
  }

  return members.map((row) => ({
    agentId: row.agentId,
    network: row.network,
    publicName: row.publicName,
    state: row.state,
    reviewAll: row.reviewAll,
    intervalMs: row.intervalMs ?? deps.config.heartbeat.intervalMs,
    drafts: drafts.get(`${row.agentId}:${row.network}`) ?? 0,
    ...(row.cooldownUntil === undefined ? {} : { cooldownUntil: row.cooldownUntil }),
  }))
}

export async function isMember(deps: MembershipDeps, raw: string): Promise<boolean> {
  let id: AgentId

  try {
    id = agentId(raw)
  } catch {
    return false
  }

  return (await deps.store.listMemberships({ agentId: id })).length > 0
}
